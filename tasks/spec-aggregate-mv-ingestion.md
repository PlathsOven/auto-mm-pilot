# Spec: Aggregate Market Vol Ingestion via Client WebSocket

## Overview

The trader's own systems push aggregate market vol (a single number per symbol/expiry) into Posit at ~1 Hz over the existing `/ws/client` channel. Posit is the receiver, not the producer — we do not build exchange adapters or compute IV. The manual UI input (`AggregateMarketValueSection`) built in the prior feature pass is removed; if no aggregate data arrives, the system falls back to per-block `market_value = raw_value` (already handled).

## Requirements

### User stories

- As the **primary trader**, I want my market data systems to push aggregate vol to Posit over the same WebSocket connection they already use for snapshots, so I have one integration point instead of two.
- As the **primary trader**, I want to stop seeing an editable vol input in the Eyes grid — the aggregate should come from my systems, not from manual typing.

### Acceptance criteria

- [ ] `/ws/client` accepts a new `"market_value"` frame type alongside existing snapshot frames
- [ ] Each frame contains one or more `{symbol, expiry, total_vol}` entries
- [ ] Server ACKs each frame with `entries_accepted` count (same pattern as snapshot ACK)
- [ ] Writes go to the existing `MarketValueStore`; dirty flag is set; no immediate pipeline rerun
- [ ] Frames without a `type` field are treated as snapshot frames (backwards compatible)
- [ ] `AggregateMarketValueSection` UI component is removed from DesiredPositionGrid
- [ ] REST API (`GET/PUT/DELETE /api/market-values`) remains available for scripting/testing
- [ ] ApiDocs panel documents the new frame type with examples

### Performance

- Target: 10+ symbol/expiry pairs updated at 1 Hz over a single WS connection
- No per-frame pipeline rerun — dirty-flag coalescing (already built) absorbs burst writes
- Frame processing is O(entries) dict writes under a lock; sub-millisecond

### Security

- No new auth — reuses existing `/ws/client` API key + IP whitelist
- No new endpoints or channels
- No secrets in the market value store; nothing new to log-gate

## Technical Approach

Add a `type` discriminator to `/ws/client` inbound frames. The existing snapshot frame shape has no `type` field, so the default is `"snapshot"` for backwards compatibility. A new `"market_value"` type carries `entries: [{symbol, expiry, total_vol}]`. The frame handler in `client_ws.py` dispatches on `type`: snapshot frames follow the existing path; market value frames write to `MarketValueStore` and ACK immediately (no rerun). The WS ticker's dirty-flag check (already wired) picks up the change on the next tick.

On the client, the `AggregateMarketValueSection` component and its import are deleted. The DecompositionPanel "Market Fair" card and aggregate vol indicator remain as read-only display of whatever the server received.

### Data shape changes

**`server/api/models.py` (Pydantic — upstream):**
```python
class ClientWsMarketValueFrame(BaseModel):
    """Market value frame sent by the client over /ws/client."""
    type: Literal["market_value"] = "market_value"
    seq: int
    entries: list[MarketValueEntry]  # reuses existing MarketValueEntry
```

No changes to `ClientWsAck` — the existing shape (`seq`, `rows_accepted`, `pipeline_rerun`) works; `rows_accepted` maps to entries accepted.

**`client/ui/src/types.ts`** — no changes needed (types already added in prior pass).

### Files to create

None — all changes are modifications to existing files.

### Files to modify

| File | Change |
|------|--------|
| `server/api/models.py` | Add `ClientWsMarketValueFrame` |
| `server/api/client_ws.py` | Dispatch on `type` field: `"market_value"` → store write + ACK, default → existing snapshot path |
| `client/ui/src/components/DesiredPositionGrid.tsx` | Remove `AggregateMarketValueSection` import and render |
| `client/ui/src/components/ApiDocs.tsx` | Document `market_value` frame type under Client WebSocket section |

### Files to delete

| File | Reason |
|------|--------|
| `client/ui/src/components/floor/AggregateMarketValueSection.tsx` | Manual input replaced by WS ingestion |

## Test Cases

- **Happy path:** Send `{"type": "market_value", "seq": 1, "entries": [{"symbol": "BTC", "expiry": "2026-01-02T00:00:00", "total_vol": 0.55}]}` → ACK with `rows_accepted: 1`, store has the entry, dirty flag set.
- **Batch:** Send 10 entries in one frame → ACK with `rows_accepted: 10`.
- **Backwards compatible:** Send a frame without `type` field → treated as snapshot, existing behavior unchanged.
- **Invalid total_vol (negative):** → error response with detail.
- **Empty entries list:** → error response (min_length=1 validation).
- **Rapid fire (10 frames/sec):** Store absorbs all writes; ticker reruns once per tick interval.
- **No data sent:** No aggregate in store → per-block fallback to `market_value = raw_value` (existing behavior).
- **Expiry in the past:** Stored as-is; pipeline ignores dimensions with no blocks.

## Out of Scope

- **Building an exchange adapter.** The trader's systems produce the aggregate vol number. Posit receives it.
- **Computing IV from option chains.** Posit receives a single number, not raw market data.
- **Multi-exchange aggregation.** If the trader wants to average Deribit + OKX vol, they do it before sending.
- **WS outbound for market value state.** The trader doesn't need Posit to echo back what they sent; they see the effect in `totalMarketFair` on the position broadcast.
- **Persistence across server restarts.** In-memory store, same as the stream registry.

## Manual Brain Boundary

This feature does not touch `server/core/`. All changes are in `server/api/` (frame handling) and `client/ui/` (UI cleanup + docs).
