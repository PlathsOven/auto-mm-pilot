# Spec: Per-Block Market Price

**Date:** 2026-04-12
**Status:** Draft — awaiting approval

---

## Summary

Replace the global per-space market pricing mechanism (`dict[str, float]` keyed by `space_id`) with per-block market prices embedded directly in snapshot rows. Each block carries its own `market_price` field in the same raw units as `raw_value`, goes through the identical unit conversion and temporal fair value pipeline, and aggregates identically. If the user omits `market_price`, it defaults to `raw_value` (edge = 0 for that block).

This eliminates the `POST /api/market-pricing` endpoint, the `MarketPricingEditor` UI component, and the `attach_market_values` pipeline stage.

---

## Motivation

The current model assigns one market price per `space_id`. All blocks in the same space share a single market comparison point. This is architecturally clean but conceptually wrong: different data streams within the same temporal space may have different market comparison points. A realized vol block and a mean IV block both live in the "shifting" space, but the market reference for each should come from that stream's own market data, not a shared global value.

Per-block market prices make the data model faithful to reality: each stream observes its own raw value *and* its own market counterpart. Edge is computed per-block, then aggregated — the same way fair value already works.

---

## Design

### Data Flow (Current → Proposed)

**Current:**
```
raw_value ──→ unit_conversion ──→ target_value ──→ temporal_fair_value ──→ fair
                                                                          │
global_market_pricing[space_id] ──→ unit_conversion ──→ target_market_value ──→ temporal_fair_value ──→ market_fair
                                                                          │
                                                              edge = fair - market_fair
```

`attach_market_values` joins the global dict onto `blocks_df` by `space_id`, then applies the block's unit conversion to get `target_market_value`.

**Proposed:**
```
raw_value    ──→ unit_conversion ──→ target_value        ──→ temporal_fair_value ──→ fair
market_price ──→ unit_conversion ──→ target_market_value ──→ temporal_fair_value ──→ market_fair
                                                                                     │
                                                                         edge = fair - market_fair
```

Both columns are computed in `build_blocks_df`. No separate join stage. `market_price` defaults to `raw_value` when absent.

### Default Behavior Change

| Scenario | Current | Proposed |
|----------|---------|----------|
| Block with no explicit market price | Uses global dict (often non-zero) → non-zero edge | Defaults to `raw_value` → edge = 0 |
| Block where user sets market_price ≠ raw_value | N/A (not supported per-block) | edge = f(raw_value) - f(market_price) |

This is intentional: a block contributes zero edge until the user explicitly provides a distinct market comparison point.

---

## Changes by Layer

### 1. Snapshot Schema — `server/api/models.py`

**`SnapshotRow`** — add optional field:
```python
market_price: float | None = Field(default=None, description="Market-implied price in same raw units as raw_value. Defaults to raw_value if omitted.")
```

**Remove entirely:**
- `MarketPricingRequest`
- `MarketPricingResponse`

**`ManualBlockRequest`** — no structural change needed; `SnapshotRow` already embedded, gains `market_price` automatically.

**`BlockRowResponse`** — add field:
```python
market_price: float | None = None
```
(The existing `market_value` and `target_market_value` fields remain, now populated from the per-block market_price instead of the global dict.)

### 2. Client Types — `client/ui/src/types.ts`

**Remove:**
- `MarketPricingResponse` interface

**Update `BlockRow`** — add:
```typescript
market_price: number | null;
```

### 3. Pipeline Core — `server/core/` (HUMAN ONLY)

#### `server/core/pipeline.py`

**`build_blocks_df`:**
- After reading `raw_value` from the snapshot row, also read `market_price` (default to `raw_value` if the column is absent or the value is null).
- Apply the same unit conversion to `market_price` → `target_market_value` (same `conv_params`, same `unit_conversion` function).
- Add both `market_price` and `target_market_value` to the block entry dict.

