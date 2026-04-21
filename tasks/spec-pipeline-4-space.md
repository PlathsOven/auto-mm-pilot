# Spec: Pipeline 4-Space Revision

Authored 2026-04-21 on branch `PlathsOven/pipeline-spaces`.

## Overview

Rewrite the pipeline around an explicit 4-space model — **risk / raw / calculation / target** — with a dedicated `calc_to_target` transform step and a risk-space aggregation stage that was previously collapsed into block-level summing. The math becomes easier to explain ("why do blocks on the same space average, but spaces sum?"), easier to extend (non-options assets get a different `calc_to_target` default), and correctly handles the base-vol-vs-event-vol separation the current sum-only model conflates. The Workbench surfaces stay in the same shape — only the numbers and schema move.

This spec is self-contained: a new agent session should be able to execute it end-to-end with only this file + the repo open.

## Requirements

### User stories

- As a **desk head (primary trader)**, when I have overlapping realized-vol and event-vol blocks on the same `(symbol, expiry)`, I want the engine to treat them as independent risk spaces that sum after within-space averaging, so the position size reflects the union of risks rather than a confidence-weighted double-count.
- As a **desk head**, when I author a block, I want to pick which `(symbol, expiry)` pairs it applies to (multi-select; default all), so a single FOMC event block covers every dim at once instead of requiring N duplicates.
- As a **desk head**, I want the `calc_to_target` choice to be a global setting visible in the Anatomy graph, so I see one "variance → annualised vol" conversion rather than per-block unit fields.
- As an **operator**, I want mock-mode (`POSIT_MODE=mock`) to still boot a populated Workbench, so a fresh deploy demonstrates end-to-end flow before any real streams are configured.

### Acceptance criteria

- [ ] Pipeline returns frames with the new schema at every stage (see "Intermediate frame schemas" below).
- [ ] In the mock scenario, the Workbench grid populates without `NaN` or `Inf` in any cell; `edge`, `variance`, `desired_pos`, `smoothed_desired_pos` all finite.
- [ ] Pipeline Chart series are smooth — no spike larger than 5× the median absolute value of the series across the full forward window. (The known Kelly `VAR_FLOOR` spike in `tasks/progress.md` is a separate fix and may remain.)
- [ ] Blocks with `applies_to = [(symbol, expiry), …]` produce one row per matched dim in `blocks_df`; `applies_to = None` fans out to every pipeline dim.
- [ ] A block whose `applies_to` names a dim not in the current universe **raises at ingest** with a clear error message — never silently drops.
- [ ] A risk space that happens to contain **zero blocks** at time `t` is **omitted** from the space-level row set at that `t` (no zero row, no pollution of the `(symbol, expiry)` sum).
- [ ] Per-block market value fallback chain (in order of precedence, first match wins):
  1. Block sets `market_value` in raw units → convert via raw→calc → spread over time via same time-distribution as fair.
  2. Aggregate per-`(symbol, expiry)` market value is set → total-vol-proportional inference distributes it to this block's **space** (`market_value_inference.py`, unchanged).
  3. Otherwise passthrough: `market(t) = fair(t)` per block → after aggregation, `total_market_fair = total_fair` → edge = 0 by construction.
