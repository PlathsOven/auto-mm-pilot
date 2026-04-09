# Progress

Mid-session handoff notes. When a task is not finished at the end of a session, or when context is about to be compressed, write a handoff here so the next session can pick up cleanly.

## Status

## Convergence refactor (spec-refactor-convergence.md) — 2026-04-09

**Goal:** Execute all 4 phases of `tasks/spec-refactor-convergence.md` — pattern convergence + root-cause cleanup — on branch `generalisation`, single PR at the end.

**Approach:** Work phase by phase, strictly in spec order. No re-audit. Verification (`typecheck` + `compileall`) between phases. One commit per phase.

**Steps done:**
- [x] Phase 1 — Stop the bleeding: providers memoized, `asset` → `symbol` unified on the wire and in consumers, `transformApi.ts` routed through `apiFetch`, stale `AGENTS.md` refs updated to `CLAUDE.md` in `docs/architecture.md` + `docs/using-agents.md`, dead `DailyWrap.tsx` row removed from the Key Files table.

**Discovered during Phase 1:** `client/ui/src/components/LlmChat.tsx:47` had a pre-existing unused `isUser` variable that failed `tsc --noEmit`. Not introduced by the refactor — verified against a clean stash of the baseline. Removed it inline to unblock Phase 1 verification (trivial 1-line fix); logged here as the single off-spec delta so reviewers are aware.

**Steps done (continued):**
- [x] Phase 2 — Tighten API boundary: `SnapshotRow` and `CellContext` Pydantic submodels replace `dict[str, Any]` at boundary; `ClientWsOutboundFrame` discriminated union added; central `@app.exception_handler(Exception)` installed; SSE error path sanitized (no stack traces reach the trader); client `ApiError` class in `api.ts`; pipeline-timeseries endpoint emits camelCase; client `types.ts` interfaces rewritten to match; all `PipelineChart.tsx` + `useStreamContributions.ts` field accesses updated; decision log entry appended.

**Current status:** Phase 2 committed. Both verification commands pass clean. Ready for Phase 3.

**Next step:** Commit Phase 2, then start Phase 3 (server decomposition).

- [x] Phase 3 — Server decomposition: completed separately per `tasks/spec-phase3-server-decomposition.md`.

- [x] Phase 4 — Client decomposition: decomposed `PipelineChart.tsx` (779 → ~150 LOC container + 3 extracted modules), `DesiredPositionGrid.tsx` (425 → ~280 LOC + 2 hooks), narrowed `AnatomyCanvas.tsx` WS subscription via `useWebSocketPositionCount`, removed `localSteps` shadow state, exposed `setSteps` from `TransformsProvider`, fixed abort-signal race in `useStreamContributions`, fixed exhaustive-deps in `StreamTable`, hoisted all magic numbers to `constants.ts`, cancelled edit on timeframe switch.

**Current status:** All 4 phases committed on `generalisation`. Ready for doc-sync and PR.


## Handoff Note Format

When writing a handoff, use this template:

```markdown
## <Task name> — <YYYY-MM-DD>

**Goal:** <one sentence — the outcome the user wants>

**Approach:** <one paragraph — the chosen strategy, not all alternatives>

**Steps done:**
- [x] <concrete step> — <file path or artifact>
- [x] <concrete step>

**Current status:** <what state the repo is in right now — staged? committed? broken tests?>

**Blockers:** <anything that needs a human decision or is waiting on an external>

**Next step:** <the very next thing to do on resume>
```
