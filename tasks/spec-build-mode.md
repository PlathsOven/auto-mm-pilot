# Spec: Merge Configure + Opinion into Build mode

## Overview

Replace the Configure and Opinion LLM modes with a single **Build** mode. Both modes follow the same BLOCK DECISION FLOW and share 6 of 6 core prompt modules — the only real divergence is entry point (data stream vs discretionary view) and exit command (`create_stream` vs `create_manual_block`). Merging reduces mode-selection friction for the trader (3 modes instead of 4) and lets the LLM classify intent internally rather than requiring the trader to pre-classify.

## Requirements

### User stories

- As the primary trader, I want a single "Build" mode for adding inputs to the pipeline, so that I don't have to decide whether my input is a "data stream" or an "opinion" before starting.
- As the primary trader, I want the LLM to tell me how it classified my input (data stream vs discretionary view) before proceeding, so that I can correct it if wrong.

### Acceptance criteria

- [ ] Mode dropdown shows 3 options: Investigate, Build, General (no Configure or Opinion).
- [ ] Build mode LLM explicitly states its classification ("I see this as a data stream" / "I see this as a discretionary view") before entering the decision flow.
- [ ] Ambiguous inputs trigger one clarifying question before classification.
- [ ] Build mode emits `create_stream` for data streams and `create_manual_block` for opinions — correct command format for each.
- [ ] A single Build conversation can produce multiple commands in sequence (e.g., a `create_stream` followed by a `create_manual_block`).
- [ ] Client auto-executes `create_stream` and routes `create_manual_block` to BlockDrawer — same asymmetry as today.
- [ ] `streamInvestigation()` renamed to `streamChat()` (or similar) across client.
- [ ] Investigate and General modes are unchanged in behavior.
- [ ] MODE_DIRECTORY table updated to 3 modes across all prompt files.
- [ ] Typecheck passes: `npm --prefix client/ui run typecheck` + `python -m compileall server/ -q`.

### Performance

- Cold path (per-request, not per-tick). No latency or memory concerns beyond existing LLM call overhead.
- System prompt size: union of Configure + Opinion extensions adds ~300 tokens vs either alone. Acceptable.

### Security

- No new endpoints, no auth changes, no new WS channels. Same `/api/investigate` endpoint (being renamed is out of scope — it still works).

## Technical Approach

Create a single `setup.py` (internal name `build`) prompt module that combines both extensions. The entry point asks the trader what they want to add. The LLM classifies the input and states its classification explicitly. The prompt then branches: data-stream inputs follow the Configure path (key_cols, rejection protocol, `create_stream` command); discretionary views follow the Opinion path (multi-expiry, conflict detection, `create_manual_block` command). Both paths share the BLOCK DECISION FLOW. The dynamic data section is the union: `{positions, streams, symbols, expiries}`.

On the client, rename `streamInvestigation` → `streamChat` in `llmApi.ts` and all call sites. Update the `ChatMode` type and dropdown. Delete the old `configure.py` and `opinion.py` files.

### Data shape changes

- `server/api/models.py`: `ChatMode = Literal["investigate", "build", "general"]` (drop `"configure"`, `"opinion"`)
- `client/ui/src/types.ts`: `ChatMode = "investigate" | "build" | "general"` (same change)
- No new Pydantic models. No wire format changes.

### Files to create

- `server/api/llm/prompts/build.py` — merged Build mode prompt builder

### Files to modify

- `server/api/llm/prompts/__init__.py` — update `ChatMode` literal, route `"build"` → `build_build_prompt`, remove configure/opinion imports
- `server/api/llm/prompts/core.py` — update `MODE_DIRECTORY` table (3 rows)
- `server/api/models.py` — update `ChatMode` literal
- `client/ui/src/types.ts` — update `ChatMode` type
- `client/ui/src/components/LlmChat.tsx` — update dropdown to 3 options (Investigate, Build, General)
- `client/ui/src/services/llmApi.ts` — rename `streamInvestigation` → `streamChat`
- `client/ui/src/providers/ChatProvider.tsx` — update call site for renamed function
- `docs/user-journey.md` — update Flows 2 and 3 to reference Build mode

### Files to delete

- `server/api/llm/prompts/configure.py`
- `server/api/llm/prompts/opinion.py`

## Test Cases

- **Happy path (opinion):** Trader says "I think BTC vol is going to spike around Pectra." LLM classifies as discretionary view, follows decision flow, emits `create_manual_block`.
- **Happy path (data stream):** Trader says "I have a realized vol feed from Provider X." LLM classifies as data stream, follows decision flow, emits `create_stream`.
- **Ambiguous input:** Trader says "I have a vol estimate for ETH." LLM asks: "Is this a live data feed you want to connect, or a discretionary view you'd like to register?" Then proceeds based on answer.
- **Sequential commands:** Trader configures a data stream, then in the same conversation says "also, I think FOMC will be an upset." LLM handles the second input as a new opinion, emits a second command.
- **Data rejection:** Trader says "I have BTC spot prices." LLM explains this can't enter the variance pipeline and suggests alternatives (same as current Configure behavior).
- **Conflict detection:** Trader registers an opinion for BTC 27MAR, but a manual block already exists for that symbol/expiry. LLM warns about stacking.
- **Conversation continuity:** Trader describes a data stream in General mode, switches to Build. LLM picks up context from conversation history.

## Out of Scope

- **Renaming the `/api/investigate` endpoint.** The endpoint name is a misnomer but changing it requires client URL updates and deploy coordination. Not worth it in this pass.
- **Changing Investigate or General mode behavior.** Only the MODE_DIRECTORY table is updated in those prompts.
- **Migration of saved conversations.** User confirmed: just delete any saved conversations with old mode values.
- **Renaming `InvestigateRequest` / `InvestigatePayload` Pydantic/TS models.** Cosmetic — defer to a future cleanup pass.

## Manual Brain Boundary

This feature does not touch `server/core/`. All changes are in the prompt layer (`server/api/llm/prompts/`), the API model layer (`server/api/models.py`), and the client UI/services layer. No boundary concerns.
