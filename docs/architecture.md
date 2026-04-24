# Architecture

## System Overview

Posit is an advisory trading platform for crypto options market-making desks. It is physically split into a local client (data ingestion + UI display) and a remote server (proprietary calculations) with a deliberate visibility barrier between them. The server computes `Desired Position = Edge × Bankroll / Variance` over a configurable pipeline of data streams, blocks, and spaces; the client renders the result and lets the trader investigate positions via an LLM layer. This is a vendor product where the client receives the terminal + adapters and we retain the math IP.

## Component Map

| Lane | Owner | Purpose |
|------|-------|---------|
| `client/adapter/` | LLM | Data standardization scripts, universal adapter (not yet built) |
| `client/ui/` | LLM | Electron + React dashboard |
| `sdk/` | LLM | Client-facing Python SDK (`posit-sdk` on PyPI) — async HTTP + WebSocket wrapper external integrators use to push snapshots and receive positions. Standalone package with its own `pyproject.toml`; not imported by `server/` or `client/`. |
| `server/api/` | LLM | FastAPI routing, WebSocket transport, request/response models |
| `server/api/llm/` | LLM | OpenRouter client, LLM service, system prompts, snapshot buffer |
| `server/core/` | LLM | Proprietary math — the pricing pipeline plus the server-side connector framework (pre-built input transforms such as realized-vol). |
| `pitch/` | LLM | Next.js presentation deck (architecture slides, links to deployed client for demo) |
| `prototyping/` | LLM | Notebooks for manual API exploration |

## Data Flow (MVP Pipeline)

1. Raw data stream → ingested at local client
2. Data format standardization → cleaned in local client
3. *— TRANSMISSION ACROSS VISIBILITY BARRIER —*
4. Block expansion → Python server (`build_blocks_df`, raw→calc)
5. Risk-space aggregation → Python server (per-space mean over blocks)
6. Calc→target + smoothing + position sizing → Python server
7. *— TRANSMISSION ACROSS VISIBILITY BARRIER —*
8. Desired position → displayed in local client terminal

See `docs/product.md` for the 4-space model (risk / raw / calc / target) these steps traverse.

## Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Auto-loaded agent instructions for Claude Code + Windsurf |
| `.windsurfrules` | Windsurf-specific thin pointer to `CLAUDE.md` |
| `docs/architecture.md` | This file — system map |
| `docs/llm-orchestration.md` | LLM Build pipeline developer reference — stage flow, event shapes, persistence, config knobs |
| `docs/conventions.md` | Patterns used, patterns avoided, schema sources of truth |
| `docs/decisions.md` | Append-only decision log |
| `docs/user-journey.md` | Personas + core flows |
| `docs/product.md` | Theory: Edge × Bankroll / Variance, stream/block/space epistemology |
| `docs/stack-status.md` | Component PROD/MOCK/STUB/OFF registry |
| `tasks/todo.md` | Active work tracker |
| `tasks/lessons.md` | Self-improvement loop — lessons learned from corrections |
| `tasks/progress.md` | Mid-session handoff notes |
| `.claude/commands/*.md` | Claude Code slash commands (harness primary) |
| `.windsurf/workflows/*.md` | Windsurf workflows (harness secondary, must mirror `.claude/commands/`) |
| `.claude/settings.json` | Claude Code hooks: block `server/core/` writes, typecheck + drift-check on Stop |
| `client/ui/src/App.tsx` | Mounts `<AppShell/>` + global overlays (CommandPalette, HotkeyCheatsheet, BlockDrawer). Owns auth↔app fade and mode cross-fade via `AnimatePresence`. Splash gate via `useAppReady`. Hotkey wiring (`?`, `[`, `]`, `g`-chords). |
| `client/ui/src/components/shell/AppShell.tsx` | Three-region authenticated chrome — left `<LeftNav/>`, main slot, bottom `<StatusBar/>`. Replaces the deleted `GlobalContextBar`. |
| `client/ui/src/components/shell/PositSplash.tsx` | Full-screen branded splash shown between login and first WS tick. Matches the body gradient, breathes the mark, drives its own enter fade + exit controlled by `<AnimatePresence>` in `App.tsx`. |
| `client/ui/src/components/shell/PositLogo.tsx` | Posit wordmark + SVG mark (solid indigo point + offset reference circle). Used by the splash, LeftNav brand, and LoginPage. |
| `client/ui/src/hooks/useAppReady.ts` | Owns the "app ready?" gate: signed-in + first-tick-received + min 400ms splash display. Returns `{ ready, message }` for the splash. |
| `client/ui/src/components/shell/LeftNav.tsx` | Collapsible left sidebar — brand, mode nav, palette/chat/notifications actions, `<UserMenu/>` pinned at the bottom. Persists collapsed state. |
| `client/ui/src/components/shell/StatusBar.tsx` | 24px bottom strip — WS state, last-tick freshness, Posit Control toggle (advisory until server hook lands), palette + cheatsheet hints, UTC clock. |
| `client/ui/src/components/ui/Tabs.tsx` | Reusable tab strip primitive (pill + underline variants). Used by WorkbenchRail, DesiredPositionGrid view modes, LlmChat mode select. |
| `client/ui/src/components/ui/Sidebar.tsx` | Reusable sidebar shell (collapsible, glass). Used by LeftNav today; `WorkbenchRail` and Anatomy `StreamSidebar` keep their bespoke shells (Phase 3 cleanup candidate). |
| `client/ui/src/components/ui/Tooltip.tsx` | Reusable affordance-hint primitive — framer-motion popover, 400ms hover delay, immediate on keyboard focus, Esc-dismissible, portal-rendered. Preferred over native `title=` for any icon-only or cryptic control. |
| `client/ui/src/pages/WorkbenchPage.tsx` | **Unified Workbench** — replaces the old Floor + Brain pages. Position grid + streams + updates + block table on the canvas, focus-driven Inspector + Chat in the right rail. |
| `client/ui/src/components/workbench/WorkbenchRail.tsx` | Right rail with Inspector + Chat tabs; collapsible (persisted), responds to `[` / `]` and to `investigate()` from `ChatProvider`. |
| `client/ui/src/components/workbench/InspectorRouter.tsx` | Routes Inspector content based on current `Focus` kind. |
| `client/ui/src/components/workbench/inspectors/*.tsx` | One file per focus kind: `CellInspector`, `SymbolExpiryInspector`, `StreamInspector`, `BlockInspector`, `EmptyInspector`. |
| `client/ui/src/components/proposal/BlockIntentCard.tsx` | Read-only "Why this block exists" card — renders the trader's verbatim phrasing + preset/custom reasoning + commit timestamp for any stream that was committed via the Build orchestrator. Mounted inside both `StreamInspector` and `BlockInspector`; hidden entirely on 404. |
| `client/ui/src/hooks/useStreamIntent.ts` | Hook backing `BlockIntentCard` — 4-state `loading / hidden / ready / error` model with AbortController race protection, resolves `GET /api/streams/{name}/intent`. |
| `client/ui/src/components/workbench/HotkeyCheatsheet.tsx` | `?`-triggered overlay listing every workbench keyboard shortcut. |
| `client/ui/src/providers/FocusProvider.tsx` | Workbench focus state — typed `Focus` union (cell / symbol / expiry / stream / block). Replaces the old `SelectionProvider`. |
| `client/ui/src/hooks/useHotkeys.ts` | Bare-key + `g`-prefix chord hotkey hook. Skips events while typing in inputs. |
| `client/ui/src/types.ts` | **Canonical TypeScript interfaces for all client-side data shapes.** Read before any feature crossing the API boundary. Includes `Focus` union + `StreamTimeseriesResponse`. |
| `client/ui/src/providers/WebSocketProvider.tsx` | Central WS state manager — connects to server `/ws`, auto-reconnects |
| `client/ui/src/constants.ts` | Shared UI constants — magic numbers hoisted from components (Phase 4) |
| `client/ui/src/providers/ChatProvider.tsx` | Team chat + @Posit LLM routing context. `investigate()` no longer auto-opens a drawer — sets context only; the rail surfaces Chat in response. |
| `client/ui/src/components/LlmChat.tsx` | Team Chat panel — messages, note threads, investigation context. Hosted as a tab inside `WorkbenchRail`. |
| `client/ui/src/components/ApiDocs.tsx` | Client-facing API documentation panel — shell + short sections; long sections extracted under `apiDocs/` (`QuickstartSection`, `PublicWebSocketSection`, `ClientWebSocketSection`) |
| `client/ui/src/components/DesiredPositionGrid.tsx` | Position grid — single-click cell/row/col sets workbench focus (no chat side-effect); double-click edits the cell value. |
| `client/ui/src/components/UpdatesFeed.tsx` | Position-change update cards — single-click sets focus to the corresponding cell. |
| `client/ui/src/components/PipelineChart.tsx` | Pipeline time-series chart (controlled child) — reads block focus from `FocusProvider`; series-click toggles block focus. |
| `client/ui/src/components/studio/brain/EditableBlockTable.tsx` | Blocks tab inside OpinionsPanel — groups pipeline rows by `(block_name, stream_name)` family with fair / variance ranges; chevron expands to per-dim rows. Family row click → `opinion` focus (jumps to OpinionInspector); dim row click → `block` focus (BlockInspector). Preserves the symbol / expiry / stream / source filters + global-text filter + follow-focus logic. |
| `client/ui/src/components/studio/brain/BlockDrawer.tsx` | Unified block drawer — create (empty or LLM-prefilled), edit (manual blocks), inspect (stream blocks). Draft state in `blockDrawerState.ts`, sub-components in `BlockDrawerParts.tsx`, submit + snapshot-edit callbacks in `useBlockDraftSubmit` and `useSnapshotEditor` hooks. |
| `client/ui/src/pages/AnatomyPage.tsx` | Top-level Anatomy mode — thin wrapper around `AnatomyCanvas` |
| `client/ui/src/services/engineCommands.ts` | Engine-command parser + executor — strips `engine-command` fenced blocks from LLM text, routes to BlockDrawer or auto-executes |
| `client/ui/src/components/opinions/OpinionsPanel.tsx` | Bottom-of-Workbench tabbed panel (Opinions + Blocks). Replaced the former `StreamStatusList` + `EditableBlockTable` side-by-side bottom row. Hosts the `+ New opinion` button (opens BlockDrawer). |
| `client/ui/src/components/opinions/OpinionsTable.tsx` | Opinions tab — one row per stream (data) or manual block (view) with inline-editable description, last-update age, active toggle, source pill, and confirm-delete. Row click sets `opinion` focus. |
| `client/ui/src/components/workbench/inspectors/OpinionInspector.tsx` | Right-rail inspector for `opinion` focus — editable description (falls back to immutable `BlockIntent.original_phrasing`), concerns card, reused time-series chart, per-dim blocks summary. |
| `client/ui/src/components/workbench/inspectors/StreamTimeseriesView.tsx` | Shared chart + key-list body extracted from StreamInspector so OpinionInspector reuses it without the surrounding chrome. |
| `client/ui/src/services/opinionsApi.ts` | HTTP client for `/api/opinions` (list, patch description, patch active, delete). |
| `client/ui/src/services/streamTimeseriesApi.ts` | HTTP client for `GET /api/streams/{name}/timeseries`. Sourced from in-memory snapshot rows. |
| `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx` | Anatomy — React Flow DAG. Stream nodes (click to edit, hover for mapping/block details/active toggle/delete), `+ New stream` tile under the stream column, transform nodes, output node. |
| `client/ui/src/components/studio/anatomy/nodes/StreamNode.tsx` | Stream node card + hover popover (portal-rendered). |
| `client/ui/src/components/studio/anatomy/nodes/AddStreamNode.tsx` | `+ New stream` tile — click opens a blank StreamCanvas in the detail panel. |
| `client/ui/src/components/studio/anatomy/nodes/ConnectorNode.tsx` | Anatomy node rendered upstream of every connector-fed stream — labelled with the connector's display name + output unit so the trader can read provenance (input → connector → stream → pipeline) at a glance. |
| `client/ui/src/services/connectorApi.ts` | Thin wrapper over `GET /api/connectors`; metadata only — connector implementations stay server-side. |
| `client/ui/src/hooks/useConnectorCatalog.ts` | Module-cached connector catalog hook — one fetch per page load, shared across the canvas + Anatomy DAG. |
| `client/ui/src/components/studio/anatomy/NodeDetailPanel.tsx` | Right-side inspector hosted by AnatomyCanvas — renders StreamCanvas for stream nodes, TransformDetail for transforms. |
| `client/ui/src/components/studio/StreamCanvas.tsx` | 7-section stream create/edit form — hosted inside NodeDetailPanel. |
| `client/ui/src/services/api.ts` | `apiFetch` JSON wrapper + `streamFetchSSE` SSE helper — canonical HTTP/SSE path for every other service module |
| `client/ui/src/services/llmApi.ts` | `streamChat()` — thin wrapper around `streamFetchSSE` for `POST /api/investigate` |
| `client/ui/src/services/streamApi.ts` | HTTP client for stream CRUD, snapshot ingestion, market-pricing, bankroll endpoints |
| `client/ui/src/services/pipelineApi.ts` | HTTP client for pipeline dimensions + time series endpoints |
| `client/ui/src/services/blockApi.ts` | HTTP client for block table endpoints (GET/POST /api/blocks) |
| `client/ui/src/services/marketValueApi.ts` | HTTP client for `/api/market-values` CRUD (aggregate total vol per symbol/expiry) |
| `client/ui/UI_SPEC.md` | UI design specification |
| `server/api/config.py` | OpenRouter env config (API key, model fallback lists, generation params, snapshot buffer settings) |
| `server/api/models/` | **Canonical Pydantic request/response models for all API boundary data.** Split by concern: `_shared` (base primitives), `auth` (auth / account / admin / usage), `streams` (stream / connector / snapshot / block / WS / transform / market-value / broadcast / pipeline-series), `llm` (5-stage Build pipeline, preview / commit / stored intent, admin latency telemetry). `models/__init__.py` re-exports every public name so `from server.api.models import X` still works. Read the relevant sub-module before any feature crossing the API boundary. |
| `server/api/main.py` | FastAPI app factory — lifespan, CORS, error handler, router registration, health + WS mounts |
| `server/api/routers/*.py` | Route modules (llm, streams, snapshots, bankroll, transforms, pipeline, blocks, market_values, connectors, opinions) extracted from main.py |
| `server/api/routers/opinions.py` | Aggregated trader-facing endpoint — one `Opinion` per stream from `StreamRegistration + BlockIntent + pipeline block_count`. Description writes land on `StreamRegistration.description`; `BlockIntent.original_phrasing` stays immutable for audit. |
| `server/api/stream_registry.py` | In-memory stream registry — CRUD, snapshot storage, validation, `StreamConfig` builder |
| `server/api/blocks/manual_block.py` | Shared `apply_manual_block(...)` helper — create → configure → (optional) ingest → mark → rerun+broadcast in one place, with consistent rollback on any step failure. Used by both `POST /api/blocks` (+ Manual block button) and `POST /api/blocks/commit` (Build-orchestrator confirm). |
| `server/api/market_value_store.py` | Aggregate-market-value singleton — `{(symbol, expiry): total_vol}` + dirty flag for coalesced ticker reruns |
| `server/api/ws.py` | WebSocket endpoint — singleton ticker broadcasts pipeline ticks; `restart_ticker()` on re-run. Each broadcast is validated through `ServerPayload`. |
| `server/api/ws_serializers.py` | Pipeline DataFrame → JSON-safe dict serialization helpers (extracted from `ws.py`) |
| `server/api/client_ws.py` | Client-facing WS endpoint (`/ws/client`) — auth-gated, inbound snapshot frames with ACK, joins broadcast for outbound positions |
| `server/api/client_ws_auth.py` | Client WS auth — API key validation + IP whitelist, runs before accept |
| `server/api/engine_state.py` | Engine state singleton — mock init + live `rerun_pipeline()`, mutable bankroll |
| `server/api/llm/client.py` | Async OpenRouter HTTP client (complete + stream + fallback wrappers) |
| `server/api/llm/service.py` | LLM service — Investigate / General chat streaming wrapper |
| `server/api/llm/build_orchestrator.py` | Build-mode orchestrator — event loop + four `_run_*` stage runners (router → intent → synthesis → critique) |
| `server/api/llm/stages.py` | `run_json_stage` / `run_tool_stage` — canonical `record_call` + `complete_with_fallback` glue; hosts `StageError` |
| `server/api/llm/openrouter_parse.py` | Canonical OpenRouter response helpers — `get_content`, `get_tool_call`, `strip_markdown_fences`, `parse_json_content` |
| `server/api/llm/synthesis_payload.py` | Synthesis tool-call → `ProposedBlockPayload` conversion (preset + custom) with framework-invariant validation |
| `server/api/llm/preview.py` | Stage 4 — runs the pipeline on a simulated stream-config list and diffs `desired_pos_df` against live state |
| `server/api/llm/orchestration_config.py` | `LlmOrchestrationConfig` — single frozen dataclass holding every tunable threshold / model chain / temperature / token budget with env-var overrides |
| `server/api/llm/parameter_presets.py` | Preset registry — canonical situation → `(BlockConfig, UnitConversion)` mappings; serialised into the Stage-3 prompt |
| `server/api/llm/audit.py` | `record_call` context manager — persists one `LlmCall` row per outbound LLM request |
| `server/api/llm/feedback_detector.py` | Stage-5 async fanout — corrections → `domain_kb`, discontent → `llm_failures`, preferences → `user_context` |
| `server/api/llm/block_intents.py` | Persistence for `BlockIntent` rows — intent triplet attached to every committed stream |
| `server/api/llm/failures.py` | Persistence for `LlmFailure` rows — discontent / preview_rejection / silent_rejection / post_commit_edit |
| `server/api/llm/pending_proposals.py` | Per-user in-memory map of outstanding Build proposals under an `asyncio.Lock`. Registered at `/api/blocks/preview`, resolved at commit / preview_rejection, overflow-evicted to `llm_failures(signal_type="silent_rejection")`. |
| `server/api/llm/silent_rejection_sweep.py` | Background coroutine started by `main.lifespan` — every `silent_rejection_sweep_interval_secs` drains stale `pending_proposals` entries and logs each as `llm_failures(signal_type="silent_rejection")`. Clean `CancelledError` shutdown. |
| `server/api/llm/user_context.py` | Per-user controlled-vocabulary context store + prompt serialiser |
| `server/api/llm/models.py` | SQLAlchemy ORM — `LlmCall`, `BlockIntent`, `LlmFailure`, `UserContextEntry`, `DomainKbEntry` |
| `server/api/llm/snapshot_buffer.py` | Pipeline snapshot ring buffer — stores time-series history, builds condensed delta tables for LLM context |
| `server/api/llm/context_db.py` | Stream context database — metadata about each data stream (MOCK-initialized) |
| `server/api/llm/prompts/__init__.py` | `build_system_prompt(mode, ...)` dispatcher — routes Investigate / General to mode-specific builders (Build is handled by `build_orchestrator`) |
| `server/api/llm/prompts/core.py` | Shared core: role, framework, language rules, hard constraints, response discipline |
| `server/api/llm/prompts/investigation.py` | Investigation mode: reasoning protocol, data sections, engine commands |
| `server/api/llm/prompts/general.py` | General mode: catch-all conversational, minimal engine summary |
| `server/api/llm/prompts/router.py` | Stage-1 intake router prompt (view / stream / headline / question / none) |
| `server/api/llm/prompts/intent_extractor.py` | Stage-2 prompt — emits `IntentOutput` (StructuredIntent / RawIntent / clarifying_question) |
| `server/api/llm/prompts/synthesiser.py` | Stage-3 prompt + `select_preset` / `derive_custom_block` tool schemas |
| `server/api/llm/prompts/critique.py` | Stage-3.5 prompt — reviews custom derivations against framework invariants |
| `server/core/__init__.py` | Core pipeline package — re-exports public API |
| `server/core/config.py` | `BlockConfig`, `StreamConfig` dataclasses, `SECONDS_PER_YEAR` |
| `server/core/helpers.py` | `annualize`, `deannualize` |
| `server/core/transforms/` | Pipeline transform package — one module per step (`registry`, `unit_conversion`, `decay`, `fair_value`, `variance`, `risk_space_aggregation`, `market_value_inference`, `aggregation`, `calc_to_target`, `smoothing`, `position_sizing`). Public API re-exported from `__init__.py`. |
| `server/core/pipeline.py` | All pipeline step functions + `run_pipeline()` orchestrator |
| `server/core/mock_scenario.py` | Mock stream configs, scenario params, market pricing |
| `server/core/serializers.py` | DataFrame→dict bridge for LLM prompt injection |
| `server/core/connectors/` | Server-side pre-built input transforms (`base.py` + `registry.py` + one module per connector — `realized_vol.py` today). Catalog metadata is served to the client via the connectors router; connector implementations never leave the server (IP-barrier asset). Public API re-exported from `__init__.py`. |
| `server/api/connector_state.py` | Per-user connector state store, keyed by stream name. Mediates API input rows → connector `process()` → emitted `SnapshotRow`s; state is opaque to the rest of the server. Evicts on stream delete or connector switch. Surfaces warm-up progress via `describe_stream`. |
| `sdk/pyproject.toml` | `posit-sdk` package metadata (hatchling, v0.1.0) — independent PyPI distribution |
| `sdk/posit_sdk/client.py` | `PositClient` — public facade over REST + WebSocket; pool caching, fallback logic |
| `sdk/posit_sdk/rest.py` | Async httpx wrapper for the REST surface (stream CRUD, snapshots, market values, bankroll) |
| `sdk/posit_sdk/ws.py` | Auto-reconnecting WebSocket client with ACK correlation and position fan-out |
| `sdk/posit_sdk/models.py` | Pydantic v2 wire shapes (matches `server/api/models.py` on the wire; SDK's source of truth) |
| `sdk/tests/` | Comprehensive SDK tests (validation, upsert, WS state, market value, positions) |
| `docs/sdk-quickstart.md` | End-to-end SDK integration guide for data-feed authors |
| `prototyping/test_api.ipynb` | API integration test notebook — exercises full prod-mode pipeline via HTTP |
| `Procfile` | Railway start command for FastAPI server |
| `runtime.txt` | Python version pin for Railway |
| `requirements.txt` | Root-level Python deps for Railway (mirrors `server/api/requirements.txt`) |
| `client/ui/vercel.json` | Vercel build/routing config for SPA deployment |
| `start.sh` | Local dev bootstrapper — starts server + client |

## Key Design Decisions

1. **Physical client/server split for IP protection.** All proprietary math lives in `server/core/` on our cloud. The client cannot derive the pricing model from what it receives; it only sees outputs.
2. **Polars over Pandas.** Columnar expressions, lazy evaluation, Rust speed. Never use `iterrows()` or scalar loops.
3. **OpenRouter with model fallback chain** over single-provider LLM. Configured in `server/api/config.py`.
4. **Singleton WS ticker** (`server/api/ws.py`) broadcasts pipeline ticks to all connected clients — one source of truth for pipeline state. Restart via `restart_ticker()` when re-running.
5. **Auth-gated `/ws/client`** (`server/api/client_ws_auth.py`) — API key + IP whitelist, runs before WS accept.
6. **Pydantic at the server API boundary, TypeScript interfaces at the client API boundary.** No raw dicts crossing the wire.
7. **Click-to-focus, never click-to-chat.** Single click on any cell, header, stream row, or block sets a typed `Focus` (`FocusProvider`); the right-rail `Inspector` channels to it. Chat is a deliberate second action ("Ask @Posit" button or `⌘/`). Removed the older "click cell → open chat with cell context attached" coupling so inspection stays separate from conversation.

See `docs/decisions.md` for the full reasoning behind each.

## Boundaries & Contracts

- **Server API boundary:** all request/response shapes defined in the `server/api/models/` package (Pydantic). Validation runs automatically at request time.
- **Client API boundary:** all inbound/outbound shapes defined in `client/ui/src/types.ts` (TS interfaces). These must match the Pydantic models — when changing one, check the other.
