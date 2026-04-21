# Posit — Stack Component Registry

> **Purpose:** Single source of truth for which components are production-ready,
> which are mocked, and how they connect. Update this file whenever a component
> changes status.
>
> **Updated by `/doc-sync`** (see `.claude/commands/doc-sync.md` step 4).
> **Rate of change:** frequent — every status transition. Contrast with
> `docs/architecture.md`, which changes slowly (structural map only).

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
| **OpenRouter Client** | `server/api/llm/client.py` | `PROD` | `OPENROUTER_API_KEY` env var | Async httpx, fallback model chain, `<think>` tag stripping |
| **LLM Service** | `server/api/llm/service.py` | `PROD` | OpenRouter Client, Prompts, Engine State | Investigation (stream) |
| **Investigation Prompt** | `server/api/llm/prompts/investigation.py` | `PROD` | Core | Investigation mode: reasoning protocol, data sections, engine commands |
| **Build Prompt** | `server/api/llm/prompts/build.py` | `PROD` | Core | Build mode: stream onboarding + opinion → manual block via engine-command |
| **General Prompt** | `server/api/llm/prompts/general.py` | `PROD` | Core | General mode: catch-all conversational, minimal engine summary |
| **Shared Core** | `server/api/llm/prompts/core.py` | `PROD` | — | Role, framework, language rules, hard constraints, response discipline |
| **Snapshot Buffer** | `server/api/llm/snapshot_buffer.py` | `PROD` | — | Ring buffer + delta table builder |
| **Stream Context DB** | `server/api/llm/context_db.py` | `MOCK` | — | Hardcoded stream metadata; will be client-contributed via API |
| **Engine State Provider** | `server/api/engine_state.py` | `PROD` | Core Pipeline | Runs `server/core` pipeline, serializes snapshots for LLM layer |
| **Config** | `server/api/config.py` | `PROD` | `.env` | Model lists, generation params, buffer config |
| **Core Pipeline** | `server/core/` (`config.py`, `helpers.py`, `transforms/`, `pipeline.py`, `serializers.py`, `mock_scenario.py`) | `PROD` | Polars | Steps 4–6: config, helpers, per-step transform modules in `transforms/`, orchestration pipeline, serializers. Running on mock scenario data. |

## SDK (`sdk/`)

| Component | File(s) | Status | Depends On | Notes |
|-----------|---------|--------|------------|-------|
| **Posit SDK** | `sdk/posit_sdk/` (`client.py`, `rest.py`, `ws.py`, `models.py`, `exceptions.py`) | `PROD` | async httpx, websockets, Pydantic v2 | `posit-sdk` v0.1.0 — async HTTP + WebSocket client external integrators use to push snapshots and receive positions. Standalone PyPI distribution (own `pyproject.toml`); not imported by `server/` or `client/`. See `docs/sdk-quickstart.md`. |

## Client (`client/ui/`)

