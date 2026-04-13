# Architecture

## System Overview

Auto-MM-Pilot (APT — Automated Positional Trader) is an advisory trading terminal for crypto options market-making desks. It is physically split into a local client (data ingestion + UI display) and a remote server (proprietary calculations) with a deliberate visibility barrier between them. The server computes `Desired Position = Edge × Bankroll / Variance` over a configurable pipeline of data streams, blocks, and spaces; the client renders the result and lets the trader investigate positions via an LLM layer. "Pilot" refers to the navigational engine, not a trial — this is a vendor product where the client receives the terminal + adapters and we retain the math IP.

## Component Map

| Lane | Owner | Purpose |
|------|-------|---------|
| `client/adapter/` | LLM | Data standardization scripts, universal adapter (not yet built) |
| `client/ui/` | LLM | Electron + React dashboard |
| `server/api/` | LLM | FastAPI routing, WebSocket transport, request/response models |
| `server/api/llm/` | LLM | OpenRouter client, LLM service, system prompts, snapshot buffer |
| `server/core/` | **HUMAN ONLY** | Proprietary math — the "Brain". LLMs must never modify. |
| `pitch/` | LLM | Next.js presentation deck (architecture slides, links to deployed client for demo) |
| `prototyping/` | LLM | Notebooks for manual API exploration |

## Data Flow (MVP Pipeline)

1. Raw data stream → ingested at local client
2. Data format standardization → cleaned in local client
3. *— TRANSMISSION ACROSS VISIBILITY BARRIER —*
4. Target space unit conversion → Python server (HUMAN ONLY)
5. Timestamp × fair value → Python server (HUMAN ONLY)
6. Desired position simulation → Python server (HUMAN ONLY)
7. *— TRANSMISSION ACROSS VISIBILITY BARRIER —*
8. Desired position → displayed in local client terminal

