# Auto-MM-Pilot — Stack Component Registry

> **Purpose:** Single source of truth for which components are production-ready,
> which are mocked, and how they connect. Update this file whenever a component
> changes status.

## Status Key

| Badge | Meaning |
|-------|---------|
| `PROD` | Production code, fully operational |
| `MOCK` | Running on hardcoded / simulated data |
| `STUB` | Empty function body — human writes logic |
| `OFF` | Not yet built or not running |

---

## Server (`server/`)

| Component | File(s) | Status | Depends On | Notes |
|-----------|---------|--------|------------|-------|
| **FastAPI App** | `server/api/main.py` | `PROD` | Engine State Provider, LLM Service, WS Ticker | CORS enabled, SSE streaming, WS |
| **WS Ticker** | `server/api/ws.py` | `PROD` | Engine State Provider | Singleton background ticker broadcasts pipeline ticks to WS clients |
| **Client WS Endpoint** | `server/api/client_ws.py` | `PROD` | WS Ticker, Stream Registry, Client WS Auth | Auth-gated `/ws/client` — inbound snapshots with ACK, outbound positions via broadcast |
| **Client WS Auth** | `server/api/client_ws_auth.py` | `PROD` | `CLIENT_WS_API_KEY`, `CLIENT_WS_ALLOWED_IPS` env vars | API key + IP whitelist gate |
| **OpenRouter Client** | `server/api/llm/client.py` | `PROD` | `OPENROUTER_API_KEY` env var | Async httpx, fallback model chain |
| **LLM Service** | `server/api/llm/service.py` | `PROD` | OpenRouter Client, Prompts, Engine State | Investigation (stream) |
| **Investigation Prompt** | `server/api/llm/prompts/investigation.py` | `PROD` | — | System prompt for Zone E |
| **Shared Preamble** | `server/api/llm/prompts/preamble.py` | `PROD` | — | IP protection, language rules |
| **Snapshot Buffer** | `server/api/llm/snapshot_buffer.py` | `PROD` | — | Ring buffer + delta table builder |
| **Stream Context DB** | `server/api/llm/context_db.py` | `MOCK` | — | Hardcoded stream metadata; will be client-contributed via API |
| **Engine State Provider** | `server/api/engine_state.py` | `PROD` | Core Pipeline | Runs `server/core` pipeline, serializes snapshots for LLM layer |
| **Config** | `server/api/config.py` | `PROD` | `.env` | Model lists, generation params, buffer config |
| **Core Pipeline** | `server/core/` | `PROD` | Polars | Steps 4–6: config, helpers, pipeline, serializers. Running on mock scenario data. |

## Client (`client/ui/`)

| Component | File(s) | Status | Depends On | Notes |
|-----------|---------|--------|------------|-------|
| **Electron Shell** | `client/ui/electron/` | `PROD` | — | Vite + Electron |
| **React App** | `client/ui/src/App.tsx` | `PROD` | All providers | react-grid-layout dashboard |
| **Layout Provider** | `client/ui/src/providers/LayoutProvider.tsx` | `PROD` | — | Panel state, localStorage persistence |
| **WebSocket Provider** | `client/ui/src/providers/WebSocketProvider.tsx` | `PROD` | Server WS `/ws` endpoint | Connects to real pipeline WS, auto-reconnects |
| **Mock Data Generator** | `client/ui/src/providers/MockDataProvider.ts` | `MOCK` | — | Users, cell notes, daily wrap (position generation removed) |
| **Chat Provider** | `client/ui/src/providers/ChatProvider.tsx` | `PROD` | LLM API Client | Routes @APT to server `/api/investigate` (SSE stream) |
| **LLM API Client** | `client/ui/src/services/llmApi.ts` | `PROD` | FastAPI App | HTTP client for `/api/investigate` |
| **Desired Position Grid** | `client/ui/src/components/DesiredPositionGrid.tsx` | `PROD` | WebSocket Provider, Chat Provider | Zone C — clickable cells push context |
| **Updates Feed** | `client/ui/src/components/UpdatesFeed.tsx` | `PROD` | WebSocket Provider | Zone D — position-change cards with stream attribution |
| **Team Chat (LLM Chat)** | `client/ui/src/components/LlmChat.tsx` | `PROD` | Chat Provider | Zone E — streaming assistant messages |
| **Daily Wrap** | `client/ui/src/components/DailyWrap.tsx` | `MOCK` | — | Static mock data; **needs LLM-generated wrap** |
| **Stream Status List** | `client/ui/src/components/floor/StreamStatusList.tsx` | `PROD` | WebSocket Provider, stream API | Floor read-only stream registry/health (replaces IngestionSidebar) |
| **Stream Library / Canvas** | `client/ui/src/components/studio/StreamLibrary.tsx`, `StreamCanvas.tsx` | `PROD` | stream API, TransformsProvider, LLM API | Studio CRUD + activate flow with 7 sections + LLM co-pilot |
| **Global Context Bar** | `client/ui/src/components/GlobalContextBar.tsx` | `PROD` | WebSocket Provider | Zone B |

