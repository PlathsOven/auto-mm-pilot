# Posit SDK — Quickstart

The Python client for pushing a data feed into Posit and reading back desired
positions. If you are looking at more than ~30 minutes to ship an integration,
something in this SDK should have caught it sooner — please open an issue.

**Contents**

1. [Install + sanity-check](#install--sanity-check)
2. [Your first integration (5 minutes)](#your-first-integration-5-minutes)
3. [Three things that will bite you](#three-things-that-will-bite-you)
    1. [Every stream is dimensioned on `(symbol, expiry)`](#a-every-stream-is-dimensioned-on-symbol-expiry)
    2. [Missing `market_value` → zero positions](#b-missing-market_value--zero-positions)
    3. [Units: raw → target](#c-units-raw--target)
4. [Going to production](#going-to-production)
5. [Debugging when positions look wrong](#debugging-when-positions-look-wrong)
6. [Error cheatsheet](#error-cheatsheet)
7. [Long-lived feeder checklist](#long-lived-feeder-checklist)

---

## Install + sanity-check

```bash
pip install posit-sdk                # Python 3.10+
```

You need three things from your Posit operator:

| Variable           | Example                  | Where it comes from          |
|--------------------|--------------------------|------------------------------|
| `POSIT_URL`        | `http://localhost:8001`  | Operator's deploy. Note `:8001`, not `:8000`. |
| `POSIT_API_KEY`    | `pk_live_…`              | Account page on the terminal. |
| `POSIT_BANKROLL`   | `100000`                 | Your risk capital — the Kelly sizing reads it. |

Before you write any integration code, confirm the server is alive and
your key works:

```bash
curl $POSIT_URL/api/health                                  # → {"status":"ok"}
curl -H "X-API-Key: $POSIT_API_KEY" $POSIT_URL/api/streams  # → {"streams":[...]}
```

> **API key, two surfaces.** REST uses the `X-API-Key` header; the
> WebSocket appends `?api_key=…` to the upgrade URL. Same token, the SDK
> does both for you.

---

## Your first integration (5 minutes)

This registers one stream, pushes one row, reads one position. REST-only
(the default) — no WebSocket needed for ingest.

```python
import asyncio
from posit_sdk import PositClient, SnapshotRow

async def main():
    async with PositClient(url="http://localhost:8001", api_key="…") as client:
        # 1. Register the stream — idempotent, safe to re-run forever.
        #    `_for_variance` sets exponent=2 (vol → variance), the common case.
        await client.configure_stream_for_variance(
            "rv_btc", key_cols=["symbol", "expiry"],
        )
        await client.set_bankroll(1_000_000.0)

        # 2. Push a row. `market_value` is non-optional for non-zero positions.
        await client.push_snapshot("rv_btc", [
            SnapshotRow(
                timestamp="2026-01-01T00:00:00",
                raw_value=0.65,     # realised vol, decimal (65%)
                market_value=0.70,  # market-implied vol, same units
                symbol="BTC",
                expiry="27MAR26",
            ),
        ])

        # 3. Read back the latest desired positions.
        payload = await client.get_positions()
        for pos in payload.positions:
            print(pos.symbol, pos.expiry, pos.desired_pos)

asyncio.run(main())
```

**What this already gets right:**

- **Auth fails fast.** A bad key raises `PositAuthError` on `__aenter__`
  — no later call silently mis-fires against a dead key.
- **Setup is idempotent.** `configure_stream_for_variance` is a wrapper
  over `upsert_stream`; re-running it is a no-op when the config matches.
- **No silent pushes.** Pushing to an unregistered stream raises
  `PositStreamNotRegistered` synchronously — zero HTTP traffic.
- **Validation at the call site.** Bad timestamps, malformed `BlockConfig`,
  and `key_cols` that miss the server's risk dimensions all raise before
  the network.

---

## Three things that will bite you

If your first integration doesn't work, 90% of the time it's one of these.

### a. Every stream is dimensioned on `(symbol, expiry)`

Posit's pipeline operates per `(symbol, expiry)` pair. Your stream's
`key_cols` **must include both**; additional keys (e.g. `event_id`) are
fine alongside.

If your feed is naturally scalar — a global funding rate, an event
announcement — you don't have `symbol` or `expiry` on each row. Fan it out:

```python
await client.push_fanned_snapshot(
    "fomc_event",
    [SnapshotRow(timestamp="…", raw_value=0.25, market_value=0.25)],
    # Omit `universe=` to fetch the server's current (symbol, expiry) list.
)
```

The helper duplicates each input row across the universe, stamping `symbol`
and `expiry` on each copy. Input rows **must not** already carry those
fields.

### b. Missing `market_value` → zero positions

**The single most common integrator failure.** If a `SnapshotRow` omits
`market_value`, each block's market defaults to its own fair →
`edge = fair − market_fair = 0` → `desired_pos = 0`. The stream looks
healthy; positions silently flatline.

Two canonical paths — pick one per stream:

1. **Per-row:** set `market_value=…` on every `SnapshotRow`. Best when the
   market implied is a property of each reading.
2. **Aggregate:** call `client.set_market_values([MarketValueEntry(…)])`
   once per `(symbol, expiry)`. Best when many streams share the same
   reference (e.g. a total-vol per expiry).

Per-row values override the aggregate on their own tuple.

**Three defenses, in order of how loud they are:**

| Layer  | Behavior |
|--------|----------|
| SDK log | `logging.WARNING` the first time a stream is pushed without `market_value`. |
| SDK warning | `PositZeroEdgeWarning` via `warnings.warn` on the next `positions()` payload — notebook-visible by default. |
| Server | `PositZeroEdgeBlocked` (HTTP 422) on the *first* push to a fresh stream when no row carries `market_value` AND no aggregate covers the pairs. |

**To opt out** of the server guard (you genuinely want a zero-edge first
push), pass `allow_zero_edge=True` to `ingest_snapshot` / `push_snapshot`.

### c. Units: raw → target

Every stream has a raw-to-target transform:

```
target = (scale · raw + offset) ** exponent
```

Target space is where the pipeline math runs — typically **variance**.

| Goal                          | Helper                                                     | Effective transform      |
|-------------------------------|------------------------------------------------------------|--------------------------|
| Annualised vol → variance     | `configure_stream_for_variance(name, key_cols)`            | `raw²`                   |
| Already in target units       | `configure_stream_for_linear(name, key_cols)` (defaults)   | `raw`                    |
| Unit re-scale (e.g. bps → dec)| `configure_stream_for_linear(name, key_cols, scale=0.01)`  | `0.01 · raw`             |
| Custom transform              | `upsert_stream(name, key_cols=…, scale=…, offset=…, exponent=…)` | your choice        |

**The rule that catches the most people:** `raw_value` and `market_value`
must share units *before* the transform. If both are vol (0.65 / 0.70)
with `exponent=2`, both land in variance consistently. Never mix vol and
pre-squared variance within a single stream.

---

## Going to production

Once the hello-world works, these patterns take you from toy to long-lived
feeder.

### Register everything in one atomic call

```python
from posit_sdk import BlockConfig, StreamSpec

await client.bootstrap_streams(
    [
        StreamSpec(stream_name="rv_btc", key_cols=["symbol", "expiry"],
                   exponent=2.0),
        StreamSpec(stream_name="ema_iv", key_cols=["symbol", "expiry"],
                   exponent=2.0, block=BlockConfig(annualized=True)),
        StreamSpec(stream_name="events", key_cols=["symbol", "expiry", "event_id"],
                   block=BlockConfig(annualized=False)),
    ],
    bankroll=1_000_000.0,
)
```

One call, idempotent, **atomic**: if any step fails, every stream this
call newly created is rolled back. Re-run on every process launch —
pre-existing streams get reconfigured, new ones get created.

> **Do not use** `create_stream` + `configure_stream` (the two-phase API).
> They emit `FutureWarning` in v0.1 and are removed in v0.2. `upsert_stream`
> and `bootstrap_streams` replace them.

### Typed rows per stream

`SnapshotRow` accepts arbitrary extras — convenient but loses IDE
completion and mypy coverage on your `key_cols`. Ask the SDK for a
stream-specific subclass:

```python
RvBtcRow = await client.row_class_for("rv_btc")
row = RvBtcRow(
    timestamp="2026-01-01T00:00:00",
    raw_value=0.65,
    market_value=0.70,
    symbol="BTC",      # required — declared on the class
    expiry="27MAR26",  # required — declared on the class
)
```

The class is built once per stream (from `describe_stream`) and cached
for the client's lifetime. Missing keys raise at construction, not on the
server's 422.

### Live-streamed positions (WebSocket)

REST polling is fine for most feeders. If you want the lowest-latency
position updates — or you're building a UI on top — open the WebSocket:

```python
async with PositClient(url="…", api_key="…", connect_ws=True) as client:
    async for payload in client.positions():
        print(payload.transport, payload.seq, payload.positions)
```

- `payload.transport` is `"ws"` when live-streamed, `"poll"` when
  `positions()` has degraded to REST polling. Render a freshness indicator.
- `payload.seq` / `payload.prev_seq` are per-user monotonic. Use them to
  detect gaps.

If the WS drops and reconnects, backfill the gap:

```python
resp = await client.positions_since(last_seen_seq)
for payload in resp.payloads:
    ...
if resp.gap_detected:
    # Your seq was older than the server's replay buffer — treat state as stale.
    ...
```

### Subscribe to structured SDK events

Useful in notebooks and managed processes where Python logging is invisible:

```python
async def watch(client):
    async for evt in client.events():
        # evt.type ∈ {market_value_missing, ws_fallback, ws_reconnected,
        #             positions_degraded, zero_edge_warning}
        pager.send(f"[posit] {evt.type}: {evt.detail}")
```

Unbounded queue — drain it or don't subscribe.

---

## Debugging when positions look wrong

### "Why is everything zero?" → start here

```python
report = await client.diagnose_zero_positions()
for d in report.diagnostics:
    print(d.symbol, d.expiry, d.reason, "→", d.hint)
```

Returns one row per near-zero `(symbol, expiry)` with a closed-enum
`reason`:

| Reason                | What to fix                                                 |
|-----------------------|-------------------------------------------------------------|
| `no_market_value`     | Add `market_value` per-row or call `set_market_values(…)`.  |
| `zero_variance`       | All blocks on this dim have `var=0`. Check `var_fair_ratio`.|
| `zero_bankroll`       | `client.set_bankroll(positive_value)`.                      |
| `no_active_blocks`    | No stream covers this dim. Register one, or flip active.    |
| `edge_coincidence`    | `edge=0` but MV is set; pipeline genuinely sees fair=market.|
| `unknown`             | Scalars are non-zero — inspect `smoothing`/`position_sizing`.|

### "Is my data actually landing?"

```python
state = await client.describe_stream("rv_btc")
# state.status, state.row_count, state.last_ingest_ts
```

Skip `tail -f` on the server — this is the same data.

### "Is the server up?"

```python
await client.health()
```

---

## Error cheatsheet

| Error                                                | Cause                                                                 | Fix                                                                 |
|------------------------------------------------------|-----------------------------------------------------------------------|---------------------------------------------------------------------|
| `PositAuthError` at `__aenter__`                     | API key is invalid or expired.                                        | Rotate on the Account page; update `api_key=`.                      |
| `PositConnectionError` at `__aenter__`               | WS handshake timed out.                                               | Check server URL. Pass `connect_timeout=None` to skip the wait.     |
| `PositValidationError: key_cols must include …`      | `key_cols` missing a server risk dimension.                           | Include `symbol` and `expiry`. Extras are fine alongside.           |
| `PositValidationError: timestamp …`                  | Row timestamp unparseable.                                            | ISO 8601 preferred (`"2026-03-27T00:00:00"`). `"27MAR26"` accepted. |
| `ValueError: decay_end_size_mult …`                  | `BlockConfig` contradiction at construction.                          | `annualized=True` OR `decay_end_size_mult=0`.                       |
| `PositStreamNotRegistered`                           | Pushing to a stream the server forgot (often after a server restart). | `upsert_stream(…)` again, then retry.                               |
| `PositZeroEdgeWarning`                               | Typed warning on `positions()` after a bare-market push.              | See [missing `market_value`](#b-missing-market_value--zero-positions). |
| `PositZeroEdgeBlocked` (HTTP 422 `ZERO_EDGE_BLOCKED`)| First push on a fresh stream would zero every position.               | Add `market_value`, call `set_market_values([…])`, or `allow_zero_edge=True`. |
| `PositApiError 422 …is not READY`                    | Stream registered but not configured.                                 | `upsert_stream(…)` — it's atomic.                                   |
| `PositApiError 409 Stream '…' already exists`        | Raw `create_stream` on a pre-existing stream.                         | `upsert_stream(…)` — idempotent.                                    |
| `FutureWarning: create_stream / configure_stream …`  | Two-phase legacy path.                                                | Migrate to `upsert_stream` / `bootstrap_streams`. Removed in v0.2.  |

---

## Long-lived feeder checklist

Before shipping:

- [ ] Connects with an explicit `POSIT_URL` + `POSIT_API_KEY`; never hard-codes.
- [ ] Uses `bootstrap_streams` / `upsert_stream` — never raw `create_stream`.
- [ ] Sets `market_value` per-row **or** calls `set_market_values(…)` *before* the first ingest.
- [ ] Handles `PositStreamNotRegistered` by re-upserting, not by silent retry.
- [ ] Treats `PositAuthError` as terminal — stops and surfaces it to the operator.
- [ ] Subscribes to `client.events()` if running unattended (surface state changes somewhere visible).
- [ ] On WS reconnect (`connect_ws=True`), calls `positions_since(last_seen_seq)` to close the gap.
