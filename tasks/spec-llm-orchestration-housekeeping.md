# Spec: LLM orchestration housekeeping

**Status:** Draft — ready for `/implement`. Authored 2026-04-23.

**Context:** Small follow-ups to `tasks/spec-llm-orchestration.md` that don't warrant their own specs. Two refactor items and one conditional optimisation, kept deliberately narrow so the PR is surgical.

## Overview

Three housekeeping items land together because each is too small for its own spec but shares the same lane (LLM orchestration) and the same testing surface:

1. **Shared commit-path helper.** Dedup the manual-block flow between `routers/blocks.py::create_manual_block` (user + "+ Manual block" button) and `routers/build.py::blocks_commit` (Build orchestrator confirm path).
2. **`server/api/models.py` decomposition.** Split the 1500+ line file into a `server/api/models/` package by concern (auth, streams, connectors, llm) so the LLM section is browsable and Pydantic changes stop touching unrelated shapes.
3. **Stage 1+2 merge latency optimisation — conditional trigger only.** The spec §16.3 says "if the 5s budget is breached, merge Stages 1+2 into one structured-output call". This housekeeping item adds the latency instrumentation + decision criteria; the actual merge is gated on telemetry.

Observability deliberately minimal: one log line per Build turn with per-stage latencies + one aggregate metric written to stdout. No new dashboards, no Prometheus, no admin UI.

## Requirements

### User stories
- As the maintainer, I want the manual-block flow written once so a bug fix in the registry-interaction sequence lands in one place, not two.
- As the next agent reading `server/api/models.py`, I want the LLM-orchestration shapes in their own module so a targeted edit doesn't diff against auth + streams shapes.
- As the product lead, I want to know when the Build pipeline breaches the 5s budget consistently so we can decide whether to merge Stages 1+2.

### Acceptance criteria

**Shared commit helper**
- [ ] A new `server/api/blocks/manual_block.py` module exposes `async def apply_manual_block(user_id, stream_name, key_cols, scale, offset, exponent, block, snapshot_rows, applies_to) -> None`. Callers do `registry.create` → `configure` → `ingest_snapshot` → `manual_blocks.mark` → `rerun_and_broadcast` via the helper; rollback on pipeline failure is internal to the helper.
- [ ] `routers/blocks.py::create_manual_block` calls the helper.
- [ ] `routers/build.py::blocks_commit` calls the helper. Build-specific logic (the `BlockIntent` write + rollback-on-persistence-failure) stays in `blocks_commit`; the helper is a pure "bring this stream into existence" primitive.
- [ ] Behaviour is unchanged — existing callers produce the same REST responses and the same audit trail.

**models.py decomposition**
- [ ] `server/api/models.py` is replaced by a `server/api/models/` package with `__init__.py` re-exporting the full public surface (every existing top-level name stays importable via `from server.api.models import X`).
- [ ] Package layout: `models/__init__.py` (re-exports), `models/_shared.py` (`_WireModel`, `ChatMode`, `CellContext`, generic helpers), `models/auth.py` (auth / admin / events / usage), `models/streams.py` (streams + connectors + snapshots + market values), `models/llm.py` (the entire LLM-orchestration surface from `IntakeClassification` down through `StreamIntentResponse`).
- [ ] Every existing import path continues to work — no caller update required for compatibility. Internal imports may optionally be tightened to the concrete sub-module.
- [ ] Each sub-module lands under 500 lines (softer target than the 300-line convention since boundaries cleaner > smaller).
- [ ] `docs/conventions.md` schema-source-of-truth note updates to point at the package root.

**Latency instrumentation + merge-decision trigger**
- [ ] `server/api/llm/build_orchestrator.py::run_build_pipeline` records per-stage elapsed-ms via `time.perf_counter()` and emits one structured log line at the end of every turn: `build.turn latency_total_ms=X router_ms=Y intent_ms=Z synthesis_ms=W critique_ms=V stages=[router,intent,synthesis,...] user_id=... turn_id=...`.
- [ ] The log level is INFO when total < `end_to_end_latency_budget_secs * 1000`, WARNING when above.
- [ ] A new `GET /api/admin/llm-latency-summary` endpoint returns the last 100 Build turns' per-stage latencies (mean, p50, p95) by reading `llm_calls` rows grouped on `conversation_turn_id` where `stage IN ("router", "intent", "synthesis", "critique")`. Dev-only, `Depends(current_admin)`.
- [ ] Merge decision criteria — documented in the spec only, not implemented here: **if the admin endpoint's p95 total exceeds 5s across a rolling 100-turn window, a follow-up spec merges Stages 1+2 into a single structured-output call**. The merge itself is NOT implemented in this spec; this is instrumentation-and-triage only.

