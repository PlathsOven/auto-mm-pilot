# Lessons

Self-improvement loop. Every time an agent is corrected — by the user, by a failed build, by a review comment — the lesson is recorded here so the same mistake is not repeated. This file is read by `/kickoff`, `/preflight`, and `/refactor` at the start of their context loads.

Format per entry: **Rule.** Then `Why:` (what went wrong, so edge cases can be judged later) and `How to apply:` (when this rule kicks in).

---

## Display format ≠ identity key — send both on the wire

**Why:** 2026-04-24 — the expiry-correlation apply-draft flow "worked" (draft wrote to the store, WS tick rerendered positions) but every cell stayed unchanged. Root cause: `DesiredPosition.expiry` on the wire is DDMMMYY for display (`ws_serializers.format_expiry`), which **discards time-of-day**. The client's correlation UI used `p.expiry` as the correlation axis identity and sent DDMMMYY to `POST /api/correlations/expiries/apply-method`. The server canonicalised those labels to **midnight ISO** (`"2026-03-27T00:00:00"`) via `canonical_expiry_key("27MAR26")`. But the pipeline's actual expiry column is **08:00 UTC** (crypto options convention). Stage H's `materialise_matrix(entries, labels)` call then found zero key matches between midnight-ISO entries and 08:00-ISO labels, so `C_e_draft` silently materialised to the identity. `C_e_draft⁻¹·E = E` — the draft solve produced the same positions as the committed solve, and the editor's Σ|Δ| summary read "no visible position change." The symptom was identical to a dead feature; only a diagnostic log exposing `sample_draft_key` vs `sample_expiry_label` side-by-side made the 00:00 vs 08:00 mismatch visible.

**How to apply:** When a field does double duty on the wire (trader reads it + client code joins on it), split it: one field optimised for display (`expiry: "27MAR26"`), one carrying the canonical identity key (`expiry_iso: "2026-03-27T08:00:00"`). The identity field must round-trip through the same canonicaliser every producer and every consumer uses — no lossy reformatting in between. If you see a "display format" string being used as a map key downstream, that's the bug. DDMMMYY is a display format; ISO (with time-of-day) is the identity. Stage H's key-miss is a *silent* degeneration — the solve produces plausible-looking output (the committed solve, repeated), so no error fires. Add a WARNING-level log whenever a lookup boundary materialises to the identity by default (e.g. `materialise_matrix`) so the next instance of this bug class surfaces on first inspection. Related to but more specific than the earlier "Canonicalise identity keys at a single boundary" lesson — that one covers feeder/store mismatches; this one covers the *display/identity* split at the wire layer.

---

## Memoize hook return values that callers put in useEffect deps

**Why:** 2026-04-24 — the BlockDrawer's applies-to chips appeared to be un-clickable. Root cause: `useBlockDraftSubmit` returned `clearError: () => setError(null)` as a fresh inline arrow every render. The consuming `BlockDrawer` listed `clearError` in the dep array of its draft-reset useEffect, so the effect ran on *every* render — any successful `setDraft` call (from clicking a chip, typing in a field) immediately re-rendered, which re-ran the effect, which called `setDraft({ ...EMPTY_DRAFT, ... })` and wiped the just-applied edit. Typing-based fields sometimes appeared to work because React batching could make the flash brief enough to miss; click-based state (the applies-to chips) simply looked dead. Sibling `submit` was already `useCallback`-memoized, which is why *it* didn't break; the bug was that `clearError` had been skipped.

**How to apply:** Any value returned from a custom hook that a caller is likely to put in a `useEffect` dep array must be reference-stable. Setters from `useState` already are. Arrow-wrappers around setters (`clearError`, `toggleX`, `resetY`) must be wrapped in `useCallback` with correct deps. If a hook returns multiple callables, memoize them individually rather than recreating the wrapper object — the object itself can change reference each render without breaking callers as long as the individual fields are stable. When debugging a React component where user input seems to vanish, audit every `useEffect` dep for unstable references *first* — it's the single most common cause.

---

## Extending an enum / literal union isn't free — grep every iteration site

**Why:** 2026-04-24 — Stage H's M6 appended `"correlations"` to `PIPELINE_ORDER` in `anatomyGraph.ts` so the new node would slot into the DAG. Typecheck + build passed green. Anatomy came up blank at runtime. Root cause: `AnatomyCanvas.tsx:310` had a presence gate `PIPELINE_ORDER.every((k) => steps[k])` — since `steps` comes from the server's transform catalog and `correlations` is a pseudo-step without a server-registered transform, the gate failed and the canvas returned `null`. Typecheck was no help — `steps: Record<string, TransformStep>` accepts any string key, so `steps["correlations"]` is `TransformStep | undefined`, and `every(...steps[k])` is valid TS either way.