## Data Adapters (`client/adapter/`)

| Component | File(s) | Status | Depends On | Notes |
|-----------|---------|--------|------------|-------|
| **Universal Adapter** | `client/adapter/` | `OFF` | Exchange APIs | Not yet built |

---

## Connection Map

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT (Electron)                                          │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ DesiredPos   │    │ UpdatesFeed  │    │ LlmChat      │   │
│  │ Grid (C)     │    │ (D)          │    │ (E)          │   │
│  └──────┬───────┘    └──────────────┘    └──────┬───────┘   │
│         │ click ctx                             │ @APT msg  │
│         ▼                                       ▼           │
│  ┌──────────────┐                        ┌──────────────┐   │
│  │ ChatProvider │                        │ ChatProvider │   │
│  │ (investigate)│                        │ (investigate)│   │
│  └──────┬───────┘                        └──────┬───────┘   │
│         │                                       │           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           WebSocketProvider (ws://server/ws)         │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │                               │
│ ════════════════════════════╪═══════════════════════WS+HTTP │
└─────────────────────────────┼───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVER (FastAPI)                                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ WS /ws (pipeline)   │   POST /api/investigate (SSE)  │   │
│  └──────────────┬──────────────────┬───────────────────-┘   │
│                 │                  │                        │
│  ┌──────────────┴─────────────────────────────────────┐     │
│  │ WS /ws/client (auth-gated, bidirectional)          │     │
│  │   ← inbound snapshots (ACK each)                   │     │
│  │   → outbound positions (broadcast ticker)          │     │
│  └──────────────┬─────────────────────────────────────┘     │
│                 ▼                  ▼                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              LlmService                              │   │
│  │           investigate_stream()                       │   │
│  └──────────┬───────────────────────────────────────────┘   │
│             │                                                │
│     ┌───────▼────────┐     ┌────────────────────┐           │
│     │ Engine State   │     │ OpenRouter Client  │           │
│     │ Provider       │     │ (httpx → OpenRouter)│          │
│     │ ✓ PROD         │     │ ✓ PROD             │           │
│     └───────┬────────┘     └────────────────────┘           │
│             │ (runs pipeline with mock scenario data)       │
│     ┌───────▼────────┐                                      │
│     │ server/core/   │                                      │
│     │ ✓ PROD         │                                      │
│     └────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

## Mock → Production Upgrade Path

| # | What | Current | To Become | Blocked By |
|---|------|---------|-----------|------------|
| 1 | **Engine State Provider** | ~~Mock snapshot~~ → Reads from `server/core/` pipeline | Swap mock scenario for live data feeds | Data Adapters built |
| 2 | **Stream Context DB** | Hardcoded 5 streams | Client-contributed via API | Adapter + API endpoint |
| 3 | ~~**WebSocket Provider**~~ | ~~Mock data generator~~ | ~~Connects to real `ws://server:8000/ws`~~ | ✅ Done — singleton ticker in `ws.py` |
| 4 | **Daily Wrap** | Static mock data | LLM-generated from engine state snapshot | Engine State Provider goes PROD |
| 5 | **Ingestion Sidebar** | Mock stream list | Real adapter status | Universal Adapter built |
| 6 | **Data Adapters** | Not built | Exchange-specific adapters | Adapter framework designed |
