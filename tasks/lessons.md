# Lessons

Self-improvement loop. Every time an agent is corrected — by the user, by a failed build, by a review comment — the lesson is recorded here so the same mistake is not repeated. This file is read by `/kickoff`, `/preflight`, and `/refactor` at the start of their context loads.

Format per entry: **Rule.** Then `Why:` (what went wrong, so edge cases can be judged later) and `How to apply:` (when this rule kicks in).

---

## Never modify `server/core/`

**Why:** The core math is the product and the IP. A subtle sign error or off-by-one in variance computation produces plausible-looking numbers that silently destroy PnL. The blast radius of a bad edit here is unbounded, and the bug is very hard to catch in review.

**How to apply:** Any tool call that would `Edit` or `Write` a file under `server/core/` stops immediately. If a bug traces into `server/core/`, document the findings in `tasks/progress.md` and hand off to the human — do not "fix" it. A PreToolUse hook in `.claude/settings.json` enforces this at the tool level, but the rule is the primary authority.

---

## `# HUMAN WRITES LOGIC HERE` stubs are sacred

**Why:** These stubs mark the Manual Brain interface. They tell the human "this is where the math goes." If an LLM removes them during cleanup or refactor (thinking they are dead code), the human loses the map of what still needs to be written.

**How to apply:** During `/cleanup`, `/refactor`, or any sweep that removes "unused" code, explicitly skip lines containing `HUMAN WRITES LOGIC HERE`. If you are tempted to delete one because "the function isn't called anywhere," do not. Check with the human first.

---

## Surgical commits only — never `git add .` or `git add -A`

**Why:** The repo has multiple concurrent agents and hand-edits. A blanket `git add .` can accidentally stage an unrelated file, a stray `.env`, a half-finished experiment, or a file another agent is mid-edit on. Once staged and committed, the damage is visible in history.

**How to apply:** Every commit lists exact paths: `git add path1 path2 path3 && git commit -m "..."`. If you find yourself tempted to use `.` or `-A`, stop and list the paths explicitly. Commit messages follow conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).

---

## Ground domain knowledge in prompts — don't let the LLM derive from first principles

**Why:** The LLM explained variance as "accounting for nonlinearity" instead of the correct "variance is summative, vol is not." When domain facts are left for the model to derive, it invents plausible-sounding but wrong explanations. The trader corrects it, but the correction is lost between sessions — the same mistake repeats.

**How to apply:** Critical domain facts belong in the system prompt (FRAMEWORK section of `core.py`), not in the model's latent knowledge. When the trader corrects the LLM, the correction detector captures it into `domain_kb.json` so it persists. For the most important facts, also hardcode them directly in the prompt — belt and suspenders.

---

## Polars `group_by` without `maintain_order` is non-deterministic across processes

**Why:** During the 2026-04-17 refactor, vectorising `build_blocks_df` produced "DIVERGENCE" against a parquet baseline on first comparison. The actual numerics were identical; only row order differed. Separately running the baseline twice (with no code changes) produced the same row-order drift *and* ULP-level differences in downstream aggregated columns (max abs 8.47e-22 on `edge`, 3.64e-12 on `raw_desired_position`). Root cause: `group_by` without `maintain_order=True` returns groups in hash order, which varies by process. Any aggregation downstream (`sum`, `mean`) inherits that order, and floating-point associativity makes the sums ULP-non-identical.

**How to apply:** When doing numerical-parity checks on pipeline output, sort every DataFrame by all columns before `.equals()`. Treat ULP-level differences (max_abs_diff below 1e-12 absolute, 1e-15 relative) as "same as no-change"; they predate any given refactor. If strict bit-exactness is ever required, pass `maintain_order=True` to `group_by` at the non-determinism source (currently `snap.group_by(sc.key_cols)` inside `build_blocks_df`).

---

## `desired_pos_df` is a forward projection, not historical data

