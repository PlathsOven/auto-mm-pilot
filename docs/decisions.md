# Decisions

Append-only log. When making a significant architectural or process choice, add a new entry. Never rewrite an old entry — add a new one that supersedes it and reference the predecessor.

Format per entry: **Date — Decision**. Then `Context:`, `Decision:`, `Rationale:`, `Consequences:`.

---

## 2026-04-24 — Stage H: exposure → position via separable direct inversion

**Context:** Up through Stage G the pipeline emitted per-(symbol, expiry) scalars the UI called *desired positions*. Conceptually they were **net desired exposures** — what the trader wants their exposure to be to each risk dimension before accounting for correlations between symbols and between expiries. A trader with strong views on BTC and ETH was being told to hold +100 of each even when the two moved 60% together; the implied correlation was double-counting the position. We needed a way to back out the *actual* position the trader should put on from the exposure vector plus a trader-managed correlation matrix.

**Decision:** Add **Stage H** (`exposure_to_position`) to the pipeline, sitting between `position_sizing` and the `desired_pos_df` output. Solves `P = Cₛ⁻¹·E·Cₑ⁻¹` per timestamp via `numpy.linalg.solve`, using two independent trader-maintained upper-triangle correlation matrices (one across symbols, one across expiries). Matrices default to identity (empty stores on every fresh account) — day-one behaviour for existing users is cell-for-cell unchanged. Matrices are edited in a new Anatomy DAG node (`CorrelationsNode`) via a NodeDetailPanel editor (`CorrelationsEditor`) with two-slot committed/draft semantics mirroring `MarketValueStore`: every edit debounces into a PUT against `/api/correlations/{symbols,expiries}/draft`, the dirty flag triggers a coalesced rerun on the next WS tick, and the broadcast carries both the committed positions and the draft `*_hypothetical` positions so the editor can show live preview. Confirm promotes draft → committed atomically; Discard wipes the draft. Singular matrices (`|det| < 1e-9`) raise a typed `SingularCorrelationError` — no Tikhonov fallback; the UI surfaces a `CorrelationSingularAlert` in the Notifications Center and positions freeze at the last good state. `PositionHistoryPoint` captures the full committed matrices on every push so the Position chart plays back historical positions under the matrices that were active at each snapshot, not today's matrices.

**Rationale:** (1) **Separable Kronecker structure reads clearly.** `P = Cₛ⁻¹·E·Cₑ⁻¹` is the canonical back-out-positions-from-exposure calculation used on hedging desks; every term has an obvious interpretation (inverse-correlate across symbols first, then across expiries). A full k·m × k·m joint matrix would be more expressive but invent a combinatorial parameter surface the trader can't maintain by hand at k, m ≤ 30. (2) **Loud-fail beats silent-regularise.** A singular matrix is a signal the trader has declared two things perfectly correlated (or redundant) — the right response is to make that visible and ask for a fix, not silently produce a regularised position that's neither what the trader asked for nor what the math prescribes. The spec explicitly rules out Tikhonov; this matches the "fix root causes, not symptoms" directive in CLAUDE.md. (3) **First-class DAG integration.** Putting correlations in the Anatomy canvas (not a hidden settings page) tells the trader these are pipeline infrastructure, not configuration trivia. The edge labels (`exposure(t)` → `position(t)`) make the semantic distinction between Stage G output and Stage H output visible in the same graph the trader already uses to reason about the pipeline. (4) **Live preview without code duplication.** Stage H runs twice per rerun when a draft is live — once with committed matrices, once with draft — writing to `*_hypothetical` columns that Pydantic carries on the wire as `null` when no draft exists. The editor's live Σ|Δ| summary reads off those fields, so the preview and commit paths share 100% of their math. (5) **Performance is a non-issue at current scale.** At k = m = 20, the numpy solve is ~50 µs — negligible against the ~10 ms Polars pipeline.

**Consequences:** New public API: `GET /api/correlations/symbols`, `PUT /api/correlations/symbols/draft`, `POST /api/correlations/symbols/confirm`, `POST /api/correlations/symbols/discard` (+ four `/api/correlations/expiries/*` twins). New wire fields on `DesiredPosition`: `rawDesiredExposure`, `smoothedDesiredExposure` (always emitted), `rawDesiredPositionHypothetical`, `smoothedDesiredPositionHypothetical` (nullable). New wire field on `ServerPayload`: `correlationAlerts: CorrelationSingularAlert[]`. New Pydantic models: `CorrelationEntry`, `SymbolCorrelationEntry`, `ExpiryCorrelationEntry`, `SymbolCorrelationListResponse`, `ExpiryCorrelationListResponse`, `SetSymbolCorrelationsRequest`, `SetExpiryCorrelationsRequest`, `CorrelationSingularAlert`. New server modules: `correlation_store.py`, `correlation_matrix.py`, `correlation_alert_store.py`, `routers/correlations.py`, `core/transforms/exposure_to_position.py`. New client modules: `services/correlationsApi.ts`, `hooks/useCorrelationsDraft.ts`, `components/studio/correlations/{CorrelationsEditor,MatrixGrid,ConfirmMatrixModal}.tsx`, `components/studio/anatomy/nodes/CorrelationsNode.tsx`, `components/notifications/CorrelationSingularCard.tsx`. New view modes: `exposure`, `rawExposure` (position grid dropdown + CellInspector). `numpy>=1.26` added as a direct server dep (was transitive via Polars). `PositionHistoryPoint` shape grew by `8·(k² + m²)` bytes per push — at k = m = 20 that's ~6.4 KB per point × 4096 cap = ~26 MB per user; revisit if k > 50. **Out of scope** (logged as follow-ups): full k·m × k·m cross-dim correlation matrix (Kronecker-only today), CSV import, correlation history table beyond the per-`PositionHistoryPoint` snapshot, LLM-assisted correlation authoring, dedup of history matrix snapshots. **Pre-migration:** `PositionDelta` / `.deltas` / `.absolute_change` renamed to `PositionDiff` / `.diffs` / `.absolute_diff` across server + client + specs (one surgical commit) so "delta" in the codebase consistently means the options Greek, never subtraction.

