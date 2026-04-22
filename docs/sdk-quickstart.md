# Posit SDK — Quickstart

Posit is a positional trading advisor for crypto options market-making desks:
it ingests numeric feeds, runs them through a pricing pipeline, and returns
a desired position per `(symbol, expiry)`. This SDK (Python 3.10+) is the
client you use to push those feeds and read the positions back.

> Target time to a working integration: under 30 minutes. If you're not
> there, something below should have caught you sooner — please open an
> issue.

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

You need two things from your Posit operator:

| Variable        | Example                  | Where it comes from                           |
|-----------------|--------------------------|-----------------------------------------------|
| `POSIT_URL`     | `http://localhost:8001`  | Operator's deploy. Note `:8001`, not `:8000`. |
| `POSIT_API_KEY` | `pk_live_…`              | Account page on the terminal.                 |

Before writing any integration code, confirm the server is alive and your
key is accepted:

```bash
curl $POSIT_URL/api/health                                  # → {"status":"ok"}
curl -H "X-API-Key: $POSIT_API_KEY" $POSIT_URL/api/streams  # → {"streams":[...]}
```

If the second call returns `401`, your key is wrong or expired — rotate it
on the Account page before continuing.

> **One API key, two surfaces.** REST uses the `X-API-Key` header; the
> WebSocket appends `?api_key=…` to the upgrade URL. Same token; the SDK
> handles both.

---

## Your first integration (5 minutes)

The minimum viable feeder: register one stream, push one row, read one
position. REST-only (the default) — no WebSocket required.

```python
import asyncio, os
from posit_sdk import PositClient, SnapshotRow

async def main():
    async with PositClient(
        url=os.environ["POSIT_URL"],
        api_key=os.environ["POSIT_API_KEY"],
    ) as client:
        # 1. Register the stream. Idempotent — safe to re-run on every launch.
        #    `_for_variance` is a shortcut that sets exponent=2 (vol → variance),
        #    which is the common case for a realised-vol feed.
        await client.configure_stream_for_variance(
            "rv_btc", key_cols=["symbol", "expiry"],
        )
        await client.set_bankroll(1_000_000.0)

        # 2. Push one reading. `market_value` is mandatory for non-zero
        #    positions — see "Three things that will bite you" below.
        await client.push_snapshot("rv_btc", [
            SnapshotRow(
                timestamp="2026-01-01T00:00:00",
                raw_value=0.65,     # realised vol (65% annualised, decimal)
                market_value=0.70,  # market-implied vol, same units
                symbol="BTC",
                expiry="27MAR26",
            ),
        ])

        # 3. Read back Posit's advice.
        payload = await client.get_positions()
        for pos in payload.positions:
            print(pos.symbol, pos.expiry, pos.desired_pos)

asyncio.run(main())
```

What the SDK handles so you don't have to:

- **Auth fails fast.** A bad key raises `PositAuthError` on the `async
  with` entry — no later call mis-fires silently against a dead key.
- **Setup is idempotent.** `configure_stream_for_variance` wraps
  `upsert_stream`; re-running with the same args is a no-op.
- **No silent pushes.** Pushing to an unregistered stream raises
  `PositStreamNotRegistered` synchronously — no HTTP traffic leaves the
  process.
- **Validation at the call site.** Bad timestamps, malformed `BlockConfig`,
  and `key_cols` that miss the server's risk dimensions all raise before
  the network.

---

## Three things that will bite you

These are the three data-model facts every integrator has to internalise.
Missing any one of them silently produces wrong answers.

### a. Every stream is dimensioned on `(symbol, expiry)`

**Rule.** Posit's pipeline operates per `(symbol, expiry)` pair. Every
stream's `key_cols` must include both. Extra keys (e.g. `event_id`) are
fine alongside.

**If your feed is scalar.** Some feeds are global — a funding rate, a
macro event, a market-wide indicator — and don't have `symbol`/`expiry`
on each row. Fan them out instead:

```python
# Scalar row → duplicated across every live (symbol, expiry) pair.
await client.push_fanned_snapshot(
    "fomc_event",
    [SnapshotRow(timestamp="2026-03-20T14:00:00",
                 raw_value=0.25, market_value=0.25)],
    # universe=[("BTC", "27MAR26"), ...] for a scoped fan-out,
    # or omit to auto-fetch the server's current universe.
)
```

The helper stamps `symbol` and `expiry` on each copy. Input rows must
not already carry those fields (that's a programming error, not a
style choice).

### b. Missing `market_value` → zero positions

> **The single most common integrator failure.**

**Symptom.** Stream is green, rows are flowing, every desired position
reads `0.00`.

**Cause.** No `market_value` anywhere — per-row or aggregate. Each block's
market defaults to its own fair, so `edge = fair − market_fair = 0`, and
`desired_pos = edge · bankroll / var = 0`.

