# Spec: Engine Command Client-Side Execution

## Overview

Wire the client to detect `engine-command` blocks in LLM responses (SSE stream), parse them, and execute the corresponding REST API calls to create manual blocks or configure data streams. This is the execution layer for the opinion and configure mode prompts defined in `spec-llm-opinion-configure-prompts.md`.

## Requirements

### User stories

- As a **trader**, when I confirm an opinion and the LLM emits a `create_manual_block` command, I want the block to be created automatically without me needing to copy parameters into a form — so that the LLM-guided flow ends with an actual block in the pipeline.
- As a **trader**, when I describe a data stream and the LLM emits a `create_stream` command, I want the stream to be created and configured automatically — so that I can start sending data to it immediately.
- As a **trader**, I want to see clear feedback in the chat when a command succeeds or fails — so that I know whether my opinion or stream was registered.

### Acceptance criteria

- [ ] Client detects `` ```engine-command `` fenced code blocks in completed LLM responses.
- [ ] `create_manual_block` commands call `POST /api/blocks` via the existing `createManualBlock()` in `blockApi.ts`.
- [ ] `create_stream` commands call `POST /api/streams` then `POST /api/streams/{name}/configure` via the existing `createStream()` + `configureStream()` in `streamApi.ts`.
- [ ] On success: a system-style message is appended to the chat: "Block [name] created successfully" or "Stream [name] created and configured".
- [ ] On error: a system-style message is appended: "Failed to create block: [error detail]". The original command block remains visible so the trader can diagnose.
- [ ] Truncated or malformed JSON (e.g., user cancelled the stream mid-command) does not trigger execution — parse errors are silently ignored (the command never completed).
- [ ] Command execution only fires once per message, on stream completion (`onDone`), never mid-stream.
- [ ] Multiple engine-command blocks in a single message are each executed in order (unlikely but safe).

### Performance

- Cold path. Command execution is a single REST call per command. Pipeline re-run happens server-side (~200ms). No per-tick impact.
- No payload size concerns — commands are small JSON objects.

### Security

- No new endpoints. The client calls existing authenticated endpoints (`POST /api/blocks`, `POST /api/streams`, etc.).
- The engine-command JSON originates from our own LLM server response. The LLM is instructed to confirm with the user before emitting. There is no user-injectable path to forge a command — it only appears in assistant messages.
- No secrets in command payloads.

## Technical Approach

### Command detection and parsing

After the SSE stream completes (`onDone` in `ChatProvider.tsx`), the accumulated response text is scanned for fenced code blocks with the `engine-command` language tag:

````
```engine-command
{"action": "create_manual_block", "params": {...}}
```
````

The parser extracts the JSON body, validates it has an `action` and `params` field, and returns a typed command object. If JSON parsing fails (truncated stream, malformed output), the command is silently skipped — no error shown, because the LLM simply didn't finish emitting the command.

### Command execution

Each parsed command is dispatched by `action`:

**`create_manual_block`** — calls `createManualBlock()` from `blockApi.ts` with `params` mapped directly to `ManualBlockPayload`. The shape matches 1:1 because the prompt spec defines the command format to mirror `ManualBlockRequest`.

**`create_stream`** — two-step:
1. `createStream(params.stream_name, params.key_cols)` from `streamApi.ts`
2. `configureStream(params.stream_name, { scale, offset, exponent, block })` from `streamApi.ts`

If step 1 succeeds but step 2 fails, the stream is left in PENDING state. The error message tells the trader to try configuring manually via Studio.

### UI feedback

After execution, a system-style message is appended to the chat via `pushMessage`. This is a new `role` value — `"system"` — styled distinctly from user and assistant messages (e.g., smaller text, neutral color, no avatar). The message content is:

- Success (block): `"✓ Block 'opinion_fomc_btc_20260115' created. Check the Block Configuration panel to review its impact."`
- Success (stream): `"✓ Stream 'rv_provider_x' created and configured (READY). Connect your data source to start sending snapshots."`
- Error: `"✗ Failed to create block 'opinion_fomc_btc_20260115': Stream already exists (409). The existing block was not modified."`

### Command rendering in chat

The engine-command code block is rendered by `react-markdown` as a standard `<pre><code>` block. No custom renderer is needed for MVP — the raw JSON is visible and readable. A future enhancement could render it as a styled "command card" with parameter labels.

### Data shape changes

- `client/ui/src/types.ts`: Add `EngineCommand` type and extend `ChatMessage.role` to include `"system"`.

```typescript
/** Parsed engine command from LLM response */
export interface EngineCommand {
  action: "create_manual_block" | "create_stream";
  params: Record<string, unknown>;
}

