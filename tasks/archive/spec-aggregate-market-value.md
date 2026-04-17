# Spec: Aggregate Market Value (per symbol/expiry)

## Overview

Allow the trader to set an aggregate market value (total vol) per symbol/expiry pair. Blocks without user-defined `market_value` derive theirs from the aggregate via proportional variance allocation. The inference method is a new pluggable transform step, consistent with the existing anatomy architecture. When no aggregate is set, the current fallback (market_value = raw_value) is preserved.

## Requirements

### User stories

- As the **primary trader**, I want to set a single total vol number for BTC/27MAR26 and have the system distribute it to my blocks, so that I don't have to price every block individually when I already know the aggregate market implied vol.
- As the **primary trader**, I want to see the aggregate market value alongside per-block decomposition in the Brain section, so I can verify the system's inference makes sense.
- As the **primary trader**, I want to see fair value and market value views on the Eyes grid, so I can compare them at a glance across all symbol/expiry pairs.
- As the **primary trader**, I want the inference method to be configurable in the Anatomy transforms panel, so I can swap it for a different allocation logic later.

### Acceptance criteria

- [ ] New section in DesiredPositionGrid where the trader can view and edit total vol per symbol/expiry
- [ ] Symbol/expiry pairs are auto-discovered from current pipeline blocks (no manual creation)
- [ ] Setting total vol for a symbol/expiry sets a dirty flag; the ticker coalesces updates and reruns the pipeline at most once per tick interval
- [ ] Blocks with user-defined `market_value` are unaffected by the aggregate
- [ ] When no aggregate is set for a symbol/expiry, blocks without user-defined `market_value` fall back to `market_value = raw_value` (current behavior)
- [ ] `market_value_inference` appears as a configurable step in `/api/transforms` and the Anatomy transforms panel
- [ ] Brain DecompositionPanel shows the aggregate market value (total market fair + user's set total vol) for the selected symbol/expiry
- [ ] Block table reflects inferred `market_value` for blocks that derive from the aggregate
- [ ] Pipeline time-series endpoint includes aggregate market value in its response

### Performance

- Updates are expected to be high-frequency (up to 1Hz in prod)
- **Dirty-flag coalesced rerun** — API writes update the store and set a dirty flag. The WS ticker checks the flag on each tick; if dirty, it triggers a single pipeline rerun in a background thread, swaps results atomically, and continues broadcasting. At most one rerun per tick interval (~1s). No ticker cancellation/restart.
- Pipeline rerun latency: ~100-200ms (well within tick interval)

### Security

- New `GET/PUT/DELETE /api/market-values` endpoints — no auth change required (same auth context as existing stream/bankroll endpoints)
- No secrets or PII in the market value store
- No new logging concerns

## Technical Approach

A **dedicated `MarketValueStore`** singleton holds `{(symbol, expiry): total_vol}` plus a dirty flag. CRUD is via three new API endpoints. Writes update the store and set the dirty flag — they do **not** call `rerun_and_broadcast`. Instead, the WS ticker checks the dirty flag on each tick cycle. If dirty, it triggers a single pipeline rerun in a background thread, clears the flag, swaps the pipeline results atomically, and continues broadcasting from the new data. This coalesces rapid updates into at most one rerun per tick interval, avoids ticker cancellation/restart thrash, and keeps the WS stream smooth.

In the pipeline, `build_blocks_df` gains a `has_user_market_value` boolean column and stops defaulting null market values to raw_value. A new transform step — `market_value_inference` — runs after `build_blocks_df` and before `temporal_fair_value`. It reads the aggregate market values (passed as a parameter), computes per-block inferred `market_value` / `target_market_value` for blocks without user-defined values, and passes the enriched `blocks_df` downstream. Blocks without an aggregate AND without user-defined market_value fall back to `market_value = raw_value`.

On the client, the DesiredPositionGrid gets a new section for aggregate inputs (one row per auto-discovered symbol/expiry). The Brain's DecompositionPanel adds a "Market Fair" card and displays the user's set total vol. Fair value and market value view modes already exist in the grid dropdown — no changes needed for Eyes display.

### Dirty-flag rerun protocol

```
API write → store.set(symbol, expiry, total_vol) → store.dirty = True → return 200

Ticker loop (every TICK_INTERVAL_SECS):
  if store.dirty:
    store.dirty = False
    stream_configs = registry.build_stream_configs()
    aggregate_mvs = store.to_dict()
    pipeline_results = run_pipeline(..., aggregate_market_values=aggregate_mvs)
    swap pipeline results atomically
  broadcast current tick from (possibly updated) pipeline results
```

This pattern is generalizable — bankroll and snapshot updates could migrate to it too (future). For this pass, only aggregate market values use it; other inputs continue using `rerun_and_broadcast`.

### Data shape changes

**`server/api/models.py` (Pydantic — upstream):**
```python
class MarketValueEntry(BaseModel):
    symbol: str
    expiry: str
    total_vol: float  # annualized total vol

class SetMarketValueRequest(BaseModel):
    entries: list[MarketValueEntry]

class MarketValueListResponse(BaseModel):
    entries: list[MarketValueEntry]

# TransformConfigRequest gains:
    market_value_inference: str | None = None
    market_value_inference_params: dict[str, Any] | None = None
```

**`client/ui/src/types.ts` (TS — downstream):**
```typescript
export interface MarketValueEntry {
  symbol: string;
  expiry: string;
  total_vol: number;
}

export interface MarketValueListResponse {
  entries: MarketValueEntry[];
}
```

**`DesiredPosition` (WS payload) — no change needed.** The aggregate is an input; the output is already captured by `totalMarketFair` (per-symbol/expiry) and `market_value` / `target_market_value` (per-block).

**`PipelineTimeSeriesResponse.currentDecomposition.aggregated` — gains:**
```typescript
aggregateMarketValue?: { totalVol: number } | null  // user's input, if set
```

### Files to create

| File | Purpose |
|------|---------|
| `server/api/market_value_store.py` | Thread-safe singleton: `{(symbol, expiry): total_vol}` with get/set/delete/to_dict + dirty flag |
| `server/api/routers/market_values.py` | `GET /api/market-values`, `PUT /api/market-values`, `DELETE /api/market-values/{symbol}/{expiry}` — writes set dirty flag, no rerun |
| `client/ui/src/services/marketValueApi.ts` | HTTP client for market value CRUD |
| `client/ui/src/components/floor/AggregateMarketValueSection.tsx` | Inline section in DesiredPositionGrid for per-symbol/expiry total vol inputs |

### Files to modify

| File | Change |
|------|--------|
| `server/core/transforms.py` | New `market_value_inference` step + `total_vol_proportional` implementation |
| `server/core/pipeline.py` | `build_blocks_df` tracks `has_user_market_value`; `run_pipeline` accepts `aggregate_market_values` dict, calls inference step |
| `server/core/mock_scenario.py` | Add `MOCK_AGGREGATE_MARKET_VALUES` for testing |
| `server/api/models.py` | Add `MarketValueEntry`, `SetMarketValueRequest`, `MarketValueListResponse`; extend `TransformConfigRequest` |
| `server/api/engine_state.py` | Store aggregate market values; pass to `run_pipeline`; expose to ticker |
| `server/api/ws.py` | Ticker checks dirty flag each tick; triggers coalesced rerun if dirty |
| `server/api/main.py` | Register market_values router |
| `server/api/routers/transforms.py` | Add `"market_value_inference"` label |
| `server/api/routers/pipeline.py` | Include user's aggregate setting in timeseries response |
| `client/ui/src/types.ts` | Add `MarketValueEntry`, `MarketValueListResponse` |
| `client/ui/src/components/DesiredPositionGrid.tsx` | Render `AggregateMarketValueSection` below the table |
| `client/ui/src/components/PipelineChart/DecompositionPanel.tsx` | Add "Market Fair" card; show user's total vol indicator |
| `client/ui/src/pages/BrainPage.tsx` | Pass aggregate market value data to DecompositionPanel |

## Algorithm: `total_vol_proportional`

For each (symbol, expiry) where the user has set an aggregate `total_vol`:

```
Input:
  blocks_df           — all blocks, with has_user_market_value flag
  aggregate_total_vol — user-set annualized total vol (V)
  unit_conversion_fn  — the active unit conversion transform (for reverse conversion)

Step 1: aggregate_var = V²                         (annualized variance)

Step 2: For each block with has_user_market_value=True:
          user_var_i = |target_market_value_i|      (already in variance units)
        user_var_sum = sum(user_var_i)

Step 3: remainder_var = max(0, aggregate_var - user_var_sum)

Step 4: For each block with has_user_market_value=False:
          raw_var_i = |target_value_i|              (raw_value converted to variance)
        total_raw_var = sum(raw_var_i)

Step 5: For each block with has_user_market_value=False:
          weight_i = raw_var_i / total_raw_var      (0 if total_raw_var == 0)
          inferred_target_market_value_i = sign(target_value_i) * remainder_var * weight_i
          inferred_market_value_i = reverse_unit_conversion(inferred_target_market_value_i)

Step 6: Fill has_user_market_value=False rows in blocks_df with inferred values

Fallback: For (symbol, expiry) pairs WITHOUT an aggregate, blocks with
          has_user_market_value=False get market_value = raw_value (current behavior).
```

**Reverse unit conversion** for `affine_power`: `raw = ((target)^(1/exponent) - offset) / scale`.

## Test Cases

- **Happy path:** Set aggregate total_vol=0.55 for BTC/27MAR26 with 3 blocks (one with user-defined market_value=0.55, two without). Verify the two inferred blocks' target_market_values sum with the user-defined block's to equal 0.55² = 0.3025 total variance.
- **No aggregate set:** All blocks without user-defined market_value fall back to market_value = raw_value (edge = 0). No change from current behavior.
- **Aggregate < user-defined sum:** remainder_var clamped to 0. Inferred blocks get target_market_value = 0 (no market credit allocated).
- **Single block without user-defined:** Gets 100% of remainder_var.
- **All blocks have user-defined market_value:** Inference step is a no-op for that dimension.
- **Empty state (no blocks):** No crash, no-op.
- **Mixed annualized / non-annualized blocks in same dimension:** target_value is already in variance units regardless of annualized flag (exponent=2 in unit conversion). The proportional allocation operates on target_value directly.
- **total_raw_var = 0 (all infer-blocks have target_value=0):** Allocate 0 to each (avoid division by zero).
- **API: invalid expiry format in DELETE → 422.**
- **API: negative total_vol → 422.**

## Out of Scope

- **Persistence across server restarts.** The store is in-memory like the stream registry. Database backing is a future concern.
- **Auto-feed from exchange data.** The trader updates total vol manually (or via API client). Connecting to a live market data feed is a separate feature.
- **Per-timestamp (term structure) aggregate values.** The aggregate is a single number per symbol/expiry, not a time series. Term structure market values are a phase 2 extension.
- **WS inbound channel for aggregate updates.** First implementation uses REST. If the trader needs sub-second update latency, we add a WS frame type later.
- **Migrating other inputs to dirty-flag pattern.** Bankroll and snapshot updates still use `rerun_and_broadcast`. Unifying them under the dirty-flag ticker is a future optimization.

## Manual Brain Boundary

The user has granted explicit permission to modify `server/core/` for this feature. The transform step implementation and pipeline integration will be written directly — no stubs.