Pseudocode for the new lines inside the `for row in snap.iter_rows(named=True):` loop:
```python
# Market price (defaults to raw_value)
mkt_raw = row.get("market_price") if "market_price" in snap.columns else None
if mkt_raw is None:
    mkt_raw = row["raw_value"]

# Apply same unit conversion
if unit_conversion is not None:
    mkt_expr = unit_conversion.fn("_mkt_temp", **conv_params)
    # Need to compute scalar — create a tiny 1-row DataFrame
    mkt_target = pl.DataFrame({"_mkt_temp": [mkt_raw]}).select(mkt_expr).item()
else:
    mkt_target = (sc.scale * mkt_raw + sc.offset) ** sc.exponent

entry["market_price"] = mkt_raw
entry["target_market_value"] = mkt_target
```

**`attach_market_values`:**
- **Remove entirely.** The function is no longer needed — `target_market_value` is computed per-block in `build_blocks_df`.

**`run_pipeline`:**
- Remove `market_pricing: dict[str, float]` parameter.
- Remove the call to `attach_market_values(blocks_df, market_pricing, unit_fn)`.
- `blocks_df` already has `target_market_value` from `build_blocks_df`.
- Everything downstream (`fair_fn`, `var_fn`, `agg_fn`, etc.) reads `target_market_value` from `blocks_df` — no changes needed.

Updated signature:
```python
def run_pipeline(
    streams: list[StreamConfig],
    risk_dimension_cols: list[str],
    now: dt.datetime,
    bankroll: float,
    smoothing_hl_secs: int,
    time_grid_interval: str = "1m",
    transform_config: dict[str, Any] | None = None,
) -> dict[str, pl.DataFrame]:
```

#### `server/core/transforms.py`

**No changes.** `fv_standard` and `fv_flat_forward` already read `target_market_value` from `blocks_df` row dict. Aggregation functions already aggregate `market_fair`. Variance, position sizing, and smoothing are unaffected.

#### `server/core/config.py`

**No changes.** `StreamConfig` and `BlockConfig` are unchanged. `market_price` lives in the snapshot DataFrame, not the config.

#### `server/core/mock_scenario.py`

**Add `market_price` column** to all mock snapshot DataFrames. Values chosen to reproduce equivalent behavior to current `MOCK_MARKET_PRICING`:

```python
# RV stream: raw_value=0.45, market says 0.55
MOCK_RV_STREAM = StreamConfig(
    stream_name="rv",
    snapshot=pl.DataFrame({
        "timestamp": [MOCK_NOW],
        "symbol": [_SYMBOL],
        "expiry": [_EXPIRY],
        "raw_value": [0.45],
        "market_price": [0.55],  # NEW
    }),
    # ... rest unchanged
)

# Mean IV stream: raw_value=0.50, market IV is 0.55
MOCK_MEAN_IV_STREAM = StreamConfig(
    stream_name="mean_iv",
    snapshot=pl.DataFrame({
        "timestamp": [MOCK_NOW],
        "symbol": [_SYMBOL],
        "expiry": [_EXPIRY],
        "raw_value": [0.50],
        "market_price": [0.55],  # NEW
    }),
    # ... rest unchanged
)

# Events stream: per-event market prices
MOCK_EVENTS_STREAM = StreamConfig(
    stream_name="events",
    snapshot=pl.DataFrame({
        "timestamp": [MOCK_NOW] * _NUM_EVENTS,
        "symbol": [_SYMBOL] * _NUM_EVENTS,
        "expiry": [_EXPIRY] * _NUM_EVENTS,
        "event_id": [f"event_{i}" for i in range(_NUM_EVENTS)],
        "raw_value": [2.5, 3.1, 1.8, 4.0, 2.0],
        "market_price": [0.30, 0.25, 0.40, 0.35, 0.20],  # NEW
        "start_timestamp": _EVENT_STARTS,
    }),
    # ... rest unchanged
)
```

**Remove:**
- `MOCK_MARKET_PRICING` dict (no longer used anywhere).

#### `server/core/serializers.py`

**`_serialize_blocks_df`** — add `"market_price"` to `summary_cols` list so the LLM snapshot includes each block's raw market price.

### 4. Engine State — `server/api/engine_state.py`

**Remove:**
- `_market_pricing` global dict
- `set_market_pricing()` function
- `get_market_pricing()` function

