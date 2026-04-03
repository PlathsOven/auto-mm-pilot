# Auto-MM-Pilot — Agent Context (Auto-Loaded)

## Project
Advisory trading terminal for crypto options market-making desks. "Pilot" = navigational engine, not a trial. Vendor product: client gets the terminal + adapters, we retain the math IP.

## Tech Stack
- **Local Client:** Electron, React 19, Vite, TailwindCSS, TypeScript, WebSockets, react-grid-layout
- **Remote Server:** Python, FastAPI, WebSockets, Polars
- **LLM Provider:** OpenRouter (httpx async client)

## Architecture: Client/Server Visibility Barrier
The system is physically split to protect proprietary IP.

| Environment | Location | Owns |
|-------------|----------|------|
| **Local Client** (`client/`) | User's machine | Data ingestion, format standardization, UI display |
| **Remote Server** (`server/`) | Our cloud | All proprietary calculations, desired position output |

**Rule:** Core trading logic, pricing models, and variance calculations NEVER exist on the client side.

## MVP Pipeline
1. Raw data stream → ingested at local client
2. Data format standardization → cleaned in local client
3. *— TRANSMISSION ACROSS VISIBILITY BARRIER —*
4. Target space unit conversion → Python server
5. Timestamp × fair value → Python server
6. Desired position simulation → Python server
7. *— TRANSMISSION ACROSS VISIBILITY BARRIER —*
8. Desired position → displayed in local client terminal

## Directory Lanes
| Lane | Owner | Purpose |
|------|-------|---------|
| `client/adapter/` | LLM | Data standardization scripts, universal adapter |
| `client/ui/` | LLM | Electron + React dashboard |
| `server/api/` | LLM | FastAPI routing, WebSocket transport |
| `server/api/llm/` | LLM | OpenRouter client, LLM service, system prompts |
| `server/core/` | **HUMAN ONLY** | Proprietary math (the "Brain") |
| `pitch/` | LLM | Next.js presentation deck (architecture slides, links to deployed client for demo) |

## Division of Labor
**LLM builds:** Electron app, React UI, data adapters, FastAPI routing, WebSocket plumbing, error handling, reconnection logic.

**Human builds:** All math in `server/core/` (steps 4–6). LLMs must NEVER write, modify, or refactor core logic.

**Stub rule:** When generating Python files that touch steps 4–6, create function definitions with empty bodies and the comment `# HUMAN WRITES LOGIC HERE`.

