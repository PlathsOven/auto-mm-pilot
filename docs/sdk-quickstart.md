# Posit SDK — Quickstart

End-to-end guide to wiring a data feed into Posit via `posit-sdk` (Python).
If your integration takes more than ~30 minutes you've hit something the
SDK should have caught for you — please open an issue.

- [Hello world](#hello-world) — register a stream, push one row, consume one position update.
- [Unit conventions](#unit-conventions) — what `raw_value`, `market_value`, and `exponent` actually mean.
- [Error cheatsheet](#error-cheatsheet) — every error the SDK / server can throw, mapped to the fix.

---

## Prerequisites

1. A Posit server reachable over HTTPS (or `http://localhost:8000` in dev).
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

---

## Hello world

Register a stream, set bankroll, push one snapshot, consume one position
update — in ~20 lines:

```python
import asyncio
from posit_sdk import PositClient, SnapshotRow, StreamSpec

async def main():
    async with PositClient(url="http://localhost:8000", api_key="...") as client:
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

Key behaviours this already gets right for you:

- **Auth hard-block.** A bad API key raises `PositAuthError` from
  `__aenter__` before any later call can silently fail against a dead key.
- **Idempotent setup.** `bootstrap_streams` is safe to re-run on every
  process launch — streams get created if absent, reconfigured if present,
  atomically rolled back on any failure.
- **Typed validation.** `BlockConfig(annualized=False, decay_end_size_mult=1.0)`
  raises at construction time; `SnapshotRow(timestamp="yesterday", ...)`
  raises on the row itself; `create_stream(key_cols=["symbol"])` raises
  with a message that names the missing risk dimension (`expiry`).
- **No silent pushes.** `push_snapshot` to an unregistered stream raises
  `PositStreamNotRegistered` synchronously — no HTTP traffic leaves
  the process.
- **WS → REST fallback.** If the live socket is down, pushes fall back to
  REST (slower but correct) and one WARN per state transition is logged.

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

**Fix.** Pass `market_value` on every row (preferred), or call
`set_market_values([...])` to set the aggregate per `(symbol, expiry)`.
The SDK emits one `WARNING` per stream the first time it sees a push
without `market_value` — heed it.

---

## Error cheatsheet

| Error                                   | What it means                                                                        | Fix                                                                                  |
|-----------------------------------------|--------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `PositAuthError` from `__aenter__`      | Your API key is invalid or expired.                                                  | Rotate the key on the Account page; update `api_key=` in the client ctor.            |
| `PositConnectionError` from `__aenter__`| WS handshake timed out (`connect_timeout`, default 10s).                             | Check server reachability. Pass `connect_timeout=None` to skip WS wait.              |
| `PositValidationError: key_cols must include [...]` | Your `key_cols` don't cover the server's risk dimensions (`["symbol", "expiry"]`).  | Include both. Extra stream-specific keys (e.g. `event_id`) are fine alongside.       |
| `PositValidationError: timestamp must be ISO 8601 or DDMMMYY` | Row timestamp is unparseable.                                                       | Use `"2026-03-27T00:00:00"` or `"27MAR26"`.                                          |
| `ValueError: decay_end_size_mult is only applicable for annualized streams` | Contradictory `BlockConfig` — caught at construction.                              | Either `annualized=True` or `decay_end_size_mult=0`.                                 |
| `PositStreamNotRegistered: Stream 'X' is not registered` | You're pushing to a stream the server doesn't know. Often a server restart wiped the registry. | Call `upsert_stream(...)` with the same spec you registered originally, then retry. |
| `PositApiError HTTP 409 {"code": "STREAM_NOT_REGISTERED", ...}` | Same as above but from a hand-rolled client. | Register via `POST /api/streams` + `POST /api/streams/{name}/configure` before pushing. |
| `PositApiError HTTP 422 ... is not READY` | Stream is registered but has no `scale`/`block` configured.                         | `configure_stream(name, scale=..., block=...)` or `upsert_stream(...)`.              |
| `PositApiError HTTP 409 Stream 'X' already exists` | Raw `create_stream` call on a pre-existing stream.                                 | Use `upsert_stream(...)` — it's idempotent.                                          |

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