---

## 2026-04-23 — Connectors: server-side pre-built input transforms

**Context:** Three forces converged. (1) The trader's first realised-vol stream wanted server-side math (multi-horizon EWMA over spot ticks), but writing the algorithm client-side would either expose the math or require a slow JS port. (2) The Stream Canvas's `STREAM_TEMPLATES` list was a thin convenience pack of pre-filled drafts — useful for users who already understood every section, useless to anyone who didn't. With a real "I want realized vol" path imminent, the templates would compete with the connector picker for the same UX slot. (3) The product theory in `docs/product.md` is anchored on the 4-space epistemology (risk / raw / calc / target); the connector concept is *accessory* to a stream's `raw_value` source, not a fifth space. Reframing the framework to introduce connectors as a first-class concept would have broken everything that already references the four spaces.

**Decision:** Ship a server-side **Connector** abstraction (`server/core/connectors/`) — a Protocol with `initial_state(params)` + `process(state, rows, params)` + `state_summary(state)`, populated at import time into a process-global registry, exposed to the client via `GET /api/connectors` (metadata only). The first connector is `realized_vol`. Streams gain a `connector_name` + `connector_params` flag — when set, snapshot pushes are rejected (`STREAM_IS_CONNECTOR_FED` 409) and the stream's `raw_value` is owned by the connector via `POST /api/streams/{name}/connector-input` (or the matching `connector_input` WS frame). State is per-user, opaque, evicted on stream delete. The Stream Canvas gains a Connector dropdown in the Identity section; picking a connector cascades the connector's recommended defaults into sections 3-6 and locks them, swaps the Data Shape sample-CSV panel for a read-only schema, and replaces the Preview's draft summary with an SDK integration snippet. The legacy `STREAM_TEMPLATES` UI is removed in the same change. The 4-space model in `docs/product.md` stays unchanged — connectors are framed as accessory to streams, not a new fundamental concept.

**Rationale:** (1) **IP barrier preserved.** Connector implementations live in `server/core/connectors/` and are never serialised; only catalog metadata (display name, input schema, recommended block) crosses the wire. The vendor product keeps the math, the customer gets the terminal, and the same posture as the pricing pipeline applies to every future connector. (2) **Pipeline unchanged.** Per-symbol connector emissions are fanned across `(symbol, expiry)` pairs in the current dim universe by the State Store before they hit `snapshot_rows`, so the pipeline sees per-pair rows like every other stream — no `build_blocks_df` change. The cost is the bootstrapping limitation: connector-fed streams need at least one user-fed stream to seed the universe (documented in `tasks/spec-connectors.md`). (3) **One creation path.** Stream Canvas now offers a single cohesive flow — pick a connector OR fill sections by hand — rather than three (template, manual, connector). Removing `STREAM_TEMPLATES` deletes ~160 LOC plus the `?template=` URL plumbing in `ModeProvider`. (4) **Adding connectors stays a single-file change.** The base Protocol + `_REGISTERED` tuple in `registry.py` keep the cost of the second connector at one new module + one tuple entry. The five-stage UX flow (catalog endpoint, picker, lock, snippet, ingest gate) is generic across connectors; only the math is new.

**Consequences:** New public API: `GET /api/connectors`, `POST /api/streams/{name}/connector-input`, `connector_input` WS frame, `connector_name` + `connector_params` on `AdminConfigureStreamRequest` / `StreamResponse` / `StreamStateResponse` + new `connector_state_summary` field. New SDK methods: `list_connectors()`, `push_connector_input(stream, rows)`, `upsert_connector_stream(name, connector_name, key_cols, params)`. New UI surface: Connector picker in Stream Canvas Identity section + `ConnectorNode` rendered upstream of every connector-fed stream in Anatomy. **Limitations** (logged for follow-up specs): connector state is in-memory only, lost on server restart (re-warms from next tick); v1 locks connector params at configure time (delete + recreate to change); LLM Build mode does not learn about connectors yet (pick-from-catalog only). Out-of-scope: per-section override unlock in the canvas (v1 has no escape hatch — trader builds a user-fed stream if they need a different parameter), connector versioning / param-schema migration. Files added: `server/core/connectors/{__init__,base,registry,realized_vol}.py`, `server/api/{connector_state.py, routers/connectors.py}`, `sdk/posit_sdk/` (model + client + rest + ws extensions), `client/ui/src/{services/connectorApi.ts, hooks/useConnectorCatalog.ts, components/studio/anatomy/nodes/ConnectorNode.tsx}`. File removed: `client/ui/src/components/studio/streamTemplates.ts`. Test coverage: 15 connector-math units + 8 endpoint integration tests + 6 SDK respx tests.

---

## 2026-04-22 — SDK integrator-audit Tier 1 (no-new-endpoint cleanup)

**Context:** The deribit-pricer integrator audit (`.context/attachments/pasted_text_2026-04-22_10-14-33.txt`) surfaced 23 pain points against the `posit-sdk`. Four were already addressed (§2.2 WS-1008 terminal, §3.1 `bootstrap_streams`, §5.1 error clarity, §10 quickstart). The remainder split into three tiers by scope — this entry covers Tier 1: changes local to the SDK and the quickstart, no server API additions, no new endpoints. Tiers 2 (server-side zero-edge guard, fan-out helper, `diagnose_zero_positions`) and 3 (transport freshness, replay, seq unification, key-col migration, typed rows, structured events) are separate decisions landing in follow-up PRs.

