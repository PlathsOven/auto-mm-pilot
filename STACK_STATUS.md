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
| **FastAPI App** | `server/api/main.py` | `PROD` | Engine State Provider, LLM Service | CORS enabled, SSE streaming |
| **OpenRouter Client** | `server/api/llm/client.py` | `PROD` | `OPENROUTER_API_KEY` env var | Async httpx, fallback model chain |
| **LLM Service** | `server/api/llm/service.py` | `PROD` | OpenRouter Client, Prompts, Engine State | Investigation (stream) + Justification |
| **Investigation Prompt** | `server/api/llm/prompts/investigation.py` | `PROD` | — | System prompt for Zone E |
| **Justification Prompt** | `server/api/llm/prompts/justification.py` | `PROD` | — | System prompt for Zone D |
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
| **WebSocket Provider** | `client/ui/src/providers/WebSocketProvider.tsx` | `MOCK` | Server WS endpoint (not yet built) | Falls back to mock data generator; **needs real WS server** |
| **Mock Data Generator** | `client/ui/src/providers/MockDataProvider.ts` | `MOCK` | — | Positions, updates, users, notes, daily wrap |
| **Chat Provider** | `client/ui/src/providers/ChatProvider.tsx` | `PROD` | LLM API Client | Routes @APT to server `/api/investigate` (SSE stream) |
| **LLM API Client** | `client/ui/src/services/llmApi.ts` | `PROD` | FastAPI App | HTTP client for `/api/investigate` + `/api/justify` |
| **Desired Position Grid** | `client/ui/src/components/DesiredPositionGrid.tsx` | `PROD` | WebSocket Provider, Chat Provider | Zone C — clickable cells push context |
| **Updates Feed** | `client/ui/src/components/UpdatesFeed.tsx` | `PROD` | WebSocket Provider, LLM API Client | Zone D — enriches reasons via `/api/justify` |
| **Team Chat (LLM Chat)** | `client/ui/src/components/LlmChat.tsx` | `PROD` | Chat Provider | Zone E — streaming assistant messages |
| **Daily Wrap** | `client/ui/src/components/DailyWrap.tsx` | `MOCK` | — | Static mock data; **needs LLM-generated wrap** |
| **Ingestion Sidebar** | `client/ui/src/components/IngestionSidebar.tsx` | `MOCK` | WebSocket Provider | Zone A — mock stream list |
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
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘   │
│         │ click ctx         │ justify req       │ @APT msg  │
│         ▼                   ▼                   ▼           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ ChatProvider │    │ llmApi.ts    │    │ ChatProvider  │   │
│  │ (investigate)│    │ (justify)    │    │ (investigate) │   │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘   │
│         │                   │                   │           │
│ ════════╪═══════════════════╪═══════════════════╪══════ HTTP│
└─────────┼───────────────────┼───────────────────┼───────────┘
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVER (FastAPI)                                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ POST /api/investigate (SSE)  │ POST /api/justify     │   │
│  └──────────────┬───────────────┴──────────┬────────────┘   │
│                 ▼                          ▼                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              LlmService                              │   │
│  │   investigate_stream()      justify()                │   │
│  └──────────┬──────────────────────────┬────────────────┘   │
│             │                          │                    │
│     ┌───────▼────────┐     ┌──────────▼─────────┐          │
│     │ Engine State   │     │ OpenRouter Client   │          │
│     │ Provider       │     │ (httpx → OpenRouter)│          │
│     │ ✓ PROD         │     │ ✓ PROD              │          │
│     └───────┬────────┘     └────────────────────┘          │
│             │ (runs pipeline with mock scenario data)       │
│     ┌───────▼────────┐                                     │
│     │ server/core/   │                                     │
│     │ ✓ PROD         │                                     │
│     └────────────────┘                                     │
└─────────────────────────────────────────────────────────────┘
```

## Mock → Production Upgrade Path

| # | What | Current | To Become | Blocked By |
|---|------|---------|-----------|------------|
| 1 | **Engine State Provider** | ~~Mock snapshot~~ → Reads from `server/core/` pipeline | Swap mock scenario for live data feeds | Data Adapters built |
| 2 | **Stream Context DB** | Hardcoded 5 streams | Client-contributed via API | Adapter + API endpoint |
| 3 | **WebSocket Provider** | Mock data generator | Connects to real `ws://server:8000/ws` | Server WS broadcast endpoint |
| 4 | **Daily Wrap** | Static mock data | LLM-generated from engine state snapshot | Engine State Provider goes PROD |
| 5 | **Ingestion Sidebar** | Mock stream list | Real adapter status | Universal Adapter built |
| 6 | **Data Adapters** | Not built | Exchange-specific adapters | Adapter framework designed |
