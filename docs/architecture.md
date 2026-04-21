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
| `server/core/` | LLM | Proprietary math — the pricing pipeline. |
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
| `client/ui/src/App.tsx` | Mounts `<AppShell/>` + global overlays (CommandPalette, HotkeyCheatsheet, OnboardingFlow, BlockDrawer). Hotkey wiring (`?`, `[`, `]`, `g`-chords). |
| `client/ui/src/components/shell/AppShell.tsx` | Three-region authenticated chrome — left `<LeftNav/>`, main slot, bottom `<StatusBar/>`. Replaces the deleted `GlobalContextBar`. |
| `client/ui/src/components/shell/LeftNav.tsx` | Collapsible left sidebar — brand, mode nav, palette/chat/onboarding actions, `<UserMenu/>` pinned at the bottom. Persists collapsed state. |
| `client/ui/src/components/shell/StatusBar.tsx` | 24px bottom strip — WS state, last-tick freshness, Posit Control toggle (advisory until server hook lands), palette + cheatsheet hints, UTC clock. |
| `client/ui/src/components/ui/Tabs.tsx` | Reusable tab strip primitive (pill + underline variants). Used by WorkbenchRail, DesiredPositionGrid view modes, LlmChat mode select. |
| `client/ui/src/components/ui/Sidebar.tsx` | Reusable sidebar shell (collapsible, glass). Used by LeftNav today; `WorkbenchRail` and Anatomy `StreamSidebar` keep their bespoke shells (Phase 3 cleanup candidate). |
| `client/ui/src/pages/WorkbenchPage.tsx` | **Unified Workbench** — replaces the old Floor + Brain pages. Position grid + streams + updates + block table on the canvas, focus-driven Inspector + Chat in the right rail. |
| `client/ui/src/components/workbench/WorkbenchRail.tsx` | Right rail with Inspector + Chat tabs; collapsible (persisted), responds to `[` / `]` and to `investigate()` from `ChatProvider`. |
| `client/ui/src/components/workbench/InspectorRouter.tsx` | Routes Inspector content based on current `Focus` kind. |
| `client/ui/src/components/workbench/inspectors/*.tsx` | One file per focus kind: `CellInspector`, `SymbolExpiryInspector`, `StreamInspector`, `BlockInspector`, `EmptyInspector`. |
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
| `client/ui/src/components/studio/brain/EditableBlockTable.tsx` | Block Inspector — TanStack Table; single-click sets block focus, double-click opens BlockDrawer for editing. |
| `client/ui/src/components/studio/brain/BlockDrawer.tsx` | Unified block drawer — create (empty or LLM-prefilled), edit (manual blocks), inspect (stream blocks). Draft state in `blockDrawerState.ts`, sub-components in `BlockDrawerParts.tsx`, submit + snapshot-edit callbacks in `useBlockDraftSubmit` and `useSnapshotEditor` hooks. |
| `client/ui/src/pages/AnatomyPage.tsx` | Top-level Anatomy mode — thin wrapper around `AnatomyCanvas` |
| `client/ui/src/services/engineCommands.ts` | Engine-command parser + executor — strips `engine-command` fenced blocks from LLM text, routes to BlockDrawer or auto-executes |
| `client/ui/src/components/floor/StreamStatusList.tsx` | Workbench data-streams list (name + last update + per-row power toggle for `active`). Row-body click sets stream focus; power icon flips the stream's `active` flag via `PATCH /api/streams/{name}/active`. |
| `client/ui/src/services/streamTimeseriesApi.ts` | HTTP client for `GET /api/streams/{name}/timeseries`. Sourced from in-memory snapshot rows. |
| `client/ui/src/components/studio/StreamLibrary.tsx` | Anatomy — stream CRUD |
| `client/ui/src/components/studio/StreamCanvas.tsx` | Anatomy — 7-section stream config |
| `client/ui/src/services/api.ts` | `apiFetch` JSON wrapper + `streamFetchSSE` SSE helper — canonical HTTP/SSE path for every other service module |
| `client/ui/src/services/llmApi.ts` | `streamChat()` — thin wrapper around `streamFetchSSE` for `POST /api/investigate` |
| `client/ui/src/services/streamApi.ts` | HTTP client for stream CRUD, snapshot ingestion, market-pricing, bankroll endpoints |
| `client/ui/src/services/pipelineApi.ts` | HTTP client for pipeline dimensions + time series endpoints |
| `client/ui/src/services/blockApi.ts` | HTTP client for block table endpoints (GET/POST /api/blocks) |
| `client/ui/src/services/marketValueApi.ts` | HTTP client for `/api/market-values` CRUD (aggregate total vol per symbol/expiry) |
| `client/ui/UI_SPEC.md` | UI design specification |
| `server/api/config.py` | OpenRouter env config (API key, model fallback lists, generation params, snapshot buffer settings) |
| `server/api/models.py` | **Canonical Pydantic request/response models for all API boundary data.** Read before any feature crossing the API boundary. |
| `server/api/main.py` | FastAPI app factory — lifespan, CORS, error handler, router registration, health + WS mounts |
| `server/api/routers/*.py` | Route modules (llm, streams, snapshots, bankroll, transforms, pipeline, blocks, market_values) extracted from main.py |
| `server/api/stream_registry.py` | In-memory stream registry — CRUD, snapshot storage, validation, `StreamConfig` builder |
| `server/api/market_value_store.py` | Aggregate-market-value singleton — `{(symbol, expiry): total_vol}` + dirty flag for coalesced ticker reruns |
| `server/api/ws.py` | WebSocket endpoint — singleton ticker broadcasts pipeline ticks; `restart_ticker()` on re-run. Each broadcast is validated through `ServerPayload`. |
| `server/api/ws_serializers.py` | Pipeline DataFrame → JSON-safe dict serialization helpers (extracted from `ws.py`) |
| `server/api/client_ws.py` | Client-facing WS endpoint (`/ws/client`) — auth-gated, inbound snapshot frames with ACK, joins broadcast for outbound positions |
| `server/api/client_ws_auth.py` | Client WS auth — API key validation + IP whitelist, runs before accept |
| `server/api/engine_state.py` | Engine state singleton — mock init + live `rerun_pipeline()`, mutable bankroll |
| `server/api/llm/client.py` | Async OpenRouter HTTP client (complete + stream + fallback wrappers) |
| `server/api/llm/service.py` | LLM orchestration — investigation chat |
| `server/api/llm/snapshot_buffer.py` | Pipeline snapshot ring buffer — stores time-series history, builds condensed delta tables for LLM context |
| `server/api/llm/context_db.py` | Stream context database — metadata about each data stream (MOCK-initialized) |
| `server/api/llm/prompts/__init__.py` | `build_system_prompt(mode, ...)` dispatcher — routes to mode-specific builders |
| `server/api/llm/prompts/core.py` | Shared core: role, framework, language rules, hard constraints, response discipline |
| `server/api/llm/prompts/investigation.py` | Investigation mode: reasoning protocol, data sections, engine commands |
| `server/api/llm/prompts/general.py` | General mode: catch-all conversational, minimal engine summary |
| `server/api/llm/prompts/build.py` | Build mode: stream onboarding + opinion → `create_stream` / `create_manual_block` engine commands |
| `server/api/llm/test_investigation.py` | **CLI harness, not prod code** — interactive test for Zone E investigation LLM with mock pipeline data |
| `server/core/__init__.py` | Core pipeline package — re-exports public API |
| `server/core/config.py` | `BlockConfig`, `StreamConfig` dataclasses, `SECONDS_PER_YEAR` |
| `server/core/helpers.py` | `annualize`, `deannualize` |
| `server/core/transforms/` | Pipeline transform package — one module per step (`registry`, `unit_conversion`, `decay`, `fair_value`, `variance`, `risk_space_aggregation`, `market_value_inference`, `aggregation`, `calc_to_target`, `smoothing`, `position_sizing`). Public API re-exported from `__init__.py`. |
| `server/core/pipeline.py` | All pipeline step functions + `run_pipeline()` orchestrator |
| `server/core/mock_scenario.py` | Mock stream configs, scenario params, market pricing |
| `server/core/serializers.py` | DataFrame→dict bridge for LLM prompt injection |
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

- **Server API boundary:** all request/response shapes defined in `server/api/models.py` (Pydantic). Validation runs automatically at request time.
- **Client API boundary:** all inbound/outbound shapes defined in `client/ui/src/types.ts` (TS interfaces). These must match the Pydantic models — when changing one, check the other.
