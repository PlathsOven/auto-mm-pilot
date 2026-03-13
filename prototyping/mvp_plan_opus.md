# MVP Pipeline Rewrite Plan — `mvp_new_opus.ipynb`

## Assessment of Current `mvp.ipynb`

### What Works Well
- The conceptual pipeline is sound: streams → target space → fair value curves over time → aggregate by space → edge/variance → desired position
- Plotly sensechecking at the end is valuable
- The `ValueBlock` math for linear decay/annualization is correct and well-commented

### Maintainability & Elegance Issues

#### 1. Mutable state everywhere
`DataStream` mutates `.snapshot` in-place across 4 chained methods (`update_snapshot` → `get_latest_snapshot` → `transform_raw_to_target` → `get_value_blocks`). You can't re-run a cell without re-instantiating from scratch. This is the **#1 friction** for a scripter iterating on logic.

#### 2. Python objects stored in Polars DataFrames
`ValueBlock` objects are stored as `pl.Object` columns. This defeats Polars' optimizations, makes DataFrames un-serializable, and clutters output with `<__main__.ValueBlock object at 0x...>`.

#### 3. Giant monolithic cell (cell 13)
The main enrichment cell is ~130 lines: nested loops, dict-building, Polars expression accumulation, and group_by iteration. Impossible to sensecheck or modify one piece without understanding all of it.

#### 4. Duplicated aggregation logic
Space-level aggregation (average/offset fair → edge, variance) is computed **twice**: once in the enrichment cell (13) and again in the sensechecking cell (18). DRY violation and bug risk.

#### 5. Column explosion
The enriched DataFrame ends up with **41+ columns** (one per block per metric). Nearly unreadable. A long/tidy format would be far more inspectable.

#### 6. `map_elements` instead of native Polars
`transform_raw_to_target` and `add_market_value` use Python-level row-by-row `map_elements` for what's a simple `(scale * x + offset) ** exponent` — trivially expressible as a native Polars expression.

#### 7. Config mixed with data
Stream configuration (scale, offset, exponent, decay params) is entangled with runtime data (the snapshot DataFrame). Hard to reason about what's static vs dynamic, and hard to swap inputs.

#### 8. Parameters forwarded verbatim
Every `ValueBlock` parameter is stored on `DataStream` first, then passed through. Adding a param requires editing both classes.

---

## Design Principles

- **Pure functions over mutable classes** — every pipeline step is a function `(input_df, config) → output_df`
- **Config in one place** — all tunable params in a single cell using `@dataclass`
- **Tidy/long-format DataFrames** — one row per `(timestamp, block_name)` instead of 41 columns
- **No Python objects in DataFrames** — configs stay in dicts, DataFrames stay columnar
- **Each cell does one thing** — easy to re-run, easy to inspect intermediate results
- **Sensechecking reuses pipeline data** — no re-derivation

---

## Notebook Structure

| Cell | Type     | Purpose |
|------|----------|---------|
| 0    | markdown | Title + overview of the pipeline |
| 1    | code     | Imports |
| 2    | markdown | Section: Configuration |
| 3    | code     | `@dataclass BlockConfig` + `@dataclass StreamConfig` — all parameters |
| 4    | code     | Global params (now, expiry, symbol, bankroll, smoothing) |
| 5    | code     | Stream configs — **the one cell you edit to change inputs** |
| 6    | code     | Mock snapshot data — easy to swap for real data |
| 7    | markdown | Section: Helper Functions |
| 8    | code     | `annualize`, `deannualize`, `raw_to_target` (native Polars expr) |
| 9    | markdown | Section: Pipeline Steps |
| 10   | code     | Step 1: `transform_to_target_space()` — pure function |
| 11   | code     | Step 2: `assign_spaces()` — pure function |
| 12   | code     | Step 3: `attach_market_values()` — pure function |
| 13   | code     | Step 4: `build_time_grid()` — creates future_df |
| 14   | code     | Step 5: `compute_block_fair_values()` — returns long-format df: (timestamp, block_name, fair_annualized, fair) |
| 15   | code     | Step 6: `compute_block_variances()` — adds var column |
| 16   | code     | Step 7: `aggregate_by_space()` — space-level edge & variance |
| 17   | code     | Step 8: `compute_desired_position()` — final edge/var → position |
| 18   | code     | `run_pipeline()` — orchestrates steps 1–8, returns all intermediates in a dict |
| 19   | markdown | Section: Run Pipeline |
| 20   | code     | Call `run_pipeline()`, display key intermediates |
| 21   | markdown | Section: Sensechecking |
| 22   | code     | Graph 1: Fair Value by Space |
| 23   | code     | Graph 2: Variance by Block (stacked) |
| 24   | code     | Graph 3: Edge by Space |
| 25   | code     | Graph 4: Desired Position |

---

## Key Improvements

- **Swap inputs in one cell** (cell 5) — change a stream config, re-run all
- **`run_pipeline()` returns a dict** with all intermediates — inspect any stage
- **Long-format block data** — filter to one block with `df.filter(pl.col('block') == 'rv')` instead of hunting through 41 columns
- **All math preserved exactly** — same formulas, just reorganized
- **~50% fewer lines** due to elimination of duplication and class overhead

---

## Dependencies

No new dependencies. Same as existing:
- `polars`
- `plotly`
- `dataclasses` (stdlib)
- `datetime` (stdlib)
- `random` (stdlib)
- `typing` (stdlib)
