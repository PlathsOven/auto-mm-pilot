# LLM Orchestration

Developer reference for the Build-mode pipeline that translates a trader's natural-language input into a framework object (a stream or manual block). Complements `docs/architecture.md` (structural map) and `tasks/spec-llm-orchestration.md` (authoring spec — may drift from code; this file is the current reference).

Grounded in `server/api/llm/*.py` and `server/api/routers/build.py` as of writing — when code and doc disagree, code wins.

## Scope

- Build mode — the multi-stage pipeline documented here.
- Investigate + General — single-prompt streaming wrappers on `LlmService`; covered only in [§ Other modes](#other-modes).

## Pipeline at a glance

```
POST /api/build/converse (SSE)
└─ run_build_pipeline  (async generator in build_orchestrator.py)
   ├─ Stage 1   Router              (JSON)  → IntakeClassification
   │            ├─ "view" / "stream" / "headline"  → continue
   │            └─ "question" / "none"             → canned fallthrough, stop
   ├─ Stage 2   Intent extractor    (JSON)  → IntentOutput
   │            └─ clarifying_question?             → emit, stop
   ├─ Stage 3   Synthesiser         (tool)  → SynthesisOutput
   │            ├─ select_preset                   → preset SynthesisOutput
   │            └─ derive_custom_block             → custom SynthesisOutput
   ├─ Stage 3.5 Critique  (custom only, JSON)      → CustomDerivationCritique
   │            └─ !passes                          → concerns reply, stop
   └─ emit {"stage": "proposal", "payload": ProposedBlockPayload}

async (fire-and-forget after stream closes):
└─ feedback_detector.detect_and_store
   ├─ factual_correction   → domain_kb_entries     + llm_failures (mirror)
   ├─ discontent_signals[] → llm_failures (per signal)
   └─ preference_signals[] → user_context_entries (upsert by key)

Separate endpoints (client drives after the proposal arrives):
POST /api/blocks/preview → Stage 4 — pipeline dry-run, position diff
POST /api/blocks/commit  → apply, rerun + broadcast, persist BlockIntent
POST /api/llm/failures   → UI-driven failure signals (preview_rejection)
```

## Stage reference

| # | Purpose | Prompt module | Runner | Output model (`server/api/models.py`) |
|---|---|---|---|---|
| 1 | Classify intake as `view` / `stream` / `headline` / `question` / `none`. `question` + `none` short-circuit with a canned "Build is wrong mode" reply. | `prompts/router.py` | `run_json_stage` | `IntakeClassification` (L1142) |
| 2 | Extract intent. Emits either a structured intent, a `RawIntent` fallback for framework-relevant inputs that don't fit a schema, or a `clarifying_question` string that ends the turn early. | `prompts/intent_extractor.py` | `run_json_stage` | `IntentOutput` (L1213) |
| 3 | Map intent → block. Forced tool call: `select_preset` (Mode A — use a `PRESETS` entry) or `derive_custom_block` (Mode B — compute `BlockConfig` + `UnitConversion` from scratch). | `prompts/synthesiser.py` | `run_tool_stage` | `SynthesisOutput` (L1347) wrapping `ProposedBlockPayload` (L1312) |
| 3.5 | Only when Stage 3 chose Mode B. Reviews the custom derivation against framework invariants; if `passes=False`, the turn ends with the critique's concerns. | `prompts/critique.py` | `run_json_stage` | `CustomDerivationCritique` (L1267) |
| 4 | Preview — `build_preview()` in `preview.py` runs the full pipeline on a simulated stream-config list and diffs `desired_pos_df` against live state. Not an LLM call; no stage runner. | — | `preview.py` | `PreviewResponse` (L1364) |
| 5 | Commit — `routers/build.py` applies the proposal via `stream_registry`, reruns the pipeline, broadcasts, and persists a `StoredBlockIntent` (intent / synthesis / preview triplet). | — | `routers/build.py` | `BlockCommitResponse` (L1408) |
| post | Feedback detector — one LLM call per completed turn, fanned to three destinations. Fires via `asyncio.create_task`; never raises; never adds latency to the stream. | inline in `feedback_detector.py` | direct `record_call` | writes only — no return value |

Every LLM stage records to the `llm_calls` table via `audit.record_call` under a shared `conversation_turn_id`, so the whole turn is grouped for analysis.

## Event stream (what the client sees)

`build_orchestrator.run_build_pipeline` yields dict events; the router serialises each as a single SSE `data:` frame.

```json
{"stage": "router",   "output": {...IntakeClassification}, "conversation_turn_id": "<uuid>"}
{"stage": "intent",   "output": {...IntentOutput}}
{"stage": "synthesis","output": {...SynthesisOutput}}
{"stage": "critique", "output": {...CustomDerivationCritique}}  // Mode B only
{"stage": "proposal", "payload": {...ProposedBlockPayload}}
{"delta": "<assistant text>"}                                   // clarifying question, fallthrough, concerns
{"error": "<detail>"}                                           // fatal StageError
```

The client (`buildApi.streamBuildConverse` → `ChatProvider`) dispatches per-stage callbacks. The `conversation_turn_id` in the router event is the anchor the UI uses to attach later failure signals (`preview_rejection`).

## Data shapes

All in `server/api/models.py`. Read that file before touching any wire contract — Pydantic is upstream of `client/ui/src/types.ts` per `docs/conventions.md`.

| Role | Type | Line |
|---|---|---|
| Request — converse | `BuildConverseRequest` | 95 |
| Stage 1 out | `IntakeClassification` | 1142 |
| Stage 2 out | `IntentOutput` (union; includes `RawIntent`) | 1213 |
| Stage 3 out | `SynthesisOutput`, `CustomDerivation`, `ProposedBlockPayload` | 1347, 1282, 1312 |
| Stage 3.5 out | `CustomDerivationCritique` | 1267 |
| Stage 4 in/out | `BlockPreviewRequest`, `PreviewResponse` | 1390, 1364 |
| Stage 5 in/out | `BlockCommitRequest`, `BlockCommitResponse`, `StoredBlockIntent` | 1396, 1408, 1372 |
| Failure log | `LlmFailureLogRequest` | 1429 |

## HTTP endpoints

All in `server/api/routers/build.py` (except `/api/investigate` in `routers/llm.py`).

| Method + path | Purpose | Request | Response |
|---|---|---|---|
| `POST /api/build/converse` | Run stages 1–3.5, stream SSE events | `BuildConverseRequest` | SSE `text/event-stream` |
| `POST /api/blocks/preview` | Stage 4 dry-run | `BlockPreviewRequest` | `PreviewResponse` |
| `POST /api/blocks/commit` | Stage 5 apply + persist | `BlockCommitRequest` | `BlockCommitResponse` |
| `POST /api/llm/failures` | UI-driven failure signal | `LlmFailureLogRequest` | 204 No Content |
| `POST /api/investigate` | Investigate / General chat (single-prompt SSE) | `InvestigateRequest` | SSE |

All require auth via `Depends(current_user)`; `LlmService` is lazy-initialised so startup doesn't fail when `OPENROUTER_API_KEY` is absent.

## Persistence side-effects

| Destination | Populated by | Contents |
|---|---|---|
| `llm_calls` table | every stage runner + feedback detector, via `audit.record_call` | one row per outbound LLM call, grouped by `conversation_turn_id` |
| `block_intents` table | `/api/blocks/commit` on success (`block_intents.save_block_intent`) | intent / synthesis / preview triplet + `original_phrasing` per committed stream |
| `llm_failures` table | feedback detector (`discontent`, `factual_correction` mirror) + `/api/llm/failures` (`preview_rejection`) + in-flight silent-rejection sweep (`silent_rejection`) + in-flight post-commit edit detector (`post_commit_edit`) | one row per detected failure, typed by `signal_type` |
| `user_context_entries` table | feedback detector `preference_signals[]` | upsert by `(user_id, key)`; `key` is restricted to `user_context.CONTROLLED_KEYS` |
| `domain_kb_entries` table | feedback detector `factual_correction` | upsert by `(user_id, topic)`; per-user — one trader's corrections never leak into another's prompts. `serialize_kb_section(user_id)` appends them to every mode's system prompt. |

ORM models: `server/api/llm/models.py` — `LlmCall`, `BlockIntent`, `LlmFailure`, `UserContextEntry`, `DomainKbEntry`.

## Error handling

- **`StageError`** (in `stages.py`) — recoverable per-stage failure. The orchestrator catches it, emits `{"error": ...}`, and returns. The SSE stream ends cleanly; the pipeline rest-of-stages does not execute.
- **OpenRouter model fallback** — `stages.run_json_stage` / `run_tool_stage` call `client.complete_with_fallback(models=<tuple>)`, which walks the chain in order. Configured per stage in `LlmOrchestrationConfig` (see [§ Config](#configuration)).
- **Feedback detector** — `detect_and_store` wraps `_detect_and_store_inner` in a try/except that logs and swallows every exception. A broken detector must not take down the main response.
- **Stage 5 commit rollback** — if `save_block_intent` fails after the pipeline rerun, the stream is `registry.delete`'d and a rollback rerun is broadcast so there's no partial-commit state (live stream without a provenance row).

## Configuration

One frozen dataclass: `LlmOrchestrationConfig` in `orchestration_config.py`. Every tunable — model chain, temperature, max tokens, feedback thresholds — lives there with an env-var override. Instantiated fresh per request via `get_llm_orchestration_config()`.

Knob groups:

- **Per stage** — `router_*`, `intent_*`, `synthesis_*`, `critique_*`: `_models`, `_temperature`, `_max_tokens`.
- **Feedback loop** — `silent_rejection_threshold_secs` (120), `silent_rejection_sweep_interval_secs` (30), `pending_proposals_max_per_user` (32), `post_commit_edit_threshold_secs` (600), `detector_context_window` (6 messages).
- **Preview** — `preview_stale_threshold_secs` (30).
- **Budget (design target, not enforced)** — `end_to_end_latency_budget_secs` (5). Breaching this is the stated trigger for merging Stages 1 + 2 into one call.

Default model chains lean Haiku-class for Stages 1 / 2 / 3.5 (classification + JSON) and Sonnet-class for Stage 3 (tool-call synthesis needs stronger reasoning).

## Extending

| Task | Where |
|---|---|
| Add a preset | Append to `PRESETS` list in `parameter_presets.py`. Auto-serialised into the Stage-3 synthesiser prompt. |
| Add a knob | Add a field to `LlmOrchestrationConfig` with an `_env_*` default-factory; read it inside the stage where it applies. |
| Add a stage prompt | New module under `prompts/`; import + wire from `build_orchestrator.py`. Keep message building in the prompt module; keep LLM-call glue in `stages.py`. |
| Add a new controlled preference key | Add to `CONTROLLED_KEYS` in `user_context.py` and document the value schema in `feedback_detector._DETECTION_PROMPT`. |
| Add a new failure signal type | Add a `signal_type` branch in `failures.log_failure` call sites and ensure the detector or UI route raises it. |

## Other modes

Investigate and General are single-prompt SSE streams, not multi-stage pipelines.

- **`POST /api/investigate`** → `LlmService.investigate_stream()` in `service.py` → `prompts/__init__.build_system_prompt(mode, ...)` dispatches to `prompts/investigation.py` or `prompts/general.py`. Both share `prompts/core.py` for role + framework + rules.
- After the stream closes, the investigate endpoint also fires `feedback_detector.detect_and_store` — the same detector Build mode uses.

Build does not go through `LlmService`; it has its own entry point (`build_orchestrator.run_build_pipeline`) and bypasses the shared prompt dispatcher entirely. `prompts/__init__.py` calls this out: "Build is handled by `build_orchestrator`."

## In-flight work

Grounded from `tasks/todo.md` and the `orchestration_config.py` knobs already seeded for not-yet-wired features:

- **Silent-rejection sweep** — periodic task that logs proposals neither confirmed nor rejected within `silent_rejection_threshold_secs`. Config knobs present; `silent_rejection_sweep.py` + `pending_proposals.py` files appearing.
- **Post-commit edit detection** — flagging a block edit/delete within `post_commit_edit_threshold_secs` of creation as an LLM first-pass failure. Helper lifted into `block_intents.post_commit_edit` in commit `308bd14`.
- **RAG over prior intents** — Milestone 5, deferred. See `tasks/spec-rag-prior-intents.md`.
- **Stages 1 + 2 merge** — stated follow-up if `end_to_end_latency_budget_secs` is breached in practice.

Consult `tasks/spec-llm-orchestration-housekeeping.md` for the housekeeping follow-ups and `tasks/spec-llm-orchestration.md` §13 for the milestone list.

## Pointers

- Key Files table: `docs/architecture.md` (rows for each `server/api/llm/*.py` module).
- Component registry: `docs/stack-status.md` ("LLM Build Orchestration" subsection).
- Authoring spec: `tasks/spec-llm-orchestration.md` — full rationale and §5 preset schema. Treat as historical design intent; where it disagrees with code, code wins.
- Decisions: `docs/decisions.md` — 2025 OpenRouter fallback, 2026-04-10 modular prompt architecture, 2026-04-10 open-framework platform.