**Decision:** Single SDK PR that (a) flips `connect_ws` default to `False` (REST-first is the integrator norm — live WS is opt-in), (b) emits `FutureWarning` on the deprecated two-phase `create_stream` / `configure_stream` and points callers at `upsert_stream` / `bootstrap_streams` (removal slated for v0.2), (c) adds named idempotent factories `configure_stream_for_variance` (exponent=2) and `configure_stream_for_linear` (exponent=1) so the common transforms stop forcing callers to remember the formula, (d) makes `BlockConfig.decay_end_size_mult` a sentinel (`None` → `1.0` for annualized / `0.0` for discrete) so `BlockConfig(annualized=False)` no longer fights its own default, (e) adds per-field `Field(description=...)` to every `BlockConfig` field with tuning guidance, (f) adds a typed `PositZeroEdgeWarning` (UserWarning subclass) surfaced via `warnings.warn` on the first `positions()` / `get_positions()` payload after a push missing `market_value` — escalates the existing logs-only WARN into a notebook-visible signal, (g) fixes stale `:8000` defaults in docstrings to `:8001`, (h) documents the dual API-key surface (header for REST, query for WS), canonical ISO 8601 timestamp, canonical market-value paths, and last-writer-wins `set_bankroll` semantics in the quickstart + docstrings.

**Rationale:** (1) The audit's highest-leverage Tier-1 wins are all about the *default path* — integrators read docstrings and pass no kwargs, so fixing defaults fixes real adoption. `connect_ws=False` removes a whole class of "why does my REST-only script open a WS?" confusion; sentinel `decay_end_size_mult` removes a 422 that only exists because the default contradicts itself. (2) The `PositZeroEdgeWarning` escalation is the compromise between the audit's "server-side refuse" request (Tier 2, more invasive) and "logs only" status quo — a notebook-visible typed warning is a middle ground that doesn't break existing integrators. (3) Named factories embed the recommended idempotent path in their implementation so the common case never touches the deprecated two-phase API. (4) Per-field docstrings close the "`BlockConfig` fields are opaque" gap — the trader tunes these after observing real positions, and "tune this if you observe X" hints in the field description are what was missing. (5) `FutureWarning` (not `DeprecationWarning`) was chosen because `DeprecationWarning` is silenced by default outside tests — integrators in notebooks would never see it. Removal target is v0.2, not v0.1.1, so the deprecation window is generous.

**Consequences:** Breaking defaults: `connect_ws=True` → `False`. Acceptable — the only live integrator (deribit-pricer) already passes `connect_ws=False` explicitly. `BlockConfig` callers passing nothing see the same effective behavior (`decay_end_size_mult=1.0` on annualized defaults). New public symbols: `PositZeroEdgeWarning`, `configure_stream_for_variance`, `configure_stream_for_linear`. `create_stream` / `configure_stream` still work, now with `FutureWarning`. Tests updated in `sdk/tests/test_validation.py`, `sdk/tests/test_upsert.py`, `sdk/tests/test_market_value_warn.py`. Quickstart gains a deprecation note, a named-factories section, dual-auth sentence, canonical-timestamp preference, canonical-market-value paragraph, and two new error-cheatsheet rows. Tier 2 follows — server-side `allow_zero_edge` gate, `push_fanned_snapshot` helper, `diagnose_zero_positions()` endpoint + wrapper.

---

## 2026-04-21 — Motion language + branded splash

**Context:** Every overlay, page transition, and auth-boundary swap in the UI was an instant state-replace. Opening the BlockDrawer, toggling the NotificationsCenter, switching from Workbench to Anatomy, or logging in all pop without any enter/exit animation. On cold boot the user saw a blank frame until React hydrated. The product persona in `UI_SPEC.md` is "intellectual research interface, clarity and flow" — the instant pops worked against that, and there was no brand moment anywhere in the app (Posit existed only as text).

**Decision:** Introduce a cohesive motion layer anchored on three pieces:

1. **Framer-motion as the animation engine.** Chosen over hand-rolled CSS transitions because six overlays + page-level transitions share enter/exit semantics, and framer's `AnimatePresence` + `prefers-reduced-motion` handling are cheaper than reimplementing the same logic per site. ~55KB gz bundle cost; the existing `todo.md` code-split follow-up covers the bundle-size conversation.
2. **A full-screen branded splash** (`<PositSplash/>` + `<PositLogo/>`) at two anchors: (a) a pre-hydration static HTML block in `index.html` (removed after React paints; zero white flash on cold load), (b) a React-owned overlay between login-success and first-WS-tick received. Minimum display 400ms via `useAppReady` so the splash always "lands" instead of flashing. The Posit mark is a minimalist "posited point" glyph — solid indigo circle plus an offset outline circle, reading as a coordinate in a reference frame.
3. **Uniform enter/exit presets** — modal (fade + scale 0.98→1), drawer (slide from edge), popover (fade + scale-small), backdrop (fade). Applied to `<BlockDrawer/>`, `<CommandPalette/>`, `<HotkeyCheatsheet/>`, `<NotificationsCenter/>`, `<ChatDock/>`, `<OnboardingFlow/>`. Plus cross-fade on mode switches in `App.tsx` keyed on `mode`, and a login↔app boundary fade.

**Rationale:** The trader's Flow-1 invariants (data freshness, <200ms tick render) are untouched — animations only decorate chrome. The existing `fade-highlight` on cell rows and `anatomy-flow-pulse` on pipeline edges are load-bearing data-trust signals and are deliberately left alone. `prefers-reduced-motion` users get instant transitions via a CSS override plus framer's built-in reducer, so the polish never becomes an accessibility cost. A branded splash closes a real product gap (no brand moment anywhere) and gives the connection-establishing window something meaningful to show instead of a blank page.

**Consequences:** Any new overlay should mount under `<AnimatePresence>` and pick one of the four presets. Any new long-running "gate" (e.g. a future "reconnecting" surface) should reuse `<PositSplash/>` with a different `message`. The splash hand-off from static HTML to React depends on the `#boot-splash` element being present in `index.html` — don't remove it or the cold-load flash returns. The 608KB→663KB gzipped bundle bump should be watched alongside the existing code-split follow-up in `todo.md`.

---

## 2026-04-21 — Pipeline 4-space model (risk / raw / calc / target)