/** Extend ChatMessage role */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";  // ← add "system"
  content: string;
  timestamp: number;
}
```

- `server/api/models.py`: No changes.

### Files to create

| File | Purpose |
|------|---------|
| `client/ui/src/services/engineCommands.ts` | Parse engine-command blocks from markdown text; execute commands via existing API functions; return result messages |

### Files to modify

| File | Change |
|------|--------|
| `client/ui/src/types.ts` | Add `EngineCommand` interface; extend `ChatMessage.role` to include `"system"` |
| `client/ui/src/providers/ChatProvider.tsx` | In `onDone` callback: call engine command parser on accumulated text; if commands found, execute and push system messages |
| `client/ui/src/components/LlmChat.tsx` | Style system messages distinctly (smaller, neutral, no avatar) |

## Test Cases

- **Happy path — create manual block:** LLM emits `create_manual_block` command → client calls `POST /api/blocks` → 201 → system message "Block created" appears in chat.
- **Happy path — create stream:** LLM emits `create_stream` command → client calls `POST /api/streams` → `POST /api/streams/{name}/configure` → system message "Stream created and configured".
- **Error — name conflict (409):** `POST /api/blocks` returns 409 (stream name already exists) → system message shows the 409 error detail.
- **Error — invalid params (422):** `POST /api/blocks` returns 422 (e.g., invalid BlockConfig) → system message shows validation error.
- **Error — stream configure fails:** `POST /api/streams` succeeds but `POST /api/streams/{name}/configure` fails → system message says stream was created but configuration failed, suggests manual config via Studio.
- **Truncated command:** User clicks "Stop" mid-stream, engine-command block is incomplete → JSON parse fails → no execution, no error shown. The partial code block is visible in the chat as-is.
- **No command in response:** LLM response has no engine-command block (e.g., still asking questions) → parser returns empty → nothing happens.
- **Malformed JSON:** LLM emits an engine-command block but the JSON is invalid → parse error → silently skipped (not a user-actionable error).
- **Multiple commands:** LLM emits two engine-command blocks → both are executed in order → two system messages.
- **WS disconnect during execution:** `POST /api/blocks` is HTTP, not WS — unaffected by WS state. If the fetch itself fails (network error), the error is caught and shown as a system message.
- **Unknown action:** LLM emits an action the client doesn't recognize → silently skipped with a console warning.

## Out of Scope

- **Investigation mode engine commands** (`override_uncertainty_factor`, `set_position_limit`, etc.). These use the same `engine-command` format but require different API endpoints that don't exist yet. The parser will log a warning for unknown actions; wiring investigation commands is a separate task.
- **Custom command-card renderer.** The engine-command block renders as a plain code block. A styled card with labels, a "Run" button, or an undo affordance is a future UI enhancement.
- **Undo / delete after creation.** The system message confirms creation but does not offer a one-click undo. The trader can delete blocks/streams via the existing Studio UI.
- **Optimistic UI updates.** The Block Configuration table and Pipeline Chart will update on the next WS tick after the pipeline re-runs server-side. There is no instant client-side state injection.
- **Server-side command interception.** The server does not parse or execute engine commands — it just passes the LLM text through. All execution happens client-side.

## Manual Brain Boundary

This feature does not touch `server/core/`. All changes are in `client/ui/` (TypeScript) and operate through existing REST endpoints that the server already provides. The pipeline re-run that follows block/stream creation is triggered server-side by the existing endpoint handlers in `server/api/routers/blocks.py` and `server/api/routers/streams.py`.