## Key Files
| File | Purpose |
|------|---------|
| `.windsurfrules` | Agent behavior directives (auto-plan, lanes, surgical commits, continuous learning) |
| `AGENTS.md` | This file — project architecture & context (auto-loaded) |
| `README.md` | Human workflow guide |
| `.cascade/commands/commit-push-pr.sh` | Surgical commit script |
| `client/ui/src/App.tsx` | Root layout — modular dashboard (react-grid-layout) |
| `client/ui/src/providers/LayoutProvider.tsx` | Panel state manager — open/close/duplicate panels, localStorage persistence |
| `client/ui/src/components/PanelWindow.tsx` | Draggable/resizable panel wrapper with title bar |
| `client/ui/src/types.ts` | Shared TypeScript interfaces for WS payloads |
| `client/ui/src/providers/WebSocketProvider.tsx` | Central WS state manager — connects to server `/ws`, auto-reconnects |
| `client/ui/src/providers/MockDataProvider.ts` | Static seed data (users, cell notes, daily wrap) |
| `client/ui/src/providers/ChatProvider.tsx` | Team chat + @APT LLM routing context |
| `client/ui/src/components/DailyWrap.tsx` | Zone F — automated daily trading wrap summary |
| `client/ui/src/components/LlmChat.tsx` | Team Chat panel — messages, note threads, investigation context |
| `client/ui/src/components/ApiDocs.tsx` | Client-facing API documentation panel — endpoints, WebSocket stream, integration workflow |
| `client/ui/UI_SPEC.md` | UI design specification |
| `server/api/config.py` | OpenRouter env config (API key, model fallback lists, generation params, snapshot buffer settings) |
| `server/api/llm/client.py` | Async OpenRouter HTTP client (complete + stream + fallback wrappers) |
| `server/api/llm/service.py` | LLM orchestration — investigation chat & justification narrator |
| `server/api/llm/snapshot_buffer.py` | Pipeline snapshot ring buffer — stores time-series history, builds condensed delta tables for LLM context |
| `server/api/llm/context_db.py` | Stream context database — metadata about each data stream (mock-initialized) |
| `server/api/llm/prompts/preamble.py` | Shared prompt preamble (IP protection, language rules, epistemology) |
| `server/api/llm/prompts/investigation.py` | System prompt for Zone E (read state + issue engine commands) |
| `server/api/llm/prompts/justification.py` | System prompt for Zone D update card narration |
| `server/api/llm/test_investigation.py` | Interactive CLI for testing Zone E investigation LLM with mock pipeline data |
| `server/api/admin/index.html` | Server-side admin dashboard — configure PENDING streams, market pricing, bankroll |
| `server/api/models.py` | Pydantic request/response models for stream, snapshot, market-pricing, and bankroll endpoints |
| `server/api/stream_registry.py` | In-memory stream registry — CRUD, snapshot storage, validation, `StreamConfig` builder |
| `server/api/ws.py` | WebSocket endpoint — singleton ticker broadcasts pipeline ticks; `restart_ticker()` on re-run |
| `server/api/client_ws.py` | Client-facing WS endpoint (`/ws/client`) — auth-gated, inbound snapshot frames with ACK, joins broadcast for outbound positions |
| `server/api/client_ws_auth.py` | Client WS auth — API key validation + IP whitelist, runs before accept |
| `server/api/main.py` | FastAPI app — WS, LLM, stream CRUD, snapshot ingestion, market-pricing, bankroll endpoints |
| `server/api/engine_state.py` | Engine state singleton — mock init + live `rerun_pipeline()`, mutable bankroll/market pricing |
| `server/core/__init__.py` | Core pipeline package — re-exports public API |
| `server/core/config.py` | `BlockConfig`, `StreamConfig` dataclasses, `SECONDS_PER_YEAR` |
| `server/core/helpers.py` | `annualize`, `deannualize`, `raw_to_target_expr` |
| `server/core/pipeline.py` | All pipeline step functions + `run_pipeline()` orchestrator |
| `server/core/mock_scenario.py` | Mock stream configs, scenario params, market pricing |
| `server/core/serializers.py` | DataFrame→dict bridge for LLM prompt injection |
| `client/ui/src/services/llmApi.ts` | HTTP client for LLM server endpoints (SSE streaming + JSON fetch) |
| `client/ui/src/services/streamApi.ts` | HTTP client for stream CRUD, snapshot ingestion, market-pricing, bankroll endpoints |
| `client/ui/src/components/PipelineChart.tsx` | Pipeline Analysis panel — ECharts time series (desired position, fair value decomposition, variance decomposition) with symbol/expiry selector |
| `client/ui/src/services/pipelineApi.ts` | HTTP client for pipeline dimensions + time series endpoints |
| `prototyping/test_api.ipynb` | API integration test notebook — exercises full prod-mode pipeline via HTTP |
| `STACK_STATUS.md` | Component registry — tracks PROD/MOCK/STUB/OFF status and connection map |
| `DEPLOY.md` | Step-by-step deployment guide (Vercel for client, Railway for server) |
| `Procfile` | Railway start command for FastAPI server |
| `runtime.txt` | Python version pin for Railway |
| `requirements.txt` | Root-level Python deps for Railway (mirrors `server/api/requirements.txt`) |
| `client/ui/vercel.json` | Vercel build/routing config for SPA deployment |