**Context:** The 2026-04-20 "Space-level market value + sum-only aggregation" entry (below) made aggregation a pure sum across blocks within a `(symbol, expiry)`. That closes the block-level Sharpe question but still conflates two different aggregation semantics: multiple estimators of the *same* risk (base-vol rolling average + median realized-vol — should average, not sum) and multiple *independent* risks on the same dim (base-vol + FOMC event-vol — should sum, not average). The old model also hardcoded the raw→target map (`(scale * raw + offset)^exponent`, then sqrt + annualise in an ad-hoc VP block inside `pipeline.py`), so users couldn't reason about — or override — the two maps independently.

**Decision:** Rewrite the pipeline around an explicit four-space model and split the map into two pluggable transform steps:

- **risk** — constituent risk dimension (e.g. `base_vol` vs `event_vol`); independent across spaces.
- **raw** — whatever units a block is authored in (%, SD, variance, annualised vol).
- **calc** — linear in what we price; for options today that's variance units.
- **target** — the axis linear in PnL; for options today that's annualised vol points.

Two transform steps bridge them: `unit_conversion` (raw → calc, default `affine_power`) and `calc_to_target` (calc → target, default `annualised_sqrt`). A new `risk_space_aggregation` step (default `arithmetic_mean`) averages blocks within a space; the existing `aggregation.sum_spaces` step sums across spaces. The block-authoring surface gains `applies_to: list[tuple[str, str]] | None` so a single event block fans out to every matched dim.

**Rationale:** (1) **The math matches the epistemology.** Multiple estimators of the same risk SHOULD average (Sharpe improves as `1/√n`); multiple independent risks SHOULD sum (Sharpe improves as `√n`). The old "sum everywhere" model over-counted the former case and was silently wrong for traders using multiple RV streams on the same dim. (2) **Pluggable calc→target.** A non-options product (rates, credit, equity-vol-of-vol) needs a different target axis — having it in the registry means a new asset class is a transform registration, not a pipeline rewrite. Default keeps numbers bit-identical to today for the options path. (3) **`applies_to` closes the FOMC-fanout ergonomic gap.** Today a single event block needed N `StreamConfig`s (one per dim); with `applies_to=[(BTC, Q1), (BTC, Q2), …]` or `None` (all dims), one block covers the full universe.

**Consequences:** Schema change on every intermediate frame (`blocks_df`, `block_series_df`, `space_series_df`, `dim_calc_df`, `dim_target_df`, `desired_pos_df`). `block_fair_df` + `block_var_df` + `space_agg_df` are gone; the new flat `block_series_df` carries fair / var / market in one pass, `space_series_df` carries the space-mean, `dim_target_df` carries target-space totals + edge. `target_value` is removed from block rows end-to-end (Pydantic + TS + UI). The existing hardcoded VP block at the old `pipeline.py:264-307` is deleted — its math now lives inside `calc_to_target.annualised_sqrt`. Mock-scenario numerics are unchanged on the options path (default transforms reproduce the old behaviour exactly); any prod deploy that overrode `scale` / `offset` / `exponent` for non-options assets now needs to pick an explicit `calc_to_target` too. New per-stream `applies_to` validates at ingest (HTTP 400 when naming a dim not in the universe) rather than silently dropping.

---

## 2026-04-21 — Lift the Manual Brain Rule

**Context:** The Manual Brain Rule restricted LLMs from editing any file under `server/core/`. It was introduced in 2025 when the pricing math was unsettled and the LLM track record on dense numerical code was unknown. A year of handoffs (see `tasks/progress.md` — Int32/Float64 vstack cast, VAR_FLOOR spike) demonstrated that the bugs hitting the Brain were trivial one-liners the LLM could have landed directly; the rule was producing queue time, not safety. The 4-space pipeline rewrite (see `tasks/spec-pipeline-4-space.md`) touches `server/core/` comprehensively and cannot proceed under the old rule without a parallel human rewrite.

**Decision:** Remove the Manual Brain Rule end-to-end. `server/core/` is now a normal LLM-owned lane. Delete the `PreToolUse` hook in `.claude/settings.json`. Strip the Manual Brain sections from `CLAUDE.md`, `docs/architecture.md`, `docs/using-agents.md`, `tasks/lessons.md`, and every `.claude/commands/*.md` / `.windsurf/workflows/*.md` pair. Keep this decision entry and the replacement lesson in `tasks/lessons.md` as the historical record. Supersedes the 2025 "Manual Brain restriction" entry.

**Rationale:** Solo-trader workflow. Faster iteration wins over the marginal safety of a human-only lane when the track record shows the bar is reachable by current agents. The rule made sense as insurance in 2025; by 2026 it's taxation. The 4-space rewrite is the forcing function — doing it under the old rule would have meant a parallel human track with no net safety benefit.

**Consequences:** LLMs can now `Edit`/`Write` under `server/core/`. The normal safety rails still apply: plan before code (via `/kickoff`), surgical commits, typecheck + compileall on Stop, human review on every diff. Reviewers should remain alert to numerical correctness in the pricing math — that lane is mathematically sensitive regardless of who authors it. The 2025 restriction entry remains in the log as context for why the rule existed.

---

## 2026-04-20 — Space-level market value + sum-only aggregation

**Context:** Aggregation previously split blocks into `average` and `offset` modes within each space, then combined `average` (mean) with `offset` (sum) to produce `space_fair`. This under-counted the Sharpe benefit of adding independent alphas in the same space: two uncorrelated signals with identical `(edge, var)` on the same space yielded `e/√(2v)` under the old math instead of the correct combined `√2 · e/√v`. Market-implied value was per-block, which forced every block to carry its own `market_value` snapshot column even when the desk's view of market was at the symbol/expiry level.

**Decision:** Collapse aggregation to a single sum across all blocks. Move market value up to the space level (one value per `(symbol, expiry, space_id)`). The `market_value_inference` step now returns a per-space `market_fair(t)` time-series shaped proportional to each space's own `fair(t)` — so the default (no user input) gives `space.market_fair == space.fair` and edge is zero at every timestamp. Aggregate user input (`total_vol` per `(symbol, expiry)`) distributes to inferable spaces preserving the variance invariant `Σ_t Σ_spaces market_fair = total_vol²`. Dropped `BlockConfig.aggregation_logic` and `BlockConfig.size_type` entirely.