### Performance
- Shared helper: zero runtime cost (same operations, same number of DB / registry calls).
- Package decomposition: zero runtime cost; Python resolves imports at module load.
- Latency instrumentation: one `time.perf_counter()` call per stage (a few hundred nanoseconds) + one log line per turn. Negligible.

### Security
- No new auth surface for the helper or the decomposition.
- `/api/admin/llm-latency-summary` is admin-only (same gating as existing admin endpoints).
- Log lines contain `user_id` and `turn_id` — same fields already logged elsewhere. No PII beyond what audit already captures.

## Technical Approach

All three items are refactor-flavoured and share a single PR. Implementation order:

1. **Decompose `models.py` first** so the shared-helper module (item 1) can import from a clean `server.api.models.streams` rather than the 1500-line megafile.
2. **Write the shared helper** in `server/api/blocks/manual_block.py`. Migrate `routers/blocks.py::create_manual_block` first (existing test harness), then `routers/build.py::blocks_commit`. Diff both call sites against each other + spec §7.3 to confirm parity.
3. **Add latency instrumentation** to `build_orchestrator.py`. Implement the admin endpoint last since it reads from existing `llm_calls` rows — no new storage needed.

### Data shape changes
- No new ORM columns, no new Pydantic shapes. The admin endpoint introduces one new response shape:

```python
# server/api/models/llm.py (post-decomposition)

class LlmLatencySummaryStage(BaseModel):
    stage: str          # "router" | "intent" | "synthesis" | "critique"
    count: int
    mean_ms: float
    p50_ms: float
    p95_ms: float


class LlmLatencySummaryResponse(BaseModel):
    turns_analysed: int
    stages: list[LlmLatencySummaryStage]
    p95_total_ms: float
```

- No TS mirror needed (admin-only, no client surface).

### Files to create
- `server/api/models/__init__.py` — re-export everything
- `server/api/models/_shared.py`
- `server/api/models/auth.py`
- `server/api/models/streams.py`
- `server/api/models/llm.py`
- `server/api/blocks/manual_block.py` — shared helper
- `server/api/blocks/__init__.py` — empty package init

### Files to modify
- `server/api/models.py` — deleted (its contents redistribute to the new package).
- `server/api/routers/blocks.py::create_manual_block` — calls the shared helper.
- `server/api/routers/build.py::blocks_commit` — calls the shared helper; BlockIntent persistence + rollback stays.
- `server/api/llm/build_orchestrator.py` — per-stage timing + turn-end log line.
- `server/api/routers/admin.py` — add `list_llm_latency_summary`.
- `docs/conventions.md` — update the "Schema Source of Truth" bullet to cite the new package path.

## Test Cases

**Shared helper**
- **Manual-block happy path via `POST /api/blocks`:** existing behaviour, `BlockRowResponse` identical to pre-refactor.
- **Build-orchestrator commit:** same downstream state — stream registered, configured, snapshot ingested, manual_block marked, pipeline rerun. Plus `block_intents` row.
- **Rollback on pipeline rerun failure:** registry is cleaned up (helper's responsibility).
- **Rollback on BlockIntent persist failure:** happens in `blocks_commit` *after* the helper returned success → stream is rolled back by `blocks_commit` itself (matches the post-M4 fix).

**Decomposition**
- **Every existing import works:** `from server.api.models import InvestigateRequest, BuildConverseRequest, StreamResponse, UsageEventRequest` — no caller change required.
- **Circular-import check:** `from server.api.models.streams import StreamResponse` does not re-import `llm.py`. Each sub-module imports only `_shared` + stdlib.
- **Docstring coverage:** every sub-module starts with a 1-paragraph purpose statement matching its name.

**Latency instrumentation**
- **Log emission:** a Build turn that runs all 4 stages emits one INFO log with 4 timings + total. One that ends at clarifying_question emits 2 timings.
- **WARNING threshold:** artificially force a stage to sleep so total > budget → log level is WARNING, not INFO.
- **Admin endpoint happy path:** after 10 Build turns, `/api/admin/llm-latency-summary` returns per-stage stats with 10-sample counts.
- **Empty state:** zero Build turns → endpoint returns `turns_analysed=0, stages=[]`.
- **Non-admin caller:** 403.

## Out of Scope
- **The actual Stage 1+2 merge.** This spec instruments the decision criteria only; the optimisation itself is a follow-up once telemetry shows a breach.
- **Alembic / migrations.** The models decomposition is pure Python; no schema change.
- **SDK mirroring.** The SDK lives separately and doesn't import `server.api.models`.
- **Prometheus / Grafana / OpenTelemetry.** One log line + one admin endpoint is the whole observability surface — per user's "keep it simple".
- **Refactoring the investigation prompt fenced `engine-command` protocol.** Orthogonal to orchestration housekeeping.
- **Dropping the defensive Build branch in `prompts/__init__.py::build_system_prompt`.** Kept as a safety net until the client is known-good across all user installs.
