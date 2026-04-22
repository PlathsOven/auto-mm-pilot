# Posit SDK — Quickstart

End-to-end guide to wiring a data feed into Posit via `posit-sdk` (Python).
If your integration takes more than ~30 minutes you've hit something the
SDK should have caught for you — please open an issue.

- [Hello world](#hello-world) — register a stream, push one row, consume one position update.
- [Unit conventions](#unit-conventions) — what `raw_value`, `market_value`, and `exponent` actually mean.
- [Error cheatsheet](#error-cheatsheet) — every error the SDK / server can throw, mapped to the fix.

---

## Prerequisites

1. A Posit server reachable over HTTPS (or `http://localhost:8001` in dev —
   the server binds `:8001`, not `:8000`).
2. An account on that server — the operator creates one via signup; the
   API key is surfaced on the Account page.
3. Python 3.10+ and `pip install posit-sdk`.

Before you write any integration code, sanity-check that the server is
alive and that your target stream(s) are registered:

```bash
curl $POSIT_URL/api/health                                  # {"status": "ok"}
curl -H "X-API-Key: $POSIT_API_KEY" $POSIT_URL/api/streams  # list of registered streams
```

Long-lived feeder processes **must** repeat this check on every reconnect.
The SDK handles it automatically; hand-rolled clients must not.

**API key — same token, two injection surfaces.** REST sends
`X-API-Key: <key>` as a header; the WebSocket appends `?api_key=<key>` to
the upgrade URL. The SDK does both for you; hand-rolled clients must match.

---

## Hello world

Register a stream, set bankroll, push one snapshot, consume one position
update — in ~20 lines:

```python
import asyncio
from posit_sdk import PositClient, SnapshotRow, StreamSpec

async def main():
    # Default connect_ws=False — REST-only is the integrator norm.  Pass
    # connect_ws=True if you want live-streamed positions() / low-latency push.
    async with PositClient(url="http://localhost:8001", api_key="...",
                           connect_ws=True) as client:
        await client.bootstrap_streams(
            [StreamSpec(stream_name="rv_btc",
                        key_cols=["symbol", "expiry"],
                        scale=1.0, offset=0.0, exponent=2.0)],  # vol → variance
            bankroll=1_000_000.0,
        )
        await client.push_snapshot("rv_btc", [
            SnapshotRow(timestamp="2026-01-01T00:00:00",
                        raw_value=0.65, market_value=0.70,
                        symbol="BTC", expiry="27MAR26"),
        ])
        async for payload in client.positions():
            print(payload.positions[0].symbol, payload.positions[0].desired_pos)
            break

asyncio.run(main())
```

Prefer a shortcut for the common transforms:

```python
# vol → variance
await client.configure_stream_for_variance("rv_btc", ["symbol", "expiry"])
# linear (degenerates to passthrough when scale=1.0, offset=0.0)
await client.configure_stream_for_linear("funding_bps",
                                         ["symbol", "expiry"], scale=0.01)
```

Key behaviours this already gets right for you:

- **Auth hard-block.** A bad API key raises `PositAuthError` from
  `__aenter__` before any later call can silently fail against a dead key.
- **Idempotent setup.** `bootstrap_streams` is safe to re-run on every
  process launch — streams get created if absent, reconfigured if present,
  atomically rolled back on any failure.
- **Typed validation.** `BlockConfig(size_type="relative", annualized=False)`
  raises at construction time; `SnapshotRow(timestamp="yesterday", ...)`
  raises on the row itself; `upsert_stream(key_cols=["symbol"])` raises
  with a message that names the missing risk dimension (`expiry`).
- **Sentinel defaults.** `BlockConfig(annualized=False)` works — the SDK
  resolves `decay_end_size_mult` to the right value per `annualized` so the
  default never fights the validator.
- **No silent pushes.** `push_snapshot` to an unregistered stream raises
  `PositStreamNotRegistered` synchronously — no HTTP traffic leaves
  the process.
- **Typed zero-edge warning.** The first `positions()` payload after a push
  missing `market_value` emits `PositZeroEdgeWarning` via `warnings.warn` —
  the notebook-visible escalation of the logs-only WARN.
- **WS → REST fallback.** If the live socket is down, pushes fall back to
  REST (slower but correct) and one WARN per state transition is logged.

> **Why `create_stream` + `configure_stream` are deprecated.**  The two-phase
> setup left every integrator in a PENDING-before-READY gap where pushes
> could silently land in limbo.  `upsert_stream` (one stream) /
> `bootstrap_streams` (many) collapse both phases into one atomic,
> idempotent call with self-rollback. The raw two-phase methods now emit
> `FutureWarning` and will be removed in posit-sdk v0.2.

---

## Unit conventions

Everything the pipeline computes lives in **target space**. The transform
from raw to target is per-stream, via `(scale, offset, exponent)`:

```
target = (scale · raw + offset) ** exponent
```

| Field                          | Meaning                                                          | Common pattern                          |
|--------------------------------|------------------------------------------------------------------|-----------------------------------------|
| `raw_value`                    | The stream's natural measurement (e.g. annualised vol, decimal). | `0.65` = 65% annualised vol             |
| `market_value`                 | Market-implied value in **the same units as** `raw_value`.       | `0.70` = market-implied annualised vol  |
| `scale`                        | Multiplicative scale factor (pre-exponent).                      | `1.0` for already-correct units         |
| `offset`                       | Additive offset (pre-exponent).                                  | `0.0` unless you're re-basing           |
| `exponent`                     | Power exponent. Target space is usually **variance**, so...      | `2.0` for vol → variance                |
| `fair` / `target_value`        | The pipeline's per-block output in target space.                 | `0.65² = 0.4225` (annualised variance)  |
| `total_fair`                   | Aggregated target-space fair value per dimension.                | (Summed across blocks on the same dim.) |
| `block.var_fair_ratio`         | Confidence weight: higher = tighter distribution = larger size.  | `1.0` is the neutral default            |

**The rule that catches the most people:** `fair` and `market_value` (after
the same transform) must share units. If you push `raw_value` in vol (0.65)
and `market_value` also in vol (0.70), with `exponent=2`, both land in
variance space consistently. If your `market_value` is already squared
somewhere upstream, you need a separate stream or a different transform —
do not mix conventions within one stream.

---

## The `market_value` footgun

**Symptom.** Your stream is green, data is flowing, and every desired
position is 0.00. You didn't break anything — you forgot `market_value`.

**Why.** If a `SnapshotRow` omits `market_value`, Posit defaults each
block's market to its own `fair`. `edge = fair - market_fair` collapses
to 0. `desired_pos = edge · bankroll / var` collapses to 0.

**Fix.** Pick one canonical path:

1. **Per-row `market_value`.** Pass it on every `SnapshotRow` you push.
   Fine-grained, fine for one-off and event-driven streams.
2. **Aggregate via `set_market_values(...)`.** One value per `(symbol,
   expiry)` — the pipeline applies it to every block on that dimension
   under this feeder. Cleaner when many streams share a single market
   reference (e.g. total vol per expiry).

Mixing is allowed — per-row values override the aggregate on their own
`(symbol, expiry, stream)` tuple. Do not assume any other precedence.

**Discoverability.** The SDK emits a `logging.WARNING` the first time it
sees a push without `market_value`, and escalates to a typed
`PositZeroEdgeWarning` on the next `positions()` payload (surfaced via
`warnings.warn`, notebook-visible by default). Either is the signal
that your positions are about to be zero for a structural reason.

**Server-side hard guard.** On the *first* push to a freshly-configured
stream, the server refuses any batch that would zero every position —
i.e. no row carries `market_value` **and** no aggregate market value
covers the `(symbol, expiry)` pairs in the batch. The SDK translates
the 422 response into `PositZeroEdgeBlocked`. Recover by:

1. Adding `market_value` to at least one row, **or**
2. Calling `client.set_market_values([...])` to populate the aggregate
   store for the missing pairs first, **or**
3. Passing `allow_zero_edge=True` to `ingest_snapshot` / `push_snapshot`
   — the explicit "yes, I accept zero positions" opt-out.

Subsequent pushes are not gated — the first one establishes the pattern.

---

## Error cheatsheet

| Error                                   | What it means                                                                        | Fix                                                                                  |
|-----------------------------------------|--------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `PositAuthError` from `__aenter__`      | Your API key is invalid or expired.                                                  | Rotate the key on the Account page; update `api_key=` in the client ctor.            |
| `PositConnectionError` from `__aenter__`| WS handshake timed out (`connect_timeout`, default 10s).                             | Check server reachability. Pass `connect_timeout=None` to skip WS wait.              |
| `PositValidationError: key_cols must include [...]` | Your `key_cols` don't cover the server's risk dimensions (`["symbol", "expiry"]`).  | Include both. Extra stream-specific keys (e.g. `event_id`) are fine alongside.       |
| `PositValidationError: timestamp must be ISO 8601 or DDMMMYY` | Row timestamp is unparseable.                                                       | Use `"2026-03-27T00:00:00"` (canonical). `"27MAR26"` is accepted for legacy feeds.   |
| `ValueError: decay_end_size_mult is only applicable for annualized streams` | Contradictory `BlockConfig` — caught at construction.                              | Either `annualized=True` or `decay_end_size_mult=0`.                                 |
| `PositStreamNotRegistered: Stream 'X' is not registered` | You're pushing to a stream the server doesn't know. Often a server restart wiped the registry. | Call `upsert_stream(...)` with the same spec you registered originally, then retry. |
| `PositApiError HTTP 409 {"code": "STREAM_NOT_REGISTERED", ...}` | Same as above but from a hand-rolled client. | Register via `POST /api/streams` + `POST /api/streams/{name}/configure` before pushing. |
| `PositApiError HTTP 422 ... is not READY` | Stream is registered but has no `scale`/`block` configured.                         | `configure_stream(name, scale=..., block=...)` or `upsert_stream(...)`.              |
| `PositApiError HTTP 409 Stream 'X' already exists` | Raw `create_stream` call on a pre-existing stream.                                 | Use `upsert_stream(...)` — it's idempotent.                                          |
| `FutureWarning: create_stream is deprecated` / `configure_stream is deprecated` | You're on the two-phase legacy path. | Switch to `upsert_stream(...)` / `bootstrap_streams(...)`. Removed in v0.2. |
| `PositZeroEdgeWarning: Streams ['X'] pushed rows without market_value` | The typed escalation of the market_value footgun — surfaced on `positions()`. | See "The `market_value` footgun" above. Suppress via `warnings.simplefilter("ignore", PositZeroEdgeWarning)` only if you accept the consequence. |
| `PositZeroEdgeBlocked` (HTTP 422 `ZERO_EDGE_BLOCKED`) | Server refused your first push on a fresh stream — it would zero every position. | Add `market_value` on rows, call `set_market_values([...])` for the listed pairs, or pass `allow_zero_edge=True` to acknowledge zero positions. |

---

## Fan-out for scalar-shaped feeds

Some feeds are naturally scalar — a market-wide funding rate, an event
announcement, a global indicator — and don't carry `(symbol, expiry)` on
each row. But every Posit stream must be dimensioned on the risk cols.
Use `push_fanned_snapshot` to duplicate each scalar row across a universe:

```python
await client.push_fanned_snapshot(
    "fomc_event",
    [SnapshotRow(timestamp="2026-03-20T14:00:00",
                 raw_value=0.25, market_value=0.25)],
    # Pass universe=[...] for a scoped fan-out, or omit to fetch
    # the server's current (symbol, expiry) universe automatically.
)
```

Input rows must not already carry `symbol`/`expiry` — the helper inserts
them per pair.

---

## Observability during development

- `client.health()` → server reachability + version.
- `client.describe_stream("rv_btc")` → status, row_count, last_ingest_ts. Use this as your "is my data actually landing?" check instead of `tail -f` on the server logs.
- `client.positions()` degrades to REST polling if the WS is unavailable; one `WARNING` per degradation so you know latency has changed.

---

## Long-lived feeder checklist

Before shipping a feeder process, verify:

- [ ] Runs `client.health()` and `client.list_streams()` on startup and on every reconnect.
- [ ] Uses `upsert_stream` / `bootstrap_streams`, not raw `create_stream`.
- [ ] Sets `market_value` on every row, or accepts that edge will be 0 without it.
- [ ] Handles `PositStreamNotRegistered` by re-upserting the stream spec, not by silently retrying.
- [ ] Does not treat `PositAuthError` as transient — stop and surface it.