**Rationale:** Two uncorrelated signals on the same space should combine as sum/sum — that's the Sharpe algebra. Space_id now carries only its shared market reference; block-level contribution is always additive to edge and variance. Dropping `size_type == "relative"` is safe because the relativity it expressed ("view minus market") is now handled at the aggregation step via `total_fair − total_market_fair`.

**Consequences:** Clean wire-schema break — snapshot payloads no longer carry `market_value`; block rows no longer expose `market_fair` / `target_market_value` / `aggregation_logic` / `size_type`. Pipeline step library gets a new step-level contract for `market_value_inference` (takes the block-variance frame plus aggregate + per-space dicts; returns a space-level frame). Default edge-zero invariant is now structural: any desk that provides no aggregate or per-space market sees zero position, which surfaces the "no market view set" case loudly instead of silently producing edge from a zero-market fallback.

---

## 2025 — Physical client/server split for IP protection

**Context:** Posit is a vendor product. The client (trading desk) gets the terminal + adapters; we retain the proprietary pricing math.

**Decision:** All proprietary computation (target-space conversion, fair value synthesis, variance estimation, desired position) lives on a remote Python server in `server/core/`. The local Electron client only handles data ingestion, format standardization, and display.

**Rationale:** If the math ran client-side, the client could decompile the Electron bundle and extract it. A physical process boundary is the only durable protection.

**Consequences:** Adds WebSocket transport complexity. Adds latency (every tick round-trips the network). Requires CORS + auth setup for the client WS endpoint. Worth it.

---

## 2025 — Polars over Pandas

**Context:** The pricing pipeline processes time series and per-block computations with heavy per-row operations.

**Decision:** Polars for all DataFrame work. Pandas is banned from the codebase.

**Rationale:** Polars' columnar expressions are materially faster (Rust backend, lazy evaluation, SIMD), and its API forces you to think in columnar ops instead of scalar loops. Pandas' `iterrows` pattern has historically been a source of O(n²) bugs in fintech Python.

**Consequences:** Slightly steeper learning curve for contributors coming from Pandas. Every pipeline change must be expressible as a Polars expression — no fallback to imperative loops.

---

## 2025 — OpenRouter with model fallback chain over single-provider LLM

**Context:** The LLM explanation layer needs to be resilient to provider outages, rate limits, and model quality regressions.

**Decision:** All LLM calls go through OpenRouter, which proxies to any provider. `server/api/config.py` declares a fallback chain (e.g. `OPENROUTER_INVESTIGATION_MODELS=anthropic/claude-sonnet-4,openai/gpt-4.1`) that the client tries in order.

**Rationale:** Provider lock-in is a tail risk for a product whose credibility depends on the LLM never going dark during market hours. OpenRouter's unified interface lets us swap providers without code changes.

**Consequences:** Small latency overhead on the first request. Dependency on OpenRouter's availability — if OpenRouter is down, all LLM features are down.

---

## 2025 — Singleton WebSocket ticker with broadcast

**Context:** Multiple clients may connect simultaneously; each needs to see the same pipeline state in real time.

**Decision:** A single background ticker in `server/api/ws.py` runs the pipeline on a schedule and broadcasts each tick to all connected WS clients. No per-client pipeline state.

**Rationale:** Consistency — every trader sees the same numbers at the same time. Cost — one pipeline run per tick instead of N. Simplicity — broadcast is a single loop.

**Consequences:** Ticker must be restartable (`restart_ticker()` after hot reload). State lives in module-level globals, which is a deliberate concession to singleton semantics.

---

## 2025 — Auth-gated `/ws/client` endpoint

**Context:** The client-facing WS endpoint accepts inbound snapshot frames from the trading desk. Without auth, anyone could inject data.

**Decision:** `server/api/client_ws_auth.py` validates an API key header and checks the source IP against an allowlist before accepting the WebSocket upgrade.

**Rationale:** WS endpoints are often forgotten in auth audits because they don't look like HTTP routes. Making auth the first thing a connection hits closes that gap.

**Consequences:** Operators must set `CLIENT_WS_API_KEY` and `CLIENT_WS_ALLOWED_IPS` env vars before the client can connect. Local dev uses a dev key.

---

## 2025 — Vercel (client) + Railway (server) deploy split

**Context:** The physical client/server split maps naturally onto two deploy targets.

**Decision:** Client SPA deploys to Vercel (static hosting, free tier sufficient). Server deploys to Railway (persistent Python process, $5/mo Hobby tier).

**Rationale:** Vercel is optimized for static SPAs; Railway is optimized for persistent processes with WebSocket support. Using each for its strength is cheaper and simpler than running one platform for both.

**Consequences:** Two dashboards, two env-var stores, two domains. CORS configuration is required (currently `allow_origins=["*"]` — see `README.md` troubleshooting).

---

## 2025 — Manual Brain restriction: `server/core/` is HUMAN ONLY

**Context:** LLM agents are very capable at infrastructure work (FastAPI handlers, React components, WebSocket plumbing) but make subtle, hard-to-catch mistakes in dense mathematical code. A subtle sign error in variance computation would produce numbers that look plausible and silently destroy PnL.

**Decision:** No LLM is permitted to write, modify, or refactor any file under `server/core/`. All code there is hand-written by a human. When an LLM generates Python that must touch steps 4–6 of the pipeline, it writes an empty function body with the comment `# HUMAN WRITES LOGIC HERE`.

**Rationale:** The math is the product. The math is also the IP. A single bad edit in `server/core/pipeline.py` could produce numbers that are off by enough to matter but not off by enough to notice in testing. The blast radius of a mistake here is unbounded.

**Consequences:** Agents must read `server/core/` but not write to it — this creates a clean division of labor. Enforced by a PreToolUse hook in `.claude/settings.json`. Any agent attempting to write under `server/core/` is blocked with a loud error.

---

## 2026-04-09 — Migrate harness to the Agentic Coding Playbook (Claude Code primary, Windsurf secondary in exact sync)