**Fix.** Pick one path per stream:

1. **Per-row:** set `market_value=…` on every `SnapshotRow`. Use when the
   market-implied value is a property of each reading.
2. **Aggregate:** call `client.set_market_values([MarketValueEntry(…)])`
   once per `(symbol, expiry)`. Use when a single reference (e.g. total
   vol per expiry) backs many streams.

Per-row values override the aggregate on their own tuple; don't assume
other precedence.

**Safety net — three progressively louder defenses:**

| Layer         | When it fires                                              | What you see                              |
|---------------|------------------------------------------------------------|-------------------------------------------|
| SDK log       | First bare-market push per stream                          | `logging.WARNING`                         |
| SDK warning   | First `positions()` payload after a bare-market push       | `PositZeroEdgeWarning` (notebook-visible) |
| Server guard  | First push to a *fresh* stream with no market value anywhere | HTTP 422 → `PositZeroEdgeBlocked`       |

If you genuinely want a zero-edge first push (e.g. you know the first
rows are sighting data and aggregate values will arrive later), pass
`allow_zero_edge=True` to `ingest_snapshot` / `push_snapshot`.

### c. Units: raw → target

**Rule.** Every stream applies a transform from raw units to target
units before the pipeline sees the value:

```
target = (scale · raw + offset) ** exponent
```

Target space is where the math runs — typically **variance**. Raw
space is whatever your feed emits natively.

**Pick the right helper:**

| Your feed                          | Helper                                                              | Transform      |
|------------------------------------|---------------------------------------------------------------------|----------------|
| Annualised vol (e.g. `0.65`)       | `configure_stream_for_variance(name, key_cols)`                     | `raw²`         |
| Already in target units            | `configure_stream_for_linear(name, key_cols)`                       | `raw`          |
| Needs re-scaling (e.g. bps → dec)  | `configure_stream_for_linear(name, key_cols, scale=0.01)`           | `0.01 · raw`   |
| Anything custom                    | `upsert_stream(name, key_cols=…, scale=…, offset=…, exponent=…)`    | caller's choice|

**The rule that catches the most people.** `raw_value` and `market_value`
must share units *before* the transform. If both are vol (0.65 / 0.70)
and `exponent=2`, they both land in variance consistently. Never mix vol
and pre-squared variance within one stream.

---

## Going to production

The hello-world runs; now you need it to survive restarts, handle
reconnects, and stay observable. Adopt these patterns as you go.

### Register everything atomically

One call registers or reconfigures every stream plus bankroll, and rolls
back any newly-created streams if later steps fail:

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

Safe to re-run on every process launch: existing streams reconfigure in
place, new ones get created, a mid-flight failure unwinds the ones this
call created.

> **Do not use** `create_stream` + `configure_stream` (the two-phase API).
> They emit `FutureWarning` in v0.1 and are removed in v0.2. `upsert_stream`
> and `bootstrap_streams` replace them.

### Typed rows per stream

`SnapshotRow` accepts arbitrary extras, which costs you IDE completion
and mypy coverage on your `key_cols`. For a long-lived feeder, ask the
SDK for a stream-specific subclass:

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
for the client's lifetime. Missing keys raise at construction, before
any network call.

### Live-streamed positions (WebSocket)

REST polling is fine for most feeders. Open the WebSocket when you want
sub-second position updates or you're building a UI on top:

```python
async with PositClient(url=URL, api_key=KEY, connect_ws=True) as client:
    async for payload in client.positions():
        # transport = "ws" when streaming live, "poll" when the socket
        # dropped and positions() has degraded to REST polling.
        if payload.transport == "poll":
            status_bar.show_stale_warning()

        for pos in payload.positions:
            ui.render(pos.symbol, pos.expiry, pos.desired_pos)
```

`payload.seq` / `payload.prev_seq` are per-user monotonic sequence numbers
— use them to detect gaps after a reconnect:

```python
last_seen = 0
async for payload in client.positions():
    if payload.prev_seq != last_seen and last_seen != 0:
        # Gap detected — backfill.
        catchup = await client.positions_since(last_seen)
        for missed in catchup.payloads:
            handle(missed)
        if catchup.gap_detected:
            status_bar.show_gap_warning()  # seq fell off the replay buffer
    handle(payload)
    last_seen = payload.seq
```

### Structured SDK events

For unattended feeders where Python logging is invisible, subscribe to
the structured event stream and route it anywhere (pager, Slack, metrics):

```python
async for evt in client.events():
    # evt.type is one of:
    #   market_value_missing | ws_fallback | ws_reconnected
    #   positions_degraded   | zero_edge_warning
    pager.send(f"[posit/{evt.type}] {evt.detail}")
```

The queue is unbounded — drain it, or don't subscribe.

---

