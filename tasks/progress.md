# Progress

Mid-session handoff notes. When a task is not finished at the end of a session, or when context is about to be compressed, write a handoff here so the next session can pick up cleanly.

## Status

## Manual Brain handoff — Position chart initial-spike artifact — 2026-04-20

**Goal:** Eliminate the huge negative value (~-300k on a $1000 default-bankroll
setup, 300× Kelly cap) the Position chart renders at the left edge before it
stabilises at ~-25k. Separate, sibling issue to the "blips to 0" artifact —
blips were fixed api-side by filtering pipeline sentinel-zero rows out of the
ring buffer (commit pending on `PlathsOven/desired-pos-spikes`). The spike is
not a sentinel, so the api-layer filter does not address it.

**Where:** `server/core/pipeline.py:252-262` — position-sizing block:
```python
VAR_FLOOR = 1e-18
desired_pos_df = smoothed_df.with_columns(
    pl.when(pl.col("var").abs() < VAR_FLOOR).then(0.0)
    .otherwise(pos_fn.fn(pl.col("edge"), pl.col("var"), bankroll, **pos_params))
    .alias("raw_desired_position"),
    pl.when(pl.col("smoothed_var").abs() < VAR_FLOOR).then(0.0)
    .otherwise(pos_fn.fn(pl.col("smoothed_edge"), pl.col("smoothed_var"), bankroll, **pos_params))
    .alias("smoothed_desired_position"),
)
```
Pos_fn here is Kelly: `edge * bankroll / var`. When `var` is just above
`VAR_FLOOR` (say 1e-15..1e-10) the division produces positions orders of
magnitude above `bankroll`. The sentinel only catches variances strictly below
the floor, so anything just above the floor flows through unbounded.

**Why the history buffer cannot hide it:** `build_from_desired_pos_df`
captures one row per pipeline rerun, always at `timestamp = rerun_time` (the
first row of the forward grid). A rerun with `var` in the bad-but-not-floored
band writes a genuine outlier into history. Api-layer magnitude clamping
would be arbitrary policy — the fix belongs in the Kelly step.

**Blockers:** Manual Brain Rule — `server/core/pipeline.py` and
`server/core/transforms/position_sizing.py` are human-only. PreToolUse hook
enforces this.

**Next step (human):** pick one of
  1. Raise `VAR_FLOOR` high enough that Kelly output is bounded (requires
     deciding what "degenerate variance" means in the domain, not just
     numerically).
  2. Bound the Kelly output directly in
     `server/core/transforms/position_sizing.py` — e.g. clamp
     `|position| ≤ K * bankroll` for a small K, since the fractional-Kelly
     assumption already implies this.
Run `python -m compileall server/ -q` after.

---

## Manual Brain handoff — SDK integration audit Section 4.3 — 2026-04-19

**Goal:** Stop the `pl.vstack` dtype crash when mock and user-supplied streams
coexist with different-typed `exponent` values (Int32 vs Float64).

**Where:** `server/core/pipeline.py:124` —
```python
pl.lit(sc.exponent).alias("exponent"),
```
currently literal-infers the Polars dtype from `sc.exponent` at each call.
When one stream's `StreamConfig.exponent` is an `int` (e.g. the mock
scenario's `exponent=2`) and another is a `float` (SDK-supplied
`exponent=1.0`), `pl.concat(parts)` raises on dtype mismatch. Suggested fix:

```python
pl.lit(sc.exponent).cast(pl.Float64).alias("exponent"),
```

**Why this is parked:** `server/core/pipeline.py` is HUMAN ONLY (Manual
Brain Rule, `CLAUDE.md` + `tasks/lessons.md`). An LLM must not edit this
file; the rule is enforced by a PreToolUse hook in `.claude/settings.json`.

**Blockers:** none — one-line cast, surrounded by tested code. Reviewer
should also verify whether `sc.scale` / `sc.offset` need the same treatment
for safety (they are likely already always `float` in practice but the
same literal-inference risk applies).

**Next step:** human makes the one-line cast, runs
`python -m compileall server/ -q`, and runs the SDK integration test added
alongside the Section 4 SDK PR to confirm the vstack no longer raises.

---

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

**Current status:** All 4 phases committed on `generalisation`. Doc-sync completed 2026-04-10. Ready for PR.


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