**Why:** `run_pipeline` calls `build_time_grid(start=now, end=expiry)`, so every downstream DataFrame — `block_fair_df`, `block_var_df`, `desired_pos_df` — is a forward-looking sequence from the rerun moment to expiry. The WS ticker advances `state.current_tick_ts` through that range as real wall-clock catches up; the "current" row is always the one at `current_tick_ts`, not the first row of the sorted frame. In the Position chart, forgetting this meant we plotted the unrevealed future (decaying to 0 at expiry) as if it were history, producing a phantom trailing-0 and showing "now" on the left edge instead of the right. Similarly, `pos_sorted.row(0)` (ascending sort) is the rerun_time snapshot, not the current tick — using it for `current_agg` worked only by accident when rerun was close to the call time.

**How to apply:** To get the backward-looking slice for the Position view, filter `timestamp <= current_tick_ts`. For the "current" snapshot row, use the max timestamp `<= current_tick_ts` (i.e., `row(height - 1)` after the slice), not `row(0)`. For forward-looking block decay (Fair / Variance), keep `timestamp >= current_tick_ts`. When real history (surviving across reruns) is needed, a separate per-dimension ring buffer must be added — `desired_pos_df` alone can't provide it.

---

## ECharts `stack:` requires a category axis

**Why:** After switching the pipeline chart's xAxis to `type: "time"` with `[timestamp, value]` pair data, clicking the Fair or Variance tab blanked the entire Workbench. With no ErrorBoundary mounted, ECharts throwing inside its stacker (triggered by `stack: "fair"` on a time axis with nullable series) unmounts the whole React tree. The `stack` feature is only officially supported on a category axis; with time it either produces garbage or throws.

**How to apply:** For any stacked series, use `xAxis.type: "category"` with `data: timestamps` and plain value arrays (aligned by index) on each series. A `formatter` on `axisLabel` gives back the pretty HH:MM display. Reserve `type: "time"` for single-series or non-stacked charts only. Consider mounting an ErrorBoundary above the Workbench so ECharts (or any descendant) crashes don't take down the entire UI.

---

## ECharts types are exported under aliased names

**Why:** `CallbackDataParams` is the internal name in ECharts but it's exported as `DefaultLabelFormatterCallbackParams`. Using the internal name causes TS2460. The tooltip formatter signature also expects `TopLevelFormatterParams` (union of single + array), not just the single variant.

**How to apply:** When typing ECharts callbacks, import `DefaultLabelFormatterCallbackParams` (alias to `CallbackDataParams` locally if desired), and for tooltip formatters accept `CallbackDataParams | CallbackDataParams[]` to match the expected `TopLevelFormatterParams` union. For chart click handlers, use `ECElementEvent` (exported directly).

---

## When "the filter doesn't filter," check the React `key` before the filter wiring

**Why:** The Block Inspector (`EditableBlockTable.tsx`) appeared to ignore its dropdown filters — selecting BTC showed 72 rows instead of 3. Two successive fix attempts (commit `c6e695f`: explicit `filterFn` lambdas + `onColumnFiltersChange` shim; my first fix: switch to uncontrolled `columnFilters`) both changed TanStack wiring plausibly, but neither fixed the visible symptom. A runtime trace (`table.getFilteredRowModel().rows.length === 3` and `table.getRowModel().rows.length === 3`) finally proved the filter *was* running and returning 3 rows — React was just showing 72 anyway. Root cause: `<tr key={row.original.block_name}>`, and `block_name` is **not unique** (e.g. `ema_iv` is reused across every symbol/expiry/space the block is attached to). React's reaction to duplicate keys is "unsupported — children may be duplicated and/or omitted," and the specific symptom on filter-narrow was that stale DOM nodes kept being reused, making the list look unfiltered. The console's "two children with the same key" warning was the load-bearing signal the whole time; I had dismissed it as "unrelated."

**How to apply:** When a list renders wrong after a data-shape change (filter, sort, insert, delete), read the console warnings *first*. A duplicate-key warning is never "unrelated" to a reconciliation bug — it is the bug. The fix is a composite key (e.g. `block_name|stream_name|symbol|expiry|space_id|start_timestamp`) built from whatever tuple is actually unique in the domain. Prefer a small helper (`rowKeyOf(row)`) so the composite is named and reused. Separately, the uncontrolled-TanStack pattern (omit `columnFilters` from `state`, drop the no-op `onColumnFiltersChange`, push dropdown values via `table.getColumn(id)?.setFilterValue(val)` from an effect) is still the cleaner idiom for UI-driven filters — just don't expect it to fix a key-collision bug.

