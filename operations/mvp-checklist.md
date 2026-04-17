# MVP Checklist

What must ship before the first design partner goes live. Ordered by dependency within each section. Updated 2026-04-16.

## Platform — Ingestion & Data Flow

- [x] **Snapshot ingestion over `/ws/client` and REST** — auth-gated WS endpoint accepts `"snapshot"` frames (ACK each); REST `/api/snapshots` POST also works. Market value frames (`"market_value"` type) accepted on the same channel. Dirty-flag coalesced rerun avoids ticker thrash.
- [x] **`MarketValueStore` + aggregate vol** — singleton store with REST CRUD (`GET/PUT/DELETE /api/market-values`) and WS inbound frames. Dirty-flag triggers coalesced pipeline rerun on next tick. Manual UI input removed; trader's systems push data in.
- [x] **`POSIT_MODE=prod` ticker** — `_run_ticker_prod()` broadcasts positions matching real wall-clock time, checks market-value dirty flag. Framework is complete.
- [ ] **Posit Python SDK (`posit-sdk`)** — published package (or installable from git) that wraps `/ws/client` and REST APIs. Auto-reconnect, typed frame builders (snapshot, market_value), stream/block CRUD helpers, bankroll setter. This is what every client imports — no hand-rolled WebSocket JSON. Critical path: the Deribit pricer and every future integration depend on it.
- [ ] **`POSIT_MODE=prod` end-to-end validation** — exercise the full path with a real client (the Deribit pricer) pushing data via the SDK: WS ingest → stream registry → pipeline → broadcast → UI. Validate positions, decomposition, and LLM investigation produce sensible output on real numbers.
- [ ] **Stream Context DB → API-contributed** — `context_db.py` is hardcoded with 5 mock streams. Replace with an API endpoint so each firm's stream metadata is contributed during onboarding (Build mode) and persists across restarts.

## Platform — Auth & Reliability

- [x] **`/ws/client` auth gate** — API key + IP whitelist validated before WS accept (`client_ws_auth.py`).
- [ ] **REST endpoint auth** — all `/api/*` routes are currently unauthenticated. Add API-key middleware matching the WS gate. Multi-tenancy is deferred (single-tenant instances first), but every endpoint must require a key.
- [ ] **Tick liveness on `/api/health`** — current health check returns `{"status": "ok"}` with no pipeline state. Add `last_tick_ts`, `tick_age_ms`, `pipeline_rows` so the trader's monitoring can detect stale data.
- [x] **LLM fallback chain** — implemented in `llm/client.py` with `complete_with_fallback()` / `stream_with_fallback()`. Investigation models: Claude Sonnet 4 → GPT-4.1 → Gemini 2.5 Pro. Env-var overridable.
- [ ] **LLM fallback smoke test** — manually verify the chain fires when the primary model 429s or times out. No automated test exists yet.

## Commercial

- [ ] **Audit log** — every engine command and LLM investigation turn stored with timestamp and API key. Reviewability is core to the "rulebook" promise. Start with append-only JSON lines to a file; migrate to a real store later.
- [ ] **Usage meters** — track investigation count, active stream count, and connected seats per API key. Required for usage-based invoicing even if the first partner is free. Can layer on top of audit log.

## Deployment

- [x] **Railway-ready** — `Procfile`, `runtime.txt` (Python 3.12.4), `requirements.txt` in place. Vercel config for client SPA.
- [ ] **Per-tenant bootstrap script** — one command to spin up an isolated Railway instance with `.env` populated (API keys, OpenRouter key, allowed IPs). Today this is manual copy-paste.
- [ ] **Onboarding artefact: rulebook PDF export** — after a Build-mode session, the firm gets a document of what they configured and why. Closes the "what did I just set up?" loop. Deferred until after first partner is live — verbal walkthrough suffices for partner #1.

## Dogfood: Deribit Positional Pricer (separate project)

The first real user of Posit is us. A separate project (`deribit-pricer` or similar) that runs a positional pricer for Deribit crypto options, feeding Posit via the SDK. This is the demo, the stress test, and the proof that the product works.

- [ ] **Realized vol stream** — compute rolling realized vol from Deribit BTC/ETH index prices, push as snapshot frames via SDK.
- [ ] **Historical IV stream** — pull IV term structure from Deribit public API, push as snapshot frames. Provides the "market is pricing X vol" input.
- [ ] **Event stream** — manually configured events (FOMC, CPI, ETH upgrades) with timestamps and expected vol impact. Push as static blocks.
- [ ] **Aggregate market vol** — pull Deribit ATM IV per symbol/expiry, push as `market_value` frames via SDK. This is what the pipeline compares fair value against.
- [ ] **Stream configs + block parameters** — configure each stream's target-space mapping, aggregation logic, decay, and confidence weights via Posit Build mode or SDK CRUD calls.
- [ ] **Live demo** — pricer + Posit server running continuously on deployed infra. Positions updating in real time on real Deribit data. Accessible via stable URL for screen-shares.

## Sales Collateral

- [ ] **Loom recording** — 3–4 min, face in corner, no music. Record against the live Deribit demo: connect → see positions updating in real time → investigate a change → onboard a stream in Build mode.
- [ ] **One-page info sheet** — one diagram (Edge × Bankroll / Variance), three sections (Problem / Rulebook / What you get). No pricing.
