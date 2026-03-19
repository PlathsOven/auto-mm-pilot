# Auto-MM-Pilot — Agent Context (Auto-Loaded)

## Project
Advisory trading terminal for crypto options market-making desks. "Pilot" = navigational engine, not a trial. Vendor product: client gets the terminal + adapters, we retain the math IP.

## Tech Stack
- **Local Client:** Electron, React 19, Vite, TailwindCSS, TypeScript, WebSockets, react-grid-layout
- **Remote Server:** Python, FastAPI, WebSockets
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
| `pitch/` | LLM | Next.js presentation deck (architecture slides) |
| `pitch/terminal/` | LLM | Demo terminal embedded in pitch (fork of `client/ui/src/`) |

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
| `client/ui/src/providers/WebSocketProvider.tsx` | Central WS state manager with mock fallback |
| `client/ui/src/providers/MockDataProvider.ts` | Mock data generator (positions, users, cell notes, daily wrap) |
| `client/ui/src/providers/ChatProvider.tsx` | Team chat + @APT LLM routing context |
| `client/ui/src/components/DailyWrap.tsx` | Zone F — automated daily trading wrap summary |
| `client/ui/src/components/LlmChat.tsx` | Team Chat panel — messages, note threads, investigation context |
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
| `server/api/main.py` | FastAPI app — `/api/investigate` (SSE stream) + `/api/justify` (JSON) + `/api/health` |
| `server/api/engine_state.py` | Mock engine state singleton (pipeline snapshot, snapshot buffer) — replace with real `server/core/` output |
| `client/ui/src/services/llmApi.ts` | HTTP client for LLM server endpoints (SSE streaming + JSON fetch) |
| `STACK_STATUS.md` | Component registry — tracks PROD/MOCK/STUB/OFF status and connection map |

## Known Divergence: `pitch/terminal/` ↔ `client/ui/src/`
`pitch/terminal/` is a fork of `client/ui/src/` adapted for Next.js SSR (adds `"use client"` directives, mock-only WebSocket provider). The two copies share identical types, utils, mock data, and near-identical components/providers. **Bug fixes or feature changes in either copy must be manually propagated to the other.** A shared package may be warranted if divergence becomes costly.