- [ ] Block-level market value **always wins** over both aggregate inference and passthrough, regardless of whether the block is the sole member of its space.
- [ ] `calc_to_target` is a global transform step with exactly one selected transform. Default `annualised_sqrt` applies the same forward map to `fair`, `variance`, and `market` columns (user's simplification — no Jacobian / Taylor).
- [ ] Edge is computed **after** `calc_to_target` is applied to `total_fair` and `total_market_fair` (so edge lives in target space directly, linear in PnL).
- [ ] Forward smoothing (EWM with `half_life_secs`) runs on the target-space `edge` and `var` columns. No change to `smoothing.py` math.
- [ ] Desired position: default `continuous_kelly` = `smoothed_edge * bankroll / smoothed_var` on target-space smoothed columns. `raw_desired_position` uses non-smoothed target-space columns. Both paths keep the existing `VAR_FLOOR = 1e-6` sentinel.
- [ ] `python -m compileall server/ -q` clean.
- [ ] `npm --prefix client/ui run typecheck` clean.
- [ ] `npm --prefix client/ui run build` succeeds.
- [ ] Policy flip: the Manual Brain Rule is removed end-to-end — `CLAUDE.md`, the PreToolUse hook in `.claude/settings.json`, every `.claude/commands/*.md` + `.windsurf/workflows/*.md`, `docs/architecture.md`, `tasks/lessons.md`, `docs/using-agents.md`. One commit, before the `server/core/` math commits, so the hook doesn't fire during the rewrite.

### Performance

Hot path: runs on every pipeline rerun (~1/sec WS ticker). Row counts today: O(blocks) ≈ 10² × `applies_to` fan-out O(dims) ≈ 10¹ × O(1440) timestamps ≈ 10⁶ Polars rows per run. Inside today's latency budget; no new caching layer.

### Security

No new endpoints, no new auth surface. Existing admin / user / stream permissions gate block creation and mutation via existing routers. Validation errors for bad `applies_to` return HTTP 400 with the offending dim named, confined to the HTTP response body — never broadcast on WS.

---

## The 4-Space Model

| Space | What | Example (options) | Transform OUT |
|-------|------|-------------------|---------------|
| **Risk** | Constituent risk dimension. Independent across spaces. | `base_vol`, `event_vol` | (identity; grouping key only) |
| **Raw** | Whatever units the block is authored in. | `%`, `SD`, `variance`, `annualised vol` | `unit_conversion` step — existing |
| **Calculation** | Linear in what we price. | `variance units` | `calc_to_target` step — NEW |
| **Target** | The actual price axis. Linear in PnL. | `annualised vol` | (terminal) |

`risk_dimension_cols` (today: `["symbol", "expiry"]`) remains the server-wide dim universe via `RISK_DIMENSION_COLS`.

---

## Pipeline Stages (End to End)

```
StreamConfig[]
  │
  ▼ (A) block expansion  — respects applies_to; fans out one row per matched dim
blocks_df
  │    columns: block_name, stream_name, space_id, symbol, expiry,
  │             raw_fair, raw_market, var_fair_ratio,
  │             scale, offset, exponent,  -- raw→calc params
  │             annualized, temporal_position, decay_end_size_mult,
  │             decay_rate_prop_per_min, start_timestamp,
  │             market_value_source ∈ {"block","aggregate","passthrough"}
  │
  ▼ (B) raw→calc + time-distribution
block_series_df      -- one row per (block × dim × timestamp), in CALC space
  │    columns: symbol, expiry, block_name, stream_name, space_id,
  │             timestamp, dtte,
  │             fair, var, market           -- all in calc space
  │
  ▼ (C) risk-space arithmetic mean over blocks with same space_id
space_series_df      -- per (symbol, expiry, space_id, timestamp), CALC space
  │    columns: symbol, expiry, space_id, timestamp,
  │             space_fair, space_var, space_market_fair
  │    notes: space rows OMITTED at timestamps where that space has no live blocks
  │
  ▼ (D) sum across risk spaces within (symbol, expiry)
dim_calc_df          -- per (symbol, expiry, timestamp), CALC space
  │    columns: symbol, expiry, timestamp,
  │             total_fair_calc, total_var_calc, total_market_fair_calc
  │
  ▼ (E) calc→target forward map  -- default annualised_sqrt: sqrt(x_fwd(t) / T_years(t))
dim_target_df        -- per (symbol, expiry, timestamp), TARGET space
  │    columns: symbol, expiry, timestamp,
  │             total_fair, total_market_fair, var,      -- target space
  │             edge = total_fair - total_market_fair
  │
  ▼ (F) forward EWM smoothing on edge & var
smoothed_df
  │    columns: ...above + smoothed_edge, smoothed_var
  │
  ▼ (G) position sizing (default continuous_kelly)
desired_pos_df       -- final output, unchanged schema from today
       columns: symbol, expiry, timestamp,
                total_fair, total_market_fair, edge, var,
                smoothed_edge, smoothed_var,
                raw_desired_position, smoothed_desired_position
```

---

## Stage-by-Stage Specification

### Stage A — Block expansion

Per `StreamConfig`:
1. Load the deduplicated snapshot (same `sort("timestamp").group_by(key_cols).agg(last)` as today).
2. Compute `block_name` = `stream_name + "_" + extra_key_cells_joined` (unchanged).
3. Compute `space_id` via existing rules: `space_id_override > "shifting" > "static_<formatted start>"` (unchanged).
4. Run the selected `variance` transform to add a `raw_var` scalar column per row. Default `fair_proportional`: `raw_var = var_fair_ratio · |raw_fair|`.
5. Resolve `applies_to`:
   - `None` → expand to every pair in the current `(symbol, expiry)` dim universe (the union across all streams after steps 1-3).
   - List → validate every entry is in the dim universe; raise `ValueError` with the offending pair(s) on mismatch. (HTTP 400 at the router layer.)
   - Cross-join block row × `applies_to` list → one row per `(block, dim)` pair in `blocks_df`.
6. Keep `raw_value` as `raw_fair`; keep `market_value` (if set on the snapshot row) as `raw_market`, else `None`.
7. `market_value_source` column:
   - `"block"` if `raw_market is not None`
   - `"aggregate"` if the aggregate market-value entry for that `(symbol, expiry)` is set
   - `"passthrough"` otherwise
   (Used downstream by the market-value step to pick the right path per row.)

**Gotcha to fix during rewrite:** per `tasks/progress.md` (2026-04-19 handoff), today's `pl.lit(sc.exponent).alias("exponent")` crashes `vstack` when one stream has `exponent: int` and another `exponent: float`. Cast every stream-level param to `pl.Float64` at emission: `pl.lit(sc.exponent).cast(pl.Float64).alias("exponent")` — and same for `scale`, `offset`, `var_fair_ratio`, `decay_*`.

### Stage B — Raw→calc + time distribution

Per-block, per-timestamp:

1. **Raw-variance scalar** is already computed at the end of Stage A by the selected `variance` transform (default `fair_proportional`: `raw_var = var_fair_ratio · |raw_fair|`). Carried into B as a column on `blocks_df`.
2. **Apply `unit_conversion` transform** (the raw→calc step — today's `affine_power`, default `(scale * raw + offset)^exponent`) identically to `raw_fair`, `raw_var`, and `raw_market`:
   - `calc_fair_total = unit_conversion(raw_fair)`
   - `calc_var_total  = unit_conversion(raw_var)`
   - `calc_market_total = unit_conversion(raw_market)` — only for blocks with `market_value_source == "block"`; others fall through to step 4 below.
3. **Time-distribute** each `*_total` into a per-timestamp instantaneous series such that `Σ_t instant(t) = total`. Uses the existing temporal-fair-value transform (default `standard` in `fair_value.py`) verbatim, but applied to each of `{fair, var, market}` independently. Output column names in `block_series_df`: `fair`, `var`, `market`.
4. **Market passthrough or inference rows**: for blocks without their own `raw_market`:
   - If `market_value_source == "passthrough"`, set `market(t) = fair(t)` (so the block contributes zero edge after aggregation).
   - If `market_value_source == "aggregate"`, leave `market(t)` as NULL at this stage; stage C's mean is computed across non-null mask, and stage D's market-value-inference step attaches a per-space curve proportional to `space_fair(t)` scaled so `Σ_t space_market_fair / T_years = aggregate_total_vol²`. This is today's `market_value_inference.py` logic, unchanged in mechanism but now operating on `space_series_df` instead of `block_var_df`.

### Stage C — Risk-space arithmetic mean

Group `block_series_df` by `(symbol, expiry, space_id, timestamp)`. Aggregate:
- `space_fair      = mean(fair)        over blocks with fair is not null`
- `space_var       = mean(var)         over blocks with var  is not null`
- `space_market_fair = mean(market)    over blocks with market is not null` — for rows where every block has `market_value_source ∈ {"block","passthrough"}`. For rows where any block is `"aggregate"`, leave `space_market_fair` null — stage D's inference fills it.

**Omit zero-block space rows.** If a space has zero live blocks at a given timestamp (e.g. their windows have ended), do not emit a row for that `(space_id, timestamp)`. Implementation: `group_by` + the filter that drops empty groups naturally yields this as long as stage B only emits rows for timestamps the block is live at (matches today's `fair_value` transform — it emits zero before `start_timestamp` and zero after `end_timestamp` decay; for the new spec, filter those out rather than emit zero so the mean is correct).

### Stage D — Sum across risk spaces + market-value inference

1. **Market-value inference.** Run the existing `market_value_inference` transform on `space_series_df` (it already collapses to per-space rows; the only change is input frame name). This fills `space_market_fair` for any rows still null (the `"aggregate"` case) and leaves the `"block"` / `"passthrough"` rows unchanged.
2. **Sum across spaces** within `(symbol, expiry, timestamp)`. Output `dim_calc_df` with `total_fair_calc`, `total_var_calc`, `total_market_fair_calc`.

### Stage E — Calc → target forward map

Apply the selected `calc_to_target` transform. Default `annualised_sqrt`:
```
forward(x, t, expiry) = sqrt(x_fwd(t) / T_years_remaining(t)) · VOL_POINTS_SCALE
  where x_fwd(t) = Σ_{t' ≥ t, same (symbol, expiry)} x(t')
        T_years_remaining(t) = (expiry - t) / SECONDS_PER_YEAR
        VOL_POINTS_SCALE = 100.0
```
Applied identically to `total_fair_calc`, `total_var_calc`, `total_market_fair_calc`. Result columns (renamed to drop the `_calc` suffix): `total_fair`, `var`, `total_market_fair`.

Then compute `edge = total_fair - total_market_fair` in target space.

**Note — this is the same math today's pipeline runs in the ad-hoc VP block at `pipeline.py:264-307`.** The refactor formalises it as a named registry step. Numerically identical to today for options (default `exponent=2` + default `annualised_sqrt`).

Transform library also pre-registered:
- `identity` — `forward(x, t, expiry) = x` (calc-space already is target-space).
- `annualise_only` — `forward(x, t, expiry) = x_fwd(t) / T_years_remaining(t)` (variance-point target for users who want it).

When `T_years_remaining(t) <= 0` (at/after expiry), return `0.0` to avoid `sqrt(.../0)` — matches today's guard.

### Stage F — Forward smoothing

Existing `smoothing` step verbatim. Input `dim_target_df`, output adds `smoothed_edge`, `smoothed_var`. No math change.

### Stage G — Position sizing

Existing `position_sizing` step verbatim, including the `VAR_FLOOR = 1e-6` sentinel and the branch for `smoothed_var`. No math change.

---

## Intermediate Frame Schemas (Authoritative)

These are the keys in the dict returned from `run_pipeline`. Downstream consumers (`server/api/ws_serializers.py`, `server/api/routers/pipeline.py`) are rewired to read from them.

| Key | Replaces | Columns |
|-----|---------|---------|
| `blocks_df` | same name today | (see Stage A list) + `applies_to` echo per row as a cosmetic |
| `block_series_df` | today's `block_fair_df` + `block_var_df` unified | `symbol, expiry, block_name, stream_name, space_id, timestamp, dtte, fair, var, market, var_fair_ratio, market_value_source` |
| `space_series_df` | today's `space_agg_df` (post-inference) | `symbol, expiry, space_id, timestamp, space_fair, space_var, space_market_fair` |
| `dim_calc_df` | new — intermediate | `symbol, expiry, timestamp, total_fair_calc, total_var_calc, total_market_fair_calc` |
| `dim_target_df` | new — post calc→target | `symbol, expiry, timestamp, total_fair, total_market_fair, var, edge` |
| `desired_pos_df` | same name today | target-space columns: `total_fair, total_market_fair, edge, var, smoothed_edge, smoothed_var, raw_desired_position, smoothed_desired_position` |

Remove today's `time_grid` from the return dict (it's an implementation detail — no external consumer touches it; confirmed via grep of `ws_serializers.py` + `routers/`).

---

## Files

### Transform registry (additions)

`server/core/transforms/registry.py`:
```python
_define_step("risk_space_aggregation",
             contract_doc="(block_series_df, risk_dimension_cols, **params) -> pl.DataFrame",
             infrastructure_params=["block_series_df", "risk_dimension_cols"])

_define_step("calc_to_target",
             contract_doc="(col: pl.Expr, tte_years: pl.Expr, **params) -> pl.Expr",
             infrastructure_params=["col", "tte_years"])
```

### New files

- `server/core/transforms/risk_space_aggregation.py`
  - `arithmetic_mean` (default) — per Stage C above.
  - Optional second variant: `confidence_weighted_mean` — `weight_i = 1/var_fair_ratio_i`. Register for forward compatibility; default stays `arithmetic_mean`.
- `server/core/transforms/calc_to_target.py`
  - `annualised_sqrt` (default) — per Stage E.
  - `identity`.
  - `annualise_only`.

### Modified files — `server/core/`

- `config.py`
  - `StreamConfig.applies_to: list[tuple[str, str]] | None = None` field.
  - Docstring clarification: `scale`, `offset`, `exponent` are **raw→calc** params, not raw→target.
- `pipeline.py`
  - Rewrite `run_pipeline` to orchestrate stages A→G via registry lookups. Delete the hardcoded VP block at today's lines 264-307 — it moves into `calc_to_target.annualised_sqrt`.
  - Apply the Int32/Float64 cast fix during the rewrite (see Stage A gotcha).
  - Change returned dict keys to match the Intermediate Frame Schemas table above.
  - Delete `build_time_grid` helper from the public return; it's still called internally.
- `transforms/fair_value.py`
  - Generalise the existing temporal-distribution logic to distribute a generic `total` column (not just `target_value`) so Stage B can apply it to fair, var, and market in one pass.
  - Rename the output column `fair` → keep, but add sibling output columns `var` and `market` (or restructure so the function is called three times with different `total_col` argument — implementer's choice).
- `transforms/variance.py`
  - **Semantic shift, not deletion**: the raw_fair → raw_var mapping remains pluggable (different epistemic claims — proportional, constant, squared — are still legitimate). Move the step from "runs on `block_fair_df` in calc space" to "runs on `blocks_df` in raw space, at the end of Stage A before raw→calc". Rewrite the three existing transforms to operate on `raw_fair`:
    - `fair_proportional` (default): `raw_var = |raw_fair| · var_fair_ratio`
    - `constant`: `raw_var = var_fair_ratio`
    - `squared_fair`: `raw_var = raw_fair² · var_fair_ratio`
  - Registry contract becomes `(blocks_df, **params) -> pl.DataFrame`, adding a scalar `raw_var` column per block row. `variance` / `variance_params` stay in `TransformConfigRequest`.
- `transforms/aggregation.py`
  - Keep `sum_spaces` as the default. Update the docstring: input is now `space_series_df`, semantics are "sum across risk spaces within `(symbol, expiry)`". Output columns renamed to `*_calc` per schema table.
- `transforms/market_value_inference.py`
  - Signature change: input is `space_series_df` (already per-space from Stage C), not `block_var_df`. Internally, drop the `_space_aggregate` helper since aggregation has already happened. Fill the `space_market_fair` column for rows that are still null (the `"aggregate"` source); leave `"block"` + `"passthrough"` rows untouched.
- `transforms/unit_conversion.py` — no body change. Docstring update: this is the raw→calc step.
- `transforms/smoothing.py`, `position_sizing.py`, `decay.py` — no change.
- `mock_scenario.py`
  - Keep `var_fair_ratio`, `decay_end_size_mult`, `decay_rate_prop_per_min`, `annualized`, `temporal_position` values as-is.
  - Add no `applies_to` (relies on default `None`).
  - Adjust any numeric assertions in prototyping notebooks that pin old-schema numbers — none expected in `prototyping/`, but grep to confirm.
- `serializers.py`
  - Flush any references to `target_value` — it's gone. Emit per-space rows keyed as `space_series_df` for LLM prompt injection.

### Modified files — `server/api/`

- `models.py`
  - `BlockConfigPayload` + `AdminConfigureStreamRequest` + `ManualBlockRequest` + `UpdateBlockRequest`: add `applies_to: list[tuple[str, str]] | None = None`.
  - `BlockRowResponse`: add `applies_to: list[tuple[str, str]] | None = None`.
  - `TransformConfigRequest`: add `calc_to_target: str | None = None`, `calc_to_target_params: dict[str, Any] | None = None`, `risk_space_aggregation: str | None = None`, `risk_space_aggregation_params: dict[str, Any] | None = None`.
- `routers/blocks.py`, `routers/transforms.py`, `routers/pipeline.py`: plumb the new fields; validate `applies_to` entries against `RISK_DIMENSION_COLS` + current dim universe and raise HTTPException 400 on mismatch.
- `ws_serializers.py`: rewire any function reading from old `space_agg_df` / `block_fair_df` / `block_var_df` to the new schema. Point the per-block chart series at `block_series_df`, aggregated at `dim_target_df`.
- `stream_registry.py`: thread `applies_to` through `build_stream_config`.

### Modified files — `client/ui/`

- `src/types.ts`: mirror the Pydantic diff (Pydantic is upstream). `BlockConfigPayload.appliesTo?: [string, string][] | null`; `TransformConfigRequest.calcToTarget?: string | null` + params; `BlockRow.appliesTo`.
- `src/components/studio/brain/BlockDrawer.tsx` + `BlockDrawerParts.tsx`: new `<AppliesToField />` multi-select chip row. Render as `(symbol, expiry)` chips; empty = "All dims" pill. Default unchecked = `None` in payload.
- `src/components/studio/brain/EditableBlockTable.tsx`: add `applies_to` column, render chip list or "all" pill.
- `src/components/studio/StreamCanvas.tsx`: Anatomy graph gains a `calc_to_target` node reading from the transforms endpoint (same pattern as existing transform nodes).
- `src/services/blockApi.ts`, `streamApi.ts`: pass `applies_to` through.
- Chart / grid / inspector code: only type-level changes — no new surfaces in this pass. If any read `space_agg_df` directly (unlikely — they read via ws_serializers), update.

### Policy flip (Manual Brain Rule removal)

**Land in the first commit so subsequent `server/core/` edits pass the hook.** Files touched:

- `.claude/settings.json` — remove the entire `PreToolUse` block. Keep the `Stop` block intact.
- `CLAUDE.md` — delete the `## Manual Brain Rule (IMPORTANT — load-bearing invariant)` section; delete the "No lint/format tooling…" line is unrelated — keep it; update `## Architecture (pointer)` to drop "Core math in `server/core/` is off-limits"; update `## Known Gotchas` to drop the Manual-Brain-adjacent items.
- `docs/architecture.md` — Component Map: change `server/core/` owner from `**HUMAN ONLY**` to `LLM`. Data Flow section: drop the "HUMAN ONLY" label on steps 4–6 and the "stubs" paragraph. Boundaries & Contracts: delete the Manual Brain boundary.
- `docs/using-agents.md` — scan + rewrite any Manual-Brain reference.
- `tasks/lessons.md` — strike the "Never modify `server/core/`" and "`# HUMAN WRITES LOGIC HERE` stubs are sacred" entries. Replace both with a single entry noting the policy flip date (2026-04-21) and reasoning so the history is preserved.
- `docs/decisions.md` — append 2026-04-21 entry: "Lift Manual Brain Rule. Solo-trader workflow, faster iteration, LLM track record on the math lane (per progress.md handoffs — the fixes were trivial). Hook deleted, docs flushed."
- Every `.claude/commands/*.md` and matching `.windsurf/workflows/*.md` — grep for `server/core/`, `HUMAN ONLY`, `HUMAN WRITES`, `Manual Brain`. Candidates found: `kickoff.md`, `preflight.md`, `refactor.md`, `cleanup.md`, `spec.md`, `implement.md`. Keep the command pairs byte-identical in body per the harness sync rule.
- No references to purge in `README.md` (it's the operator's guide — skim and confirm).

---

## Test Cases

- **Happy path (mock).** Boot `POSIT_MODE=mock`, open Workbench. Grid populates with finite positions. Pipeline Chart "Fair" tab shows smooth decaying curves. Edge, Variance, Desired Position all non-zero where the mock scenario has market values set; zero elsewhere (passthrough default).
- **Single-block single-space dim.** One stream, one block, `applies_to = None`, one dim. Stage C mean over one block equals that block's series; stage D sum over one space equals stage C. End-to-end numbers match a hand calculation.
- **Two blocks on the same space, identical params.** Stage C mean of two identical series equals one copy of the series. Downstream desired position equals the single-block case — confirming the mean (not sum) model within a space.
- **Two blocks on different spaces, identical params.** Stage C yields two space rows. Stage D sums them → 2× the single-block series. Kelly sizing grows exactly as expected for an added independent risk.
- **`applies_to` multi-dim fan-out.** One block with `applies_to = [(BTC, E1), (ETH, E1)]` produces one row in each of those two dims at every downstream stage; no effect on `(BTC, E2)`, `(ETH, E2)`.
- **`applies_to` names an unknown dim.** Ingest returns HTTP 400 with a message naming the missing dim. Pipeline does not run.
- **Empty risk space at time t.** Block lifetime ends at t=100; at t=101 its space has zero blocks. Space row at t=101 is omitted. Stage-D sum at t=101 does not see a zero contribution.
- **Per-block market_value set.** Block A has `market_value = 0.02`, block B on the same space has no market_value. Stage B runs raw→calc + time-distribute on A's market. B's market is passthrough (= B's fair). Stage C mean within the space: space market = mean(A_market, B_fair). No aggregate inference needed.
- **Aggregate market_value set, no per-block.** Existing total-vol-proportional inference path. All blocks' market columns stay null through Stage C; Stage D's inference fills space_market_fair so Σ_t space_market_fair / T_years = aggregate_vol² (today's invariant).
- **No market_value anywhere.** Every block passes through with market = fair. Stage D sum gives total_market_fair = total_fair, edge = 0 everywhere.
- **`raw_fair == 0` at a block.** Raw-var = `var_fair_ratio * 0 = 0`; raw→calc of 0 = 0 (for affine_power); target-space var = `sqrt(0 / TTE) · 100 = 0`. No NaN, no division.
- **Mix of `int` and `float` `exponent` across streams.** With the cast-to-Float64 fix in Stage A, `pl.concat` succeeds. (Closes `progress.md` 2026-04-19 handoff.)
- **WS disconnect mid-tick.** Unchanged — pipeline rerun is atomic server-side; partial frames never reach client. Existing reconnect logic applies.
- **Malformed input: block with `applies_to = "BTC"` (string, not list of tuples).** Pydantic validation fails with a field error on the create/update request, before the pipeline is touched.

---

## Out of Scope

- **LLM serializers and Build-mode prompts.** `server/api/llm/prompts/build.py`, `server/core/serializers.py` LLM bridge, and `context_db.py` mock metadata retain old block-shape language. Follow-up spec once the math lane is stable.
- **`engineCommands.ts` client command parser.** `create_manual_block` / `create_stream` commands continue to exist and parse; adding `applies_to` + `calc_to_target` is a follow-up.
- **Position ring buffer + Kelly `VAR_FLOOR` spike fix.** Both tracked in `tasks/progress.md`; orthogonal.
- **Workbench UI surfaces that expose the risk-space layer.** No new tabs, no new chart, no new inspector. Only additions: `applies_to` multi-select in BlockDrawer, chip column in EditableBlockTable, `calc_to_target` node in Anatomy graph.
- **Schema migration for existing saved blocks.** Mock-mode boots fresh; prod deploys start empty. No migration shim.
- **Per-`(symbol, expiry)` calc→target override.** Global only.
- **Confidence-weighted mean variant of `risk_space_aggregation`.** Register the step, leave the transform unimplemented — default `arithmetic_mean` only.

---

## Commit Plan (for the implementing session)

One PR, multiple commits so reviewers can step through:

1. **`chore: lift Manual Brain Rule`** — `.claude/settings.json` hook deletion, `CLAUDE.md`, `docs/architecture.md`, `docs/using-agents.md`, `tasks/lessons.md`, `docs/decisions.md`, all `.claude/commands/*.md` + `.windsurf/workflows/*.md` paired updates. Verify: `git grep -i 'HUMAN ONLY\|HUMAN WRITES\|Manual Brain'` returns empty in docs (keep the lessons.md history note). Verify `drift-check.sh` still passes (command bodies mirrored).
2. **`refactor(core): introduce risk_space_aggregation + calc_to_target transform steps`** — new transform files, registry definitions, mock stays on old pipeline. `python -m compileall server/ -q` clean.
3. **`feat(core): pipeline 4-space rewrite`** — `pipeline.py`, `config.py`, `fair_value.py`, `aggregation.py`, `market_value_inference.py`, delete/inline `variance.py`, `mock_scenario.py` updates, Int32/Float64 cast fix. Run `compileall`; load mock pipeline via existing prototyping notebook or a short test script to confirm finite numbers end-to-end.
4. **`feat(api): applies_to + calc_to_target boundary`** — `server/api/models.py`, routers, `ws_serializers.py`, `stream_registry.py`. `compileall` clean. Manual ingest via `curl` of a bad `applies_to` payload → expect 400.
5. **`feat(ui): applies_to multi-select + calc_to_target anatomy node`** — `client/ui/src/types.ts`, BlockDrawer parts, EditableBlockTable, StreamCanvas, service clients. `npm --prefix client/ui run typecheck && npm --prefix client/ui run build` clean.
6. **`docs: pipeline 4-space model`** — update `docs/product.md` (the "How Fair Value Is Built", "How Blocks Aggregate", "How Variance Is Computed" sections) and `docs/architecture.md` MVP Pipeline flow to describe the 4-space model. Log a 2026-04-21 decision entry in `docs/decisions.md` covering the math change.

Between commits: run the Stop-hook checks (typecheck + compileall). Skip only if the commit is docs-only.

---

## Open Implementation Questions (to decide in-session, not blockers)

- **Where exactly does raw→calc apply in Stage B?** Two equivalent framings: (a) apply to block totals then time-distribute, (b) time-distribute raw then apply raw→calc per timestamp. Option (a) is cleaner and matches the user's stated intent ("convert block raw value to total variance units, then distribute"). Prefer (a). Verify algebraically that for `affine_power` they produce the same per-t value; for `log_scale` they do not — document the choice.
- **Should `block_series_df` carry `target_value` for backward-compat debugging?** Probably not — breaks the clean schema. Mark as deleted and update any notebook that reads it.
- **Does `risk_space_aggregation.arithmetic_mean` respect a live-block mask per-timestamp, or rely on stage B emitting no rows when a block is dead?** Latter is cleaner; pick it.