| Component | File(s) | Status | Depends On | Notes |
|-----------|---------|--------|------------|-------|
| **Electron Shell** | `client/ui/electron/` | `PROD` | — | Vite + Electron |
| **React App** | `client/ui/src/App.tsx` | `PROD` | All providers, AppShell | Auth gate + route table; renders inside `<AppShell/>` chrome |
| **AppShell Chrome** | `client/ui/src/components/shell/AppShell.tsx` (+ `LeftNav.tsx`, `StatusBar.tsx`, `TopBar.tsx`) | `PROD` | AuthProvider, WebSocketProvider | Three-region chrome (LeftNav + main slot + StatusBar) — replaces deleted `GlobalContextBar` |
| **Workbench Page** | `client/ui/src/pages/WorkbenchPage.tsx` (+ `components/workbench/`) | `PROD` | FocusProvider, WebSocketProvider | Focus-driven main page — InspectorRouter, ChatDock, PipelineChartPanel, UpdatesTicker, HotkeyCheatsheet |
| **Anatomy Page** | `client/ui/src/pages/AnatomyPage.tsx` | `PROD` | TransformsProvider, stream API | Stream library + canvas — replaces old Studio Anatomy view |
| **Focus Provider** | `client/ui/src/providers/FocusProvider.tsx` | `PROD` | — | Typed `Focus` union (cell / symbol / expiry / stream / block); replaces deleted `SelectionProvider` |
| **WebSocket Provider** | `client/ui/src/providers/WebSocketProvider.tsx` | `PROD` | Server WS `/ws` endpoint | Connects to real pipeline WS, auto-reconnects |
| **Auth Provider** | `client/ui/src/providers/AuthProvider.tsx` | `PROD` | Server `/api/auth/*` | Multi-user auth (added in #32); JWT + per-user state scoping |
| **Mode Provider** | `client/ui/src/providers/ModeProvider.tsx` | `PROD` | — | Chat mode (investigate / build / general) |
| **Command Palette** | `client/ui/src/providers/CommandPaletteProvider.tsx` | `PROD` | FocusProvider | Cmd-K jump-to surfaces |
| **Notifications** | `client/ui/src/providers/NotificationsProvider.tsx` (+ `components/notifications/`) | `PROD` | Server push endpoint | Toasts + persisted notification feed |
| **Onboarding Provider** | `client/ui/src/providers/OnboardingProvider.tsx` | `PROD` | — | First-run guidance |
| **Chat Provider** | `client/ui/src/providers/ChatProvider.tsx` | `PROD` | LLM API Client, ModeProvider | Routes user messages to server `/api/investigate` (SSE) — mode-aware system prompt selected via ModeProvider |
| **Transforms Provider** | `client/ui/src/providers/TransformsProvider.tsx` | `PROD` | transforms API | Stream-config draft state for Anatomy editor |
| **LLM API Client** | `client/ui/src/services/llmApi.ts` | `PROD` | FastAPI App | SSE client for `/api/investigate` |
| **Desired Position Grid** | `client/ui/src/components/DesiredPositionGrid.tsx` | `PROD` | WebSocketProvider, FocusProvider | Clickable cells set focus instead of opening chat |
| **Pipeline Chart** | `client/ui/src/components/PipelineChart.tsx` (+ `components/PipelineChart/`) | `PROD` | WebSocketProvider, pipeline-timeseries endpoint | ECharts time-series for Position / Fair / Variance views |
| **Team Chat (LLM Chat)** | `client/ui/src/components/LlmChat.tsx` | `PROD` | ChatProvider | Streaming assistant + system messages |
| **Block Drawer** | `client/ui/src/components/studio/brain/BlockDrawer.tsx` | `PROD` | Block API | Unified create/edit/inspect drawer |
| **Engine Commands** | `client/ui/src/services/engineCommands.ts` | `PROD` | Stream API, Block API | Parses + executes engine-command fenced blocks from LLM responses |
| **Stream Status List** | `client/ui/src/components/floor/StreamStatusList.tsx` | `PROD` | WebSocketProvider | Read-only stream list (name + last update) |
| **Stream Library / Canvas** | `client/ui/src/components/studio/StreamLibrary.tsx`, `StreamCanvas.tsx` | `PROD` | stream API, TransformsProvider | Anatomy CRUD + activate flow with 7 sections |
| ~~Mock Data Generator~~ | ~~`client/ui/src/providers/MockDataProvider.ts`~~ | — | — | Deleted — remaining mock seeds inlined where needed |
| ~~Daily Wrap~~ | ~~`client/ui/src/components/DailyWrap.tsx`~~ | — | — | Deleted — will be rebuilt when LLM-generated wrap is ready |
| ~~Layout Provider~~ | ~~`client/ui/src/providers/LayoutProvider.tsx`~~ | — | — | Deleted in #34 (Phase 2) — focus-driven Workbench replaced react-grid-layout |
| ~~Global Context Bar~~ | ~~`client/ui/src/components/GlobalContextBar.tsx`~~ | — | — | Deleted in #34 — replaced by `AppShell` (LeftNav + StatusBar) |
| ~~Updates Feed~~ | ~~`client/ui/src/components/UpdatesFeed.tsx`~~ | — | — | Deleted — replaced by `components/workbench/UpdatesTicker.tsx` |

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
│  │ DesiredPos   │    │ UpdatesTicker│    │ LlmChat      │   │
│  │ Grid         │    │ (workbench)  │    │ (ChatDock)   │   │
│  └──────┬───────┘    └──────────────┘    └──────┬───────┘   │
│         │ set focus                             │ user msg  │
│         ▼                                       ▼           │
│  ┌──────────────┐                        ┌──────────────┐   │
│  │ FocusProvider│                        │ ChatProvider │   │
│  │ (cell/sym/…) │                        │ (mode-aware) │   │
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