Steps 4–6 are the Manual Brain. When an LLM generates code that touches these steps, the function body must be empty with the comment `# HUMAN WRITES LOGIC HERE`.

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
| `client/ui/src/App.tsx` | Root layout — modular dashboard (react-grid-layout) |
| `client/ui/src/providers/LayoutProvider.tsx` | Panel state manager — open/close/duplicate panels, localStorage persistence |
| `client/ui/src/components/PanelWindow.tsx` | Draggable/resizable panel wrapper with title bar |
| `client/ui/src/types.ts` | **Canonical TypeScript interfaces for all client-side data shapes.** Read before any feature crossing the API boundary. |
| `client/ui/src/providers/WebSocketProvider.tsx` | Central WS state manager — connects to server `/ws`, auto-reconnects |
| `client/ui/src/constants.ts` | Shared UI constants — magic numbers hoisted from components (Phase 4) |
| `client/ui/src/providers/ChatProvider.tsx` | Team chat + @APT LLM routing context |
| `client/ui/src/components/LlmChat.tsx` | Team Chat panel — messages, note threads, investigation context |
| `client/ui/src/components/ApiDocs.tsx` | Client-facing API documentation panel — endpoints, WebSocket stream, integration workflow |
| `client/ui/src/components/DesiredPositionGrid.tsx` | Zone C — clickable cells push context to LlmChat |
| `client/ui/src/components/UpdatesFeed.tsx` | Zone D — position-change cards with stream attribution |
| `client/ui/src/components/PipelineChart.tsx` | Pipeline time-series chart (controlled child) — delegates to `PipelineChart/chartOptions.ts` (ECharts config); paired with `PipelineChart/DecompositionPanel.tsx` in BrainPage |
| `client/ui/src/components/studio/brain/EditableBlockTable.tsx` | Block Inspector — TanStack Table with column visibility, multi-sort, global filter, row click to open detail drawer |
| `client/ui/src/components/studio/brain/BlockDrawer.tsx` | Unified block drawer — create (empty or LLM-prefilled), edit (manual blocks), inspect (stream blocks). Draft state in `blockDrawerState.ts`, sub-components in `BlockDrawerParts.tsx`. |
| `client/ui/src/pages/AnatomyPage.tsx` | Top-level Anatomy mode — thin wrapper around `AnatomyCanvas` |
| `client/ui/src/services/engineCommands.ts` | Engine-command parser + executor — strips `engine-command` fenced blocks from LLM text, routes to BlockDrawer or auto-executes |
| `client/ui/src/components/GlobalContextBar.tsx` | Zone B — global context header |
| `client/ui/src/components/floor/StreamStatusList.tsx` | Eyes read-only stream list (name + last update) |
| `client/ui/src/components/studio/StreamLibrary.tsx` | Anatomy — stream CRUD |
| `client/ui/src/components/studio/StreamCanvas.tsx` | Anatomy — 7-section stream config |
| `client/ui/src/services/llmApi.ts` | HTTP client for LLM server endpoints (SSE streaming + JSON fetch) |
| `client/ui/src/services/streamApi.ts` | HTTP client for stream CRUD, snapshot ingestion, market-pricing, bankroll endpoints |
| `client/ui/src/services/pipelineApi.ts` | HTTP client for pipeline dimensions + time series endpoints |
| `client/ui/src/services/blockApi.ts` | HTTP client for block table endpoints (GET/POST /api/blocks) |
| `client/ui/UI_SPEC.md` | UI design specification |
| `server/api/config.py` | OpenRouter env config (API key, model fallback lists, generation params, snapshot buffer settings) |
| `server/api/models.py` | **Canonical Pydantic request/response models for all API boundary data.** Read before any feature crossing the API boundary. |
| `server/api/main.py` | FastAPI app factory — lifespan, CORS, error handler, router registration, health + WS mounts |
| `server/api/routers/*.py` | Route modules (llm, streams, snapshots, bankroll, transforms, pipeline, blocks) extracted from main.py |
| `server/api/stream_registry.py` | In-memory stream registry — CRUD, snapshot storage, validation, `StreamConfig` builder |
| `server/api/ws.py` | WebSocket endpoint — singleton ticker broadcasts pipeline ticks; `restart_ticker()` on re-run |
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
| `server/api/llm/prompts/configure.py` | Configure mode: stream onboarding guidance, engine-command emit format |
| `server/api/llm/prompts/opinion.py` | Opinion mode: discretionary view → manual block via engine-command |
| `server/api/llm/test_investigation.py` | **CLI harness, not prod code** — interactive test for Zone E investigation LLM with mock pipeline data |
| `server/core/__init__.py` | Core pipeline package — re-exports public API (HUMAN ONLY) |
| `server/core/config.py` | `BlockConfig`, `StreamConfig` dataclasses, `SECONDS_PER_YEAR` (HUMAN ONLY) |
| `server/core/helpers.py` | `annualize`, `deannualize`, `raw_to_target_expr` (HUMAN ONLY) |
| `server/core/transforms.py` | Polars transform expressions for the pipeline (HUMAN ONLY) |
| `server/core/pipeline.py` | All pipeline step functions + `run_pipeline()` orchestrator (HUMAN ONLY) |
| `server/core/mock_scenario.py` | Mock stream configs, scenario params, market pricing (HUMAN ONLY) |
| `server/core/serializers.py` | DataFrame→dict bridge for LLM prompt injection (HUMAN ONLY) |
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

See `docs/decisions.md` for the full reasoning behind each.

## Boundaries & Contracts

- **Server API boundary:** all request/response shapes defined in `server/api/models.py` (Pydantic). Validation runs automatically at request time.
- **Client API boundary:** all inbound/outbound shapes defined in `client/ui/src/types.ts` (TS interfaces). These must match the Pydantic models — when changing one, check the other.
- **Manual Brain boundary (hard invariant):** `server/core/` is HUMAN ONLY. LLMs may:
  - Read files to understand behavior.
  - Import from `server/core/` in other layers.
  - Write empty stub functions with `# HUMAN WRITES LOGIC HERE` when necessary.
  LLMs may NOT write, modify, or refactor files under `server/core/`. When a bug traces there, stop and report findings.