**Context:** The existing harness was Windsurf-centric (`.windsurfrules`, `.windsurf/workflows/`, `.cascade/commands/commit-push-pr.sh`). Claude Code is now the primary tool but Windsurf is still in active use. Without a unified rules layer, the two would drift immediately.

**Decision:**
1. Adopt the Agentic Coding Playbook structure: lean `AGENTS.md` (auto-loaded instructions), `docs/architecture.md` / `conventions.md` / `decisions.md` / `user-journey.md` / `product.md` / `stack-status.md` (context), `tasks/todo.md` / `lessons.md` / `progress.md` (tracking).
2. Claude Code is primary. Windsurf is secondary but still active.
3. Every slash command exists in both `.claude/commands/*.md` (Claude Code) and `.windsurf/workflows/*.md` (Windsurf), with byte-identical bodies. A Stop hook in `.claude/settings.json` detects drift.
4. `AGENTS.md` is the single shared instructions file (both tools auto-load it). `.windsurfrules` becomes a thin pointer.
5. `.cascade/commands/commit-push-pr.sh` is retired. Both harnesses use native `git add` + `git commit`.

**Rationale:** Dual-harness is the user's stated workflow and must be supported. A single shared rules file prevents two-source-of-truth drift. Command-level drift is the remaining risk, mitigated by the Stop hook and `/doc-sync`'s sync verification step.

**Consequences:** 20-file sync burden (10 commands × 2 harnesses). Commit discipline required: whenever a slash command is edited, both files must land in the same commit. Auto-push behavior from the old `.cascade` script is dropped — agents must not push unless explicitly asked.

---

## 2026-04-09 — Root-doc consolidation: DEPLOY merged into README, STACK_STATUS moved to docs/

**Context:** The repo root had three supplementary docs (`AGENTS.md`, `DEPLOY.md`, `STACK_STATUS.md`) whose roles overlapped with the new `docs/` structure.

**Decision:**
- `AGENTS.md` stays at root. It has a fundamentally different function from `docs/architecture.md` — directive (what the agent should do) vs. descriptive (what the system is). Playbook §A1 requires an auto-loaded instructions file.
- `DEPLOY.md` is deleted. Its content is absorbed into `README.md` as a "Deployment (Production)" section. Playbook §A6 says README is the operator's guide, which includes deployment by definition.
- `STACK_STATUS.md` is moved to `docs/stack-status.md` via `git mv` (preserves history). It has a unique function (component status registry) but belongs alongside the other context docs.

**Rationale:** Three root supplementary docs → one. Reduces cognitive load on the operator. The unique functions are preserved; only the organization changes.

**Consequences:** Any external reference (e.g. bookmarks, Railway or Vercel READMEs) pointing at `DEPLOY.md` or root-level `STACK_STATUS.md` will break. The grep verification in the migration plan catches in-repo references.

---

## 2026-04-09 — Keep `types.ts` as a hand-maintained mirror of `models.py`

**Context:** Phase 2 of the broad refactor tightened the API contract by replacing `dict[str, Any]` escape hatches with typed Pydantic submodels. The question of whether to auto-generate `client/ui/src/types.ts` from Pydantic (via `pydantic2ts` or equivalent) was raised and deferred.

**Decision:** Continue hand-maintaining `types.ts`. When a Pydantic model in `server/api/models.py` changes, the authoring agent must update `types.ts` in the same commit. Enforcement is by convention and by /doc-sync review — no tooling.

**Rationale:** Codegen is ~1 day of work including the build-step plumbing. Until schema drift becomes a real pain again, the manual sync is cheap. The Phase 2 contract tightening reduces the churn rate on models.py, so drift is less likely in the near term.

**Consequences:** Agents must continue to read `models.py` before any work that crosses the API boundary. This is already a `CLAUDE.md` rule. Revisit this decision if drift surfaces >2 bugs per quarter.

---

## 2026-04-10 — Open-framework platform: remove IP protection from LLM prompts

**Context:** Posit (then known as APT) was originally positioned as a black-box vendor product — the epistemological framework (Edge × Bankroll / Variance, streams, blocks, spaces, aggregation, decay, var_fair_ratio, etc.) was hidden behind opaque LLM deflection. The LLM system prompts in `server/api/llm/prompts/` enforced heavy IP protection: forbidden internal terminology, no absolute numbers, opaque deflection when asked about methodology. Supersedes the IP-protection motivation in the "2025 — Physical client/server split" entry (the split itself remains for deployment reasons).

**Decision:** Remove all IP protection constraints from the LLM prompts. The framework is now the product — the user sees it in plain sight and formalises data and opinions within it. Internal terminology (block, space, pipeline, var_fair_ratio, smoothing, etc.) is allowed when it is the clearest way to communicate. Absolute numbers are allowed. Opaque deflection is removed. Communication quality rules (directional neutrality, "desired position", epistemology over mechanics, no vacuous jargon) are retained.

**Rationale:** The value of Posit is not in hiding how it works — it is in providing the epistemological framework itself and the platform to use it. A user who understands blocks, spaces, and var_fair_ratio can configure their own streams more effectively and reason about position changes more precisely. Hiding the framework was creating friction without adding defensible value.

**Consequences:** The LLM will now use framework terminology and quote exact values when helpful. The physical client/server split remains for deployment architecture, though its original IP motivation is no longer primary.

---

## 2026-04-17 — Rebrand from APT to Posit

**Context:** "APT — Automated Positional Trader" was the working name during development. It was too generic (collides with the advanced persistent threat acronym) and too verbose (tied to a legacy "automated trader" framing that no longer matches the positioning — Posit is an advisory platform, not an autonomous agent).

**Decision:** Rebrand everything user-visible and operator-visible from APT to Posit. Tagline: "a positional trading platform." The change spans UI strings, LLM system prompts, env var (`APT_MODE` → `POSIT_MODE`), localStorage keys (with migration), OpenRouter app metadata, pitch deck, operations docs, legal agreement template, and historical artifacts. The local directory `auto-mm-pilot/` and the GitHub repo name are not renamed in this pass — that is an out-of-codebase action tracked separately.

