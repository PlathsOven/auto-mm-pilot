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

- [ ] **Audit log** — every engine command and LLM investigation turn stored with timestamp and API key. Reviewability is core to the formalisation promise — every view the desk declares should be auditable. Start with append-only JSON lines to a file; migrate to a real store later.
- [ ] **Usage meters** — track investigation count, active stream count, and connected seats per API key. Required for usage-based invoicing even if the first partner is free. Can layer on top of audit log.

## Deployment

- [x] **Railway-ready** — `Procfile`, `runtime.txt` (Python 3.12.4), `requirements.txt` in place. Vercel config for client SPA.
- [ ] **Per-tenant bootstrap script** — one command to spin up an isolated Railway instance with `.env` populated (API keys, OpenRouter key, allowed IPs). Today this is manual copy-paste.
- [ ] **Onboarding artefact: configuration PDF export** — after a Build-mode session, the firm gets a document of what they configured and why — their formalised positional views, stream parameters, and composition rules. Closes the "what did I just set up?" loop. Deferred until after first partner is live — verbal walkthrough suffices for partner #1.

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
- [ ] **One-page info sheet** — one diagram (Edge × Bankroll / Variance), three sections (Problem / Formalisation / What you get). Lead with the team coordination problem. No pricing.

---

## Build Sequence

Prioritised by what unblocks what. Three phases: pre-demo, pre-design-partner, pre-paid-pilot. Updated 2026-04-17.

### Phase 1 — Pre-demo (must complete before any live outreach)

Without real data running through the platform, every demo is on mock scenario numbers. This phase ends with a stable URL showing real BTC/ETH positions updating in real time.

| # | Item | Depends on | Est. effort | Notes |
|---|------|------------|-------------|-------|
| 1 | **posit-sdk** | Snapshot ingestion (done) | 2–3 weeks | The pipe every customer uses. Python first, TS wrapper later. Auto-reconnect, typed frames, stream/block CRUD. |
| 2 | **Deribit pricer — realized vol + historical IV + aggregate market vol streams** | posit-sdk | 2–3 weeks | Separate project. First real user of the SDK. Pushes real Deribit data into Posit. Can overlap with SDK tail-end. |
| 3 | **`POSIT_MODE=prod` e2e validation** | Deribit pricer running | 1 week | Validate the full path: SDK → WS ingest → stream registry → pipeline → broadcast → UI. Real numbers, real positions. |
| 4 | **Deribit pricer — event stream + stream configs** | e2e validation passing | 1 week | FOMC/CPI/ETH events as static blocks. Configure target-space mappings, decay, confidence weights. |
| 5 | **Live demo on deployed infra** | All above | 0.5 weeks | Pricer + Posit server on Railway, client on Vercel. Stable URL for screen-shares. |

**Phase 1 total: ~7–8 weeks.** This is the critical path. Nothing in sales collateral or outreach is credible until this runs.

### Phase 2 — Pre-design-partner (must complete before a firm puts real book data through)

| # | Item | Depends on | Est. effort | Notes |
|---|------|------------|-------------|-------|
| 6 | **Stream context DB → API-contributed** | Phase 1 | 1 week | Unblocks Build-mode onboarding flow. Replaces hardcoded mock metadata. |
| 7 | **REST endpoint auth** | — (can start in parallel with Phase 1) | 1 week | API-key middleware on all `/api/*` routes. Security gate before any external data enters. |
| 8 | **Tick liveness on `/api/health`** | — | 0.5 weeks | `last_tick_ts`, `tick_age_ms`, `pipeline_rows`. Operator persona needs this. |
| 9 | **LLM fallback smoke test** | — | 0.5 days | Manual verification. Low effort, high value. |
| 10 | **Daily Wrap rebuild** | Phase 1 (needs real data to generate meaningful wraps) | 1–2 weeks | LLM-generated overnight summary. Retention feature — the customer who opens Posit in the morning needs a 60-second catch-up. |

**Phase 2 total: ~3–4 weeks** (some items overlap with Phase 1 tail-end).

### Phase 3 — Pre-paid-pilot (must complete before invoicing)

| # | Item | Depends on | Est. effort | Notes |
|---|------|------------|-------------|-------|
| 11 | **Audit log** | Phase 2 | 1 week | Append-only JSON lines. Every engine command + LLM investigation turn with timestamp and API key. |
| 12 | **Usage meters** | Audit log | 1 week | Investigation count, active streams, connected seats. Layers on audit log. |
| 13 | **Billing / MSA / DPA** | — (legal work, parallel with engineering) | 2–4 weeks | Stripe + signable MSA + data-processing addendum. Non-negotiable — no desk's legal team signs without a DPA. |
| 14 | **Per-tenant bootstrap script** | Phase 2 infra stable | 1 week | One command to spin up isolated Railway instance. Manual copy-paste is tolerable for partner #1 but not #2. |

**Phase 3 total: ~4–5 weeks** (billing/legal runs in parallel).

### Summary timeline

| Phase | Scope | Calendar estimate |
|-------|-------|-------------------|
| Phase 1 — Pre-demo | SDK + pricer + prod e2e + live demo | ~8 weeks (target: mid-June 2026) |
| Phase 2 — Pre-design-partner | Auth + context DB + Daily Wrap | ~3 weeks after Phase 1 (target: early July) |
| Phase 3 — Pre-paid-pilot | Audit + billing + bootstrap | ~4 weeks, overlapping Phase 2 (target: late July) |

**Sales collateral (Loom + info sheet) ships as soon as Phase 1 is live.** The Loom is recorded against the real Deribit demo. The info sheet is written now, refined after recording.

**Outreach can begin before Phase 1 completes** — the Rob Keldoulis letter and notebook don't require a live demo (they include a Loom link placeholder). Tier-A personalised demo videos require Phase 1.
