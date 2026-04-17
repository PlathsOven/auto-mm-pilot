# Spec: Modular LLM Prompt Architecture

## Overview
Replace the monolithic investigation prompt with a modular prompt system where the client declares intent (`investigate`, `configure`, `opinion`, `general`) and the server composes a lean, role-specific system prompt from shared + mode-specific modules. Each mode only receives the instructions and data it needs, cutting token cost and output verbosity proportionally.

## Requirements

### User stories
- As a trader, I want quick, proportionate answers when I ask about my positions, so I'm not waiting 30+ seconds for an essay when I asked a simple question.
- As a trader, I want to configure new data streams through the same chat interface I use for investigation, without needing a separate "Stream co-pilot" panel.
- As a trader, I want to register discretionary opinions as manual blocks through the chat, so I can capture views without learning the block API.
- As a trader, I want the LLM to tell me when my question doesn't match the mode I selected, so I can switch rather than getting a confused answer.

### Acceptance criteria
- [ ] Client sends a `mode` field on every `/api/investigate` request: `"investigate"` | `"configure"` | `"opinion"` | `"general"`
- [ ] Server selects prompt modules based on `mode` — each mode gets only its relevant instructions and data
- [ ] Existing investigation behavior is preserved (no regression in answer quality for investigation questions)
- [ ] Static prompt text for `investigate` mode is at least 40% smaller than current (measured in characters)
- [ ] Static prompt text for `general` mode is under 3KB
- [ ] `max_tokens` reduced from 8196 to 2048
- [ ] LLM responds to simple factual questions in 2-3 sentences
- [ ] LLM tells the trader when their message doesn't match the declared intent (e.g. asking about position changes in `configure` mode)
- [ ] TTFT under 30 seconds on current free-tier models for all modes

### Performance
- Cold path (per-request, not per-tick). No latency budget beyond the 30s TTFT target.
- Prompt size targets: `investigate` ~10KB total static, `configure` ~6KB, `opinion` ~5KB, `general` ~3KB (all before dynamic data injection).

### Security
- No new endpoints or auth changes. Same `/api/investigate` endpoint with an additional field.
- No new secrets or external dependencies.

## Technical Approach

The prompt system becomes a composition pipeline: **shared core + mode extension + mode-specific data.** The shared core contains the Posit framework, language rules, and hard constraints — stated once, no duplication. Each mode extension adds role-specific instructions and reasoning protocols. Data injection is mode-aware: investigation injects engine state + pipeline + history; configure injects stream registry + parameter schemas; opinion injects block API + current positions; general injects minimal engine summary.

The client already knows the trader's intent from the UI context (clicked a grid cell = investigate, opened stream config = configure, etc.) and sends it explicitly. The LLM is instructed to flag mismatched intent rather than silently switching modes.

### Prompt module structure

```
server/api/llm/prompts/
  __init__.py          — public build_system_prompt(mode, **data) dispatcher
  core.py              — SHARED_CORE: role, framework, language rules, hard constraints (deduplicated)
  investigation.py     — INVESTIGATION_EXT: reasoning protocol, example outputs, data sections
  configure.py         — CONFIGURE_EXT: stream parameter guidance, config schema (future)
  opinion.py           — OPINION_EXT: manual block creation flow, impact review (future)
  general.py           — GENERAL_EXT: catch-all, conversational, intent-mismatch detection
  preamble.py          — DELETED (absorbed into core.py)
```

### Composition per mode

| Mode | Modules | Dynamic data injected |
|------|---------|----------------------|
| `investigate` | core + investigation | engine state, stream contexts, pipeline snapshot, history |
| `configure` | core + configure | stream registry, parameter schema, available streams |
| `opinion` | core + opinion | block API schema, current positions (summary), stream contexts |
| `general` | core + general | engine summary (positions only, no pipeline detail) |

### Shared core content (deduplicated from current preamble + investigation)

The shared core consolidates into these sections, each stated exactly once:

1. **Role** — "You are the intelligence layer of Posit..." (3 sentences)
2. **Framework** — Edge x Bankroll / Variance equation, signal synthesis, time & impact (current preamble sections A/B/C, trimmed)
3. **Parameter mapping** — current preamble parameter mapping section (kept — useful for parameter questions)
4. **Language rules** — directional neutrality, "desired position", epistemology over mechanics, plain vocabulary, numbers, vol-is-not-a-risk, forbidden jargon (merged from preamble + investigation, stated once)
5. **Hard constraints** — the 6 constraints from investigation.py, but without duplicating rules already in language rules
6. **Response discipline** — proportional length instruction, no engagement hooks, brief for casual messages, flag intent mismatch