**Rationale:** (1) Brand clarity — "APT" has established meaning in security contexts; "Posit" is distinctive. (2) Positioning accuracy — "positional trading platform" describes what it is without claiming autonomy the product deliberately does not have. (3) The rebrand was cheap now (single PR) and would get exponentially more expensive after the first customer signed a license agreement referencing "APT."

**Consequences:** Operators deploying to Railway must rename `APT_MODE` → `POSIT_MODE` in their env vars (and optionally rename the Railway domain `apt-admin` → `posit-admin`). Vercel `VITE_API_BASE` follows if the Railway domain is renamed. Existing users' localStorage layouts are preserved via a one-time migration in `LayoutProvider`, `OnboardingProvider`, and `StreamCanvas`.

---

## 2026-04-10 — Modular LLM prompt architecture

**Context:** The monolithic investigation prompt (~15KB static) was used for all LLM interactions — from deep position-change analysis to simple "got it" acknowledgements. This wasted tokens and caused verbose responses to simple questions. The stream co-pilot (removed in a prior commit) had been a separate panel; its functionality needed to merge into the same chat interface.

**Decision:** Replace the monolithic prompt with a modular composition pipeline. The client sends a `mode` field (`investigate | configure | opinion | general`) on every `/api/investigate` request. The server composes a system prompt from shared core + mode-specific extension + mode-appropriate data. Shared content (role, framework summary, hard constraints, language rules, response discipline) lives in `core.py` and is stated once. Each mode extension adds only what it needs. `max_tokens` reduced from 8196 to 2048 to enforce proportional responses.

**Rationale:** (1) Token efficiency — general mode is ~3.9KB vs. 15KB before. Investigation mode is ~7.8KB, a 48% reduction. (2) Proportional responses — the LLM no longer receives reasoning protocol instructions when answering a casual question. (3) Extensibility — configure and opinion modes are stubs that can be filled in when Flows 2 and 3 are built, without touching the core or investigation code. (4) Intent clarity — the client declares intent explicitly, so the LLM can flag mismatches rather than guessing.

**Consequences:** `preamble.py` is deleted; its content is in `core.py`. `investigation.py` is investigation-only. New files: `core.py`, `general.py`, `configure.py`, `opinion.py`. The `__init__.py` dispatcher exposes `build_system_prompt(mode, ...)` instead of `get_investigation_prompt`. Client gains a mode selector dropdown in the chat header.

---

## 2026-04-18 — Workbench: focus-driven Inspector + chat as a deliberate gesture (Phase 1 of the UX redesign)

**Context:** The user reported the Floor↔Brain page swap was finicky to navigate, and that clicking a position cell silently auto-attached its context to the LLM chat — surprising behaviour because users expect "click → inspect," not "click → ask the AI." The two-page split also forced a coordinated stamp-and-walk between Floor (positions) and Brain (decomposition + chart + block table).

**Decision:** Collapse Floor and Brain into a single `WorkbenchPage`. Introduce a typed `Focus` union (`cell | symbol | expiry | stream | block`) and a `FocusProvider` that every clickable surface writes to. The right rail (`WorkbenchRail`) is a tabbed pane with two tabs: an `Inspector` that channels to the current focus (one inspector component per focus kind), and `Chat` (the existing `LlmChat`). `ChatProvider.investigate()` no longer auto-opens any drawer — it sets context only; the rail surfaces Chat in response. Add `GET /api/streams/{name}/timeseries` so the Stream inspector can show per-key history (sourced from the existing in-memory snapshot rows — no new storage). Hotkeys: `?` for the cheatsheet, `[`/`]` to collapse the rail, `Esc` to clear focus, `g`-prefix chord nav, `⌘K` for the palette (now searches modes, cells, streams, and blocks).