**Update `rerun_pipeline()`:**
- Remove `market_pricing` parameter from signature.
- Remove `_market_pricing.update(market_pricing)` logic.
- Remove `market_pricing` from the `run_pipeline()` call.

Updated signature:
```python
def rerun_pipeline(
    streams: list[Any],
    bankroll: float | None = None,
    transform_config: dict[str, Any] | None = None,
) -> dict[str, pl.DataFrame]:
```

**Update `rerun_and_broadcast()`:**
- Remove `market_pricing` parameter.

Updated signature:
```python
async def rerun_and_broadcast(
    stream_configs: list,
    *,
    bankroll: float | None = None,
    transform_config: dict | None = None,
) -> None:
```

### 5. API Routers

#### `server/api/routers/market_pricing.py` — **DELETE ENTIRE FILE**

#### `server/api/main.py`
- Remove `from server.api.routers.market_pricing import router as market_pricing_router`
- Remove `app.include_router(market_pricing_router)`

#### `server/api/routers/snapshots.py`
- No changes — snapshot rows already flow through as dicts; the new `market_price` field passes through via Pydantic's `extra = "allow"` on `SnapshotRow`.

Wait — `SnapshotRow` has `extra = "allow"`, so technically `market_price` would already pass through even without adding it as an explicit field. But adding it as an explicit field with `default=None` is better for documentation and validation.

#### `server/api/routers/blocks.py`
- `_blocks_from_pipeline()`: Add `market_price=row.get("market_price")` to the `BlockRowResponse` constructor.
- `create_manual_block()` stub response: Add `market_price` field.
- No other changes — `SnapshotRow` already gains `market_price`.

#### All callers of `rerun_and_broadcast`
Remove `market_pricing=...` kwarg from every call site:
- `server/api/routers/market_pricing.py` — deleted entirely (see above)
- Any other callers passing `market_pricing` — grep and update.

### 6. Client UI

#### `client/ui/src/services/streamApi.ts`
**Remove:**
- `fetchMarketPricing()` function
- `updateMarketPricing()` function
- `MarketPricingResponse` import

#### `client/ui/src/components/studio/MarketPricingEditor.tsx` — **DELETE ENTIRE FILE**

#### `client/ui/src/components/studio/anatomy/PipelineConfigPopover.tsx`
- Remove `import { MarketPricingEditor } from "../MarketPricingEditor";`
- Remove `<MarketPricingEditor />` from the JSX.
- (Keep `BankrollEditor` — bankroll is unchanged.)

#### `client/ui/src/components/ApiDocs.tsx`
- Remove the market pricing API documentation section.

#### Block drawer / manual block forms
- The `BlockDrawer` should gain an optional `market_price` field in the manual block creation form. When omitted, the server defaults to `raw_value`.

### 7. LLM Prompts — `server/api/llm/prompts/`

#### `core.py`
**`FRAMEWORK_DETAIL`** — update the Market-Implied Value paragraph:

Current:
```
**Market-Implied Value:** The market's current pricing, converted to the
same units as fair value for comparison.
```

Updated:
```
**Market-Implied Value:** Each block carries its own market price
(market_price) in the same raw units as raw_value. It goes through
the identical unit conversion and temporal distribution as fair value.
When market_price is not provided, it defaults to raw_value (edge = 0
for that block). Edge = fair minus market-implied, computed per-block
then aggregated.
```

#### `investigation.py`
- Line 134–135 references "mkt = market-implied" — no change needed (still accurate).
- Line 44–45 "Fair value vs. market implied" — no change needed.

#### `build.py` (configure/opinion)
- No changes needed — these modes guide block creation; the `market_price` field is optional and the LLM can ask the user about it during the Block Decision Flow. Consider adding a Step 2.5 or note to the BLOCK_DECISION_FLOW asking about market comparison point, but this is a nice-to-have, not required.

### 8. Documentation

#### `docs/architecture.md`
- Key Files table: remove `market_pricing.py` row.
- Component Map: no changes.