---

## Don't `git stash push -- <path>` with an untracked path in the list

**Why:** Running `git stash push -m "..." -- client/ui server/api/new_file.py` on a tree where `new_file.py` is untracked makes the push fail with "pathspec did not match any file(s) known to git" — and on this repo the subsequent command in the chain (`git stash pop`) fired against the pre-existing top stash, applying someone else's WIP onto the working tree and creating conflicts in unrelated files. The root cause is that `stash push -- <path>` rejects untracked paths by default; the intended way is `git stash push -u -- <paths>` (or adding the new file first).

**How to apply:** Before using `git stash push -- <path>` to isolate a subset of changes, check whether any of those paths are untracked. If so, either `git add -N` them first to make them known to git, or use `git stash push -u` to include untracked files. Never chain a `git stash pop` after a stash push without verifying the push actually succeeded — shell `&&` doesn't save you when the push partially fails. When you inherit a repo with pre-existing entries in `git stash list`, avoid `stash pop` entirely unless you know the top stash is yours.

---

## Weighted-allocation formulas need a uniform fallback when all weights are 0

**Why:** `mvi_total_vol_proportional` distributed `remainder_var` across
eligible inferred blocks by `weight_i = |target_value_i| / Σ |target_value|`.
When every eligible block had `target_value == 0` (an events-only dim before
any event has fired), `total_raw_var == 0` and the `else 0.0` branch made
every share 0 — `inferred_tmv = 0`, `CALC MV = 0`, and the
`Σ_blocks target_mkt · β == aggregate_var` identity broke silently. No
exception, no log, no UI warning — just a zero in the Block Inspector that
only surfaced when the user noticed `Σ market_fair ≠ marketVol`. Same
pathology as the "feature shows zeros but no error" mode in the canonical-key
lesson below: a mathematical identity is *assumed* to hold but the formula
has a degenerate input case that produces plausible numbers.

**How to apply:** Any time an allocation formula is `x_i = remainder · w_i`
with `w_i = f_i / Σ f`, the `Σ f == 0` case must have a deliberate fallback,
not the implicit "every share is 0" that you get from a ternary. Uniform
(`1/n`) is usually the right fallback when the input is a weight and `n > 0`
is guaranteed upstream. If the identity is load-bearing (here: the aggregate
sum equals the user-entered market vol by construction), also consider a
`pytest` assertion at the end of the transform that `Σ target_mkt · β` is
within 1e-9 of `aggregate_var` when `eligible_idx` is non-empty — the
current lack of such a check is why this shipped as a silent zero.

---

## Canonicalise identity keys at a single boundary, not at each lookup site

**Why:** On 2026-04-20 the aggregate-market-value lookup silently returned nothing. The feeder (deribit-pricer) sent tz-aware ISO strings (`"2026-03-28T00:00:00+00:00"`) because its `MetricCell.expiry` is a Pydantic `datetime` with `time_zone="UTC"`. The server stored that string verbatim. The pipeline-side lookup (both `market_value_inference.py` and the new `positions_at_tick` marketVol join) produced naive ISO (`"2026-03-28T00:00:00"`) from the Polars naive-Datetime expiry column. The dict keys never matched — not with Pydantic catching it, not with a test catching it, no error logged. The engine's aggregate-variance inference had been silently no-op'ing since the feeder's format choice. The new UI tab only surfaced the bug because its zero values were user-visible. Each call site had its own ad-hoc `.isoformat() / str()` normalisation, and each one subtly disagreed on tz handling, microseconds, and date-vs-datetime.

**How to apply:** For any identity key that crosses layers (feeder → Pydantic → store → pipeline → serializer), route every producer and every consumer through one canonicaliser. Put it in a small module (`server/api/expiry.py`) and wire it into the Pydantic `field_validator` on every model carrying the field — Pydantic runs on every ingest, so downstream code can't forget. Ad-hoc `.isoformat()` at the call site is a smell; if you see two sites doing the same normalisation slightly differently, consolidate before adding a third. When the silent-miss surfaces as "feature shows zeros but no error," suspect format drift across a dict-key boundary before blaming the feature code.