## Debugging when positions look wrong

Work top-down — the earlier question narrows everything below it.

### 1. Is the server reachable?

```python
await client.health()   # → HealthResponse(status="ok")
```

If this fails, stop. Your issue is connectivity or auth, not data.

### 2. Is your data actually landing?

```python
state = await client.describe_stream("rv_btc")
# state.status         → "READY" once configured
# state.row_count      → how many rows the server is holding
# state.last_ingest_ts → when the most recent push landed
```

Run this right after a push to confirm the server accepted it. Beats
`tail -f` on server logs.

### 3. Why is a position zero?

The one-shot diagnostic for the audit's #1 question. Returns one entry
per near-zero `(symbol, expiry)` with a closed-enum `reason`:

```python
report = await client.diagnose_zero_positions()
for d in report.diagnostics:
    print(f"{d.symbol} {d.expiry}: {d.reason} — {d.hint}")
```

| Reason               | What to fix                                                     |
|----------------------|-----------------------------------------------------------------|
| `no_market_value`    | Add `market_value` per-row, or call `set_market_values([…])`.   |
| `zero_variance`      | Blocks on this dim all have `var=0`. Check `var_fair_ratio`.    |
| `zero_bankroll`      | `client.set_bankroll(positive_value)`.                          |
| `no_active_blocks`   | No stream covers this dim. Register one, or flip active.        |
| `edge_coincidence`   | `edge=0` but `market_value` is set — pipeline sees fair=market. |
| `unknown`            | Scalars are non-zero; inspect `smoothing`/`position_sizing`.    |

The response also carries the scalars (`raw_edge`, `raw_variance`,
`total_fair`, `total_market_fair`, `aggregate_market_value`) so you can
verify the reason yourself.

---

## Error cheatsheet

Grouped by when you'd hit them.

**Connection / auth (at `async with` entry):**

| Error                                | Cause                              | Fix                                                              |
|--------------------------------------|------------------------------------|------------------------------------------------------------------|
| `PositAuthError`                     | API key invalid or expired.        | Rotate on the Account page; update `api_key=`.                   |
| `PositConnectionError`               | WS handshake timed out.            | Check `url`. Pass `connect_timeout=None` to skip the WS wait.    |

**Setup / validation (at `configure_stream_for_…` / `upsert_stream` / row construction):**

| Error                                              | Cause                                         | Fix                                                                 |
|----------------------------------------------------|-----------------------------------------------|---------------------------------------------------------------------|
| `PositValidationError: key_cols must include …`    | `key_cols` missing a server risk dimension.   | Include `symbol` and `expiry`. Extras are fine alongside.           |
| `PositValidationError: timestamp …`                | Row timestamp unparseable.                    | ISO 8601 preferred (`"2026-03-27T00:00:00"`). `"27MAR26"` accepted. |
| `ValueError: decay_end_size_mult …`                | `BlockConfig` contradiction at construction.  | `annualized=True` OR `decay_end_size_mult=0`.                       |
| `PositApiError 409 Stream '…' already exists`      | Raw `create_stream` on a pre-existing stream. | Use `upsert_stream(…)`.                                             |
| `FutureWarning: create_stream / configure_stream …`| Two-phase legacy path.                        | Migrate to `upsert_stream` / `bootstrap_streams`. Removed in v0.2.  |

**Ingest (at `push_snapshot` / `ingest_snapshot`):**

| Error                                                | Cause                                                                 | Fix                                                                 |
|------------------------------------------------------|-----------------------------------------------------------------------|---------------------------------------------------------------------|
| `PositStreamNotRegistered`                           | Server doesn't know this stream (often after a server restart).       | `upsert_stream(…)` again, then retry.                               |
| `PositApiError 422 …is not READY`                    | Stream exists but not yet configured.                                 | `upsert_stream(…)`.                                                 |
| `PositZeroEdgeBlocked` (HTTP 422 `ZERO_EDGE_BLOCKED`)| First push on a fresh stream would zero every position.               | Set `market_value`, call `set_market_values([…])`, or `allow_zero_edge=True`. |

**Consume (during `positions()` / `get_positions()`):**

| Signal                                               | Meaning                                                               | Action                                                              |
|------------------------------------------------------|-----------------------------------------------------------------------|---------------------------------------------------------------------|
| `PositZeroEdgeWarning`                               | `warnings.warn` on the first payload after a bare-market push.        | See [`market_value` section](#b-missing-market_value--zero-positions). |
| `payload.transport == "poll"`                        | WS dropped; `positions()` is polling at `poll_interval`.              | Surface a stale-data indicator. The SDK recovers if WS reconnects.  |
| `payload.prev_seq != last_seen`                      | Gap detected between payloads — you missed some mid-stream.           | Call `positions_since(last_seen)` to backfill.                      |

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