#### `docs/product.md`
- Update "Signal Synthesis" section: replace "Market Implied is the market's current pricing" with per-block model description.

#### `client/ui/UI_SPEC.md`
- Remove any market pricing editor references.

### 9. Stream Registry — `server/api/stream_registry.py`

**No structural changes.** `market_price` is optional in `SnapshotRow` and passes through the existing snapshot ingestion path. The `_REQUIRED_SNAPSHOT_COLS` set stays `{"timestamp", "raw_value"}` — `market_price` is NOT required.

When `StreamRegistration.to_stream_config()` builds the snapshot DataFrame, `market_price` will be present as a column if any row included it. The pipeline (`build_blocks_df`) handles the absent-column case by defaulting to `raw_value`.

---

## Verification Plan

1. **Server syntax check:** `python -m compileall server/ -q` — must pass clean.
2. **Client typecheck:** `npm --prefix client/ui run typecheck` — must pass clean.
3. **Mock pipeline equivalence:** Run the mock pipeline and verify the output is numerically equivalent to the current output (same desired positions, same edge, same variance). The mock `market_price` values are chosen to match the current `MOCK_MARKET_PRICING` behavior exactly.
4. **Default behavior:** Create a manual block WITHOUT `market_price` → verify edge = 0 for that block.
5. **Explicit market_price:** Create a manual block WITH `market_price` ≠ `raw_value` → verify non-zero edge proportional to the difference.
6. **WS tick output:** Verify the WS payload still contains correct `totalFair`, `totalMarketFair`, `edge` fields.
7. **LLM investigation:** Trigger an investigation on a cell → verify the LLM receives correct block-level `market_price` data in its context.
8. **Removed endpoints:** `GET /api/market-pricing` and `POST /api/market-pricing` return 404.

---

## Breaking Changes

| What | Impact | Migration |
|------|--------|-----------|
| `POST /api/market-pricing` removed | Any client code calling this endpoint breaks | Remove calls; market pricing now flows through snapshot rows |
| `GET /api/market-pricing` removed | Same | Same |
| `market_pricing` param removed from `run_pipeline` | Any direct callers (notebooks, tests) break | Remove the parameter; add `market_price` to snapshot DataFrames instead |
| Default edge = 0 (was: edge = fair - f(0)) | All blocks without explicit `market_price` start at zero edge | Explicitly provide `market_price` in snapshot rows for non-zero edge |
| `MarketPricingEditor` UI removed | Users can no longer set global market prices from the Anatomy config popover | Market prices are set per-block in snapshot data or the Block Drawer |
| `MOCK_MARKET_PRICING` removed from mock_scenario.py | Any test or notebook importing it breaks | Use mock snapshot `market_price` columns instead |

---

## Implementation Order

The changes span `server/core/` (HUMAN ONLY) and `server/api/` + `client/ui/` (LLM). Suggested order:

1. **Phase 1 — Core pipeline** (HUMAN): Modify `build_blocks_df`, remove `attach_market_values`, update `run_pipeline` signature, update `mock_scenario.py`, update `serializers.py`. Verify with `python -m compileall server/ -q`.

2. **Phase 2 — API layer** (LLM): Update `models.py`, `engine_state.py`, delete `market_pricing.py`, update `main.py`, update `blocks.py`, update callers of `rerun_and_broadcast`. Verify with `python -m compileall server/ -q`.

3. **Phase 3 — Client** (LLM): Update `types.ts`, delete `MarketPricingEditor.tsx`, update `PipelineConfigPopover.tsx`, update `streamApi.ts`, add `market_price` field to `BlockDrawer`. Verify with `npm --prefix client/ui run typecheck`.

4. **Phase 4 — Prompts & docs** (LLM): Update `core.py` FRAMEWORK_DETAIL, update `docs/product.md` and `docs/architecture.md`.

5. **Phase 5 — Verify** (HUMAN + LLM): Run full mock pipeline, compare output, test manual block creation with and without `market_price`.

Phases 1 and 2 are coupled (API layer calls `run_pipeline`), so they should be coordinated. Phase 1 must land first since Phase 2 depends on the new `run_pipeline` signature.