**How to apply:** When adding an element to an enum / literal union / ordered-keys array that flows into a `.switch`, `.reduce`, `.every`, `.filter`, or record lookup somewhere downstream, grep for every iteration site and confirm the new element is intentionally handled. Typecheck catches `switch` exhaustiveness but not `.every(steps[k])`-style truthiness gates or `steps[k] ?? fallback` short-circuits. The gate sites to check for any ordered-pipeline-keys extension: `buildAnatomyGraph`, `AnatomyCanvas` pre-render gates, `TransformsProvider` hydration, and any docs / stack tables that enumerate the pipeline steps.

---

## Manual Brain Rule lifted 2026-04-21 — `server/core/` is a normal LLM lane

**Why:** Between 2025 and 2026-04-20, LLMs were barred from editing any file under `server/core/` (the "Manual Brain Rule"). The bugs that actually traced into that lane during that window were one-liner type casts and VAR_FLOOR bounds — trivial fixes whose handoff to a human cost far more than a mis-edit would have. The rule was producing queue time, not safety. The 4-space pipeline rewrite (`tasks/spec-pipeline-4-space.md`) was the forcing function. See `docs/decisions.md` 2026-04-21 for the full reasoning.

**How to apply:** `server/core/` is now edited normally — plan, edit, typecheck, commit. No special stubs, no `# HUMAN WRITES LOGIC HERE` markers, no PreToolUse hook. The usual rails still apply: `/kickoff` before non-trivial work, surgical commits, human review on every diff. Numerical correctness in the pricing math is sensitive regardless of who authors it — reviewers should exercise extra care on sign conventions, dtype casts, division-by-near-zero, and any identity the aggregation preserves.

---

## Surgical commits only — never `git add .` or `git add -A`

**Why:** The repo has multiple concurrent agents and hand-edits. A blanket `git add .` can accidentally stage an unrelated file, a stray `.env`, a half-finished experiment, or a file another agent is mid-edit on. Once staged and committed, the damage is visible in history.

**How to apply:** Every commit lists exact paths: `git add path1 path2 path3 && git commit -m "..."`. If you find yourself tempted to use `.` or `-A`, stop and list the paths explicitly. Commit messages follow conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).

---

## Ground domain knowledge in prompts — don't let the LLM derive from first principles

**Why:** The LLM explained variance as "accounting for nonlinearity" instead of the correct "variance is summative, vol is not." When domain facts are left for the model to derive, it invents plausible-sounding but wrong explanations. The trader corrects it, but the correction is lost between sessions — the same mistake repeats.

**How to apply:** Critical domain facts belong in the system prompt (FRAMEWORK section of `core.py`), not in the model's latent knowledge. When the trader corrects the LLM, `server/api/llm/feedback_detector.py` captures the correction into the per-user `domain_kb_entries` SQLite table so it persists (the detector subsumes the older `correction_detector.py` removed in the 2026-04 LLM orchestration redesign; the file-based `domain_kb.json` was migrated to per-user storage 2026-04-24). For the most important facts, also hardcode them directly in the prompt — belt and suspenders.

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

**How to apply:** For stacked series with nullable data, use `xAxis.type: "category"` with `data: timestamps` and plain value arrays (aligned by index) on each series. A `formatter` on `axisLabel` gives back the pretty HH:MM display. Consider mounting an ErrorBoundary above the Workbench so ECharts (or any descendant) crashes don't take down the entire UI.

**Stack IS compatible with `type: "time"` if every value is numeric** (no nulls, no undefineds — zero-default before passing to ECharts). The Pipeline Contributions tabs (`client/ui/src/components/PipelineChart/contributionsOptions.ts`) use `xAxis.type: "time"` + `stack: "contrib"` + `areaStyle.opacity: 0.45` on null-free tuple data, and the stacker renders translucent bands correctly across a proportional time axis. The original crash was the stacker's null-handling, not the time-axis pairing itself. When the design requires proportional time (e.g. a sparse ring-buffer segment stitched to a dense forward grid), prefer this to the category-axis workaround; when nulls are unavoidable, fall back to category.

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