**Rationale:** (1) Click-to-focus is the convention every industry tool uses (IDEs, financial terminals, dashboards) — the previous click-to-chat coupling was idiosyncratic. (2) A single `Focus` makes inspection coherent: one click anywhere channels everything that can show context. (3) Unifying the pages eliminates the navigation hop the user complained about, while keeping `Anatomy` separate (it's a different mental mode — pipeline structure, not output). (4) Sourcing stream timeseries from the existing snapshot rows avoids spinning up a new persistence layer for Phase 1.

**Consequences:** Deleted `FloorPage.tsx`, `BrainPage.tsx`, `SelectionProvider.tsx`, `useFocusedCell.ts`, and `ChatDrawer.tsx`. `ModeProvider` modes change from `eyes/brain/anatomy/docs` to `workbench/anatomy/docs`; legacy `eyes`/`brain`/`floor` URL hashes redirect to `workbench`. `LayoutProvider` is now used only by the Anatomy/Docs surfaces — Workbench has fixed slots. `PipelineChart` no longer takes a `selected` prop; it reads block focus from `FocusProvider`. Phase 2 (visual language overhaul, density tokens, layered glass, account menu, sidebar nav) is intentionally not in this entry — it lands in a separate decision once Phase 1 has soaked.

---

## 2026-04-18 — Workbench: AppShell, density pass, primitives, vestigial cleanup (Phase 2 of the UX redesign)

**Context:** With Phase 1's focus-driven Workbench in place, the chrome (a single 56px `GlobalContextBar` cramming brand + mode switcher + search + chat + docs + automation toggle + clock + user menu into one strip) was the next bottleneck. It violated industry conventions (sidebar nav, top-right account, bottom status bar) and made the canvas feel cramped vertically. Density was also conservative — cells used `py-2.5` against a 16px base font when traders want closer to 11px / `py-1`.

**Decision:** Introduce `<AppShell/>` with three regions: collapsible left `<LeftNav/>` (brand + mode nav + palette/chat/onboarding + `<UserMenu/>` pinned at bottom), main page slot, 24px bottom `<StatusBar/>` (WS state, last-tick freshness, Posit Control toggle, palette + cheatsheet hints, UTC clock). Add reusable `<Tabs/>` and `<Sidebar/>` primitives — Tabs adopted by `WorkbenchRail`, `DesiredPositionGrid` view modes, `LlmChat` mode select; Sidebar used by `LeftNav` only this round (refactoring `WorkbenchRail`/`StreamSidebar` to share it is a Phase 3 cleanup). Refresh visual tokens: 11px body base, refined glass (layered blur + saturate, inset top-edge highlight, `shadow-elev-{1,2,3}` scale), tighter cell padding across heavy components, optional grain overlay behind `VITE_UI_GRAIN=1`. Delete `GlobalContextBar.tsx`, `LayoutProvider.tsx`, `PanelWindow.tsx`, and the `react-grid-layout` dependency — all vestigial after Phase 1.

**Rationale:** (1) The new shell follows what every industry-grade trading and dev tool does (Bloomberg sidebar, Linear/VS Code/JetBrains, etc.) so the trader has zero learning cost on the chrome itself. (2) Spreading state across LeftNav (navigation), main (workspace), StatusBar (system state) reads naturally — each surface answers one question. (3) The Tabs primitive collapses three bespoke patterns into one consistent renderer, lowering the cost of adding a fourth. (4) An 11px base + glass refinement closes the gap to "modern" without losing density; saturate(1.4) on the blur is the small tweak that makes glass feel polished instead of milky. (5) Removing `react-grid-layout` saves ~80KB and removes a code path no live consumer reaches.

**Consequences:** Deleted `GlobalContextBar.tsx`, `LayoutProvider.tsx`, `PanelWindow.tsx`. `react-grid-layout` removed from `package.json`. New components: `shell/AppShell.tsx`, `shell/LeftNav.tsx`, `shell/StatusBar.tsx`, `ui/Tabs.tsx`, `ui/Sidebar.tsx`. `tailwind.config.ts` gains `xxs`/`xs2` font sizes, `mm-accent-soft` colour, and the `shadow-elev-{1,2,3}` scale. `index.css` body sets 11px base font and adds an optional grain overlay gated by `data-grain="on"` (set by `VITE_UI_GRAIN=1` at boot). The `Posit Control` toggle is advisory today — `POSIT_CONTROL_KEY` persists state but the server doesn't yet read it; a follow-up task wires it through. Phase 3 candidates: refactor `WorkbenchRail` + Anatomy `StreamSidebar` onto the shared `<Sidebar/>` primitive; promote `Cmd-K` palette commands beyond jump-to (create stream, toggle rail, etc.).

---

## 2026-04-19 — Workbench polish: layout, reversibility, CLI chat (post-Phase-2 round)

**Context:** First-use feedback on the Phase-2 Workbench surfaced a cluster of issues: (1) the rail toggle blanked the panel because `WorkbenchRail` violated the Rules of Hooks (early return before a `useMemo`); (2) the pipeline chart was buried in the rail and felt cramped — the trader needed it large on the canvas; (3) the right-edge collapse button moved between two locations depending on rail state; (4) the WS still broadcast streams that the per-user registry no longer had, so `StreamInspector` 404'd; (5) Account / Admin had explicit "✕ Close" buttons that violated the user's stated principle "every interaction should be reversible by the same or opposite gesture."

**Decision:** Restructure the Workbench main canvas: position grid + pipeline chart side-by-side on top (chart channels to focus via a new `PipelineChartPanel`), data streams + block inspector side-by-side on bottom, updates as a horizontal `UpdatesTicker` strip above. Trim the right rail to scalars + lists (no chart inside) and replace the inconsistent collapse control with an always-anchored handle on the rail's left edge. Add column filters + a "follow focus" toggle to the block inspector (auto-filter to the focused symbol/expiry) plus a source breakdown ("72 stream + 2 manual") in the header. Route Account / Admin through the mode system so leaving them is just clicking another sidebar entry; drop their close buttons. Filter `streams_from_blocks` against the per-user registry so stale stream names don't reach the WS payload. Promote chat to a CLI-style surface (slash commands `/clear`, `/explain`, `/build`, `/general`, `/copy`, `/help`; up/down arrow history persisted to localStorage; monospace prompt with `›` glyph). Make the `?` cheatsheet shortcut toggle (open and close).

**Rationale:** (1) The chart placement matches the trader's mental hierarchy — the pipeline is the primary signal, not a peripheral inspector. (2) The edge handle gives the rail a single, predictable affordance — same control, same location, both states. (3) Filtering streams at the WS layer keeps the registry as the single source of truth for "what streams exist for this user," eliminating an entire class of stale-cache bugs. (4) Routing Account/Admin through the mode system unifies navigation under one mental model and removes "✕ Close" — every page is left the same way (click another sidebar entry). (5) The CLI chat affordances raise the ceiling for power users without changing the shape of the surface (still a panel, still a textbox + history) — the trader can opt into slash commands without learning anything new to send a normal prompt.

**Consequences:** New components: `workbench/UpdatesTicker.tsx`, `workbench/PipelineChartPanel.tsx`, `shell/TopBar.tsx` (slim mode + focus breadcrumb header). `ChatProvider` exposes `clearMessages` + `pushSystemMessage` (used by slash commands). `ModeId` extends to include `account` + `admin`; `PRIMARY_MODES` is the trader-facing subset for the LeftNav. AccountPage / AdminPage drop their `onClose` props + close buttons. `EditableBlockTable` has Tanstack column filters wired to symbol + expiry selects with a follow-focus toggle persisted to `posit-blocks-follow-focus`. Server `streams_from_blocks` accepts an `allowed_names` set; `ws.py` passes the registry's stream names. Block count breakdown ("X stream + Y manual") explains the previously-confusing total. `?` cheatsheet shortcut now toggles. Inspector surfaces (`CellInspector`, `SymbolExpiryInspector`) lean — chart lives on canvas. Phase 3 candidates updated: ranking-aware `Cmd-K` results, multi-tab chat conversations (foundation laid via slash commands + history), Posit Control wired server-side.
