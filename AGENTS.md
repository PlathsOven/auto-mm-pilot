# Auto-MM-Pilot — Agent Context (Auto-Loaded)

## Project
Advisory trading terminal for crypto options market-making desks. "Pilot" = navigational engine, not a trial. Vendor product: client gets the terminal + adapters, we retain the math IP.

## Tech Stack
- **Local Client:** Electron, React, WebSockets
- **Remote Server:** Python, FastAPI, WebSockets

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
| `server/core/` | **HUMAN ONLY** | Proprietary math (the "Brain") |

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