### What gets cut (duplication, not meaning)

- **Preamble "Language Rules" section** that restates directional neutrality, "desired position", and epistemology rules already in investigation hard constraints — merge into one authoritative statement in core.
- **Investigation "Hard Constraints" items 4 and 5** ("epistemology over mechanics", "clarity over jargon") — already covered verbatim in the preamble language rules. Keep one copy in core.
- **`REMINDER` block** at the bottom of investigation.py — just restates constraints 1-5. Delete.
- **"Example bad output"** section in investigation.py — the good examples are sufficient; negative examples add ~400 chars for marginal value.
- **Repeated "desired position" instruction** — appears in investigation hard constraint #3, preamble language rule "DESIRED POSITION", and the pipeline section header. Keep one in core + one in the pipeline data header (contextual reinforcement).
- **Temporal humility** — stated in investigation hard constraint #2, preamble epistemic honesty, and history section rules. Keep one in core + one inline with history data.

### Data shape changes

**`server/api/models.py`:**
```python
class InvestigateRequest(BaseModel):
    conversation: list[dict[str, str]]
    cell_context: CellContext | None = None
    mode: Literal["investigate", "configure", "opinion", "general"] = "investigate"
```

**`client/ui/src/types.ts`:**
```typescript
export type ChatMode = "investigate" | "configure" | "opinion" | "general";

export interface InvestigatePayload {
  conversation: { role: string; content: string }[];
  cell_context?: Record<string, unknown> | null;
  mode: ChatMode;
}
```

### Files to create
- `server/api/llm/prompts/core.py` — shared core module (replaces `preamble.py`)
- `server/api/llm/prompts/general.py` — general/catch-all mode extension
- `server/api/llm/prompts/configure.py` — stream configuration mode extension (stub initially)
- `server/api/llm/prompts/opinion.py` — opinion/manual block mode extension (stub initially)

### Files to modify
- `server/api/llm/prompts/__init__.py` — new `build_system_prompt(mode, **data)` dispatcher replacing `get_investigation_prompt`
- `server/api/llm/prompts/investigation.py` — strip to investigation-only content (reasoning protocol, data sections), import core instead of preamble
- `server/api/llm/prompts/preamble.py` — delete (content migrated to `core.py`)
- `server/api/llm/service.py` — call `build_system_prompt(mode=req.mode, ...)`, pass mode through
- `server/api/routers/llm.py` — pass `req.mode` to service
- `server/api/models.py` — add `mode` field to `InvestigateRequest`
- `server/api/config.py` — reduce `max_tokens_investigation` from 8196 to 2048
- `client/ui/src/types.ts` — add `ChatMode` type, update `InvestigatePayload`
- `client/ui/src/services/llmApi.ts` — pass `mode` in request payload
- `client/ui/src/providers/ChatProvider.tsx` — track and pass current mode
- `client/ui/src/components/LlmChat.tsx` — mode selector UI (dropdown or tabs)

## Test Cases
- **Happy path (investigate):** Click a grid cell, ask "why is BTC 27MAR more long?" — get a concise investigation answer citing specific streams, grounded in pipeline data.
- **Happy path (general):** Type "got it" — get a brief acknowledgment, not an investigation essay.
- **Proportional length:** Ask "what's the BTC 27MAR desired position?" in investigate mode — get 1-2 sentences with the number, not a full reasoning chain.
- **Intent mismatch:** In `configure` mode, ask "why did position change?" — LLM flags that this is an investigation question and suggests switching modes.
- **Empty state:** No streams configured, `investigate` mode — LLM explains there's no data to investigate rather than hallucinating.
- **Backward compatibility:** Client that doesn't send `mode` defaults to `"investigate"` (existing behavior preserved).
- **Syntax check:** `python -m compileall server/ -q` passes after all changes.
- **Client typecheck:** `npm --prefix client/ui run typecheck` passes after all changes.

## Out of Scope
- **Full implementation of `configure` and `opinion` mode prompts** — this spec designs the architecture and creates stubs. The actual prompt content for those modes is a separate task when Flows 2 and 3 are built.
- ~~**Removing the Stream co-pilot panel**~~ — done (removed ahead of this spec).
- **Switching off free-tier models** — prompt must work well on current models.
- **Tool-use / function-calling** — some models support this, but free-tier OpenRouter models may not. Not worth the dependency.
- **Conversation-level mode switching** — the mode is per-request. If the trader wants to switch mid-conversation, they change the mode selector. The LLM does not auto-switch.

## Manual Brain Boundary
This feature does not touch `server/core/`. All changes are in `server/api/llm/` (prompt composition), `server/api/models.py` (request schema), and `client/ui/` (mode selector + payload).
