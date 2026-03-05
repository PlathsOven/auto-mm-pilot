# Auto-MM-Pilot

Advisory trading terminal for crypto options market-making desks. Clients push their trading data in, the system crunches it through our proprietary math, and streams back "here's what your position should be" to a desktop dashboard.

---

## Codebase Overview

```
auto-mm-pilot/
├── client/                  ← Everything that runs on the client's machine
│   ├── adapter/             ← Data translators: take raw client data (from their
│   │                          databases) and clean it into a standard format
│   └── ui/                  ← The desktop app the trader actually sees (Electron + React)
│       ├── electron/        ← Electron main process + preload
│       ├── src/
│       │   ├── components/  ← React panel components (Sidebar, ContextBar, Grid, Feed, Chat, Wrap, PanelWindow)
│       │   ├── providers/   ← WebSocket state, mock data, chat state, layout/panel state
│       │   ├── utils.ts     ← Shared utility functions (colors, formatting)
│       │   ├── types.ts     ← Shared TypeScript interfaces for WS payloads
│       │   ├── App.tsx      ← Root layout — modular dashboard (react-grid-layout)
│       │   └── main.tsx     ← React entry point
│       └── UI_SPEC.md       ← UI design specification
│
├── server/                  ← Everything that runs on OUR cloud server
│   ├── api/                 ← The "post office": receives data from the client,
│   │   │                      hands it to the Brain, sends results back
│   │   ├── config.py        ← OpenRouter env config (API key, model IDs)
│   │   ├── llm/             ← LLM integration layer (OpenRouter)
│   │   │   ├── client.py    ← Async HTTP client (complete + stream)
│   │   │   ├── service.py   ← Orchestration: investigation chat & justification
│   │   │   ├── context_db.py ← Stream context metadata database
│   │   │   └── prompts/     ← System prompt definitions
│   │   │       ├── investigation.py  ← Zone E: read state + issue engine commands
│   │   │       └── justification.py  ← Zone D: update card narration
│   │   ├── requirements.txt ← Python dependencies for server/api
│   │   └── .env.example     ← Template for API keys
│   └── core/                ← THE BRAIN: our secret math (you write this manually)
│
├── .windsurfrules           ← Rules that AI agents follow automatically
├── AGENTS.md                ← Technical architecture reference for AI agents
├── README.md                ← This file — your guide as the human developer
├── .gitignore               ← Tells git which files to ignore
├── .cascade/commands/       ← Helper scripts for the AI workflow
│   └── commit-push-pr.sh   ← Saves work safely (only the specific files changed)
└── .windsurf/workflows/     ← Step-by-step playbooks for AI agents
    ├── implement.md         ← How to build a new feature
    ├── review.md            ← How to audit code quality
    ├── debug.md             ← How to find and fix bugs
    └── cleanup.md           ← How to tidy up the codebase
```

### Where to look if you want to change something

| I want to... | Look in |
|--------------|---------|
| Change what the trader sees on screen | `client/ui/` |
| Change how client data gets cleaned/translated | `client/adapter/` |
| Change how data moves between client and server | `server/api/` |
| Change the proprietary trading math | `server/core/` (this is yours — AI won't touch it) |
| Change how AI agents behave | `.windsurfrules` |
| Change the build process or workflows | `.windsurf/workflows/` |
| Update project architecture docs | `AGENTS.md` + this file |

---

## Build Workflow

This project uses a multi-agent LLM pipeline (Cascade tabs in Windsurf) with **compounding knowledge** (`.windsurfrules`) and **surgical commits**.

### Multi-Tab Strategy

Open multiple Cascade tabs — each is an independent agent on a separate lane.

| Tab | Lane | Example Prompt |
|-----|------|----------------|
| 1 | `client/adapter/` | "Build the local data standardization scripts. You are restricted to `client/adapter/`." |
| 2 | `server/api/` | "Implement the FastAPI WebSocket transport layer. You are restricted to `server/api/`." |
| 3 | `client/ui/` | "Build the Electron/React dashboard UI. You are restricted to `client/ui/`." |
| 🚫 | `server/core/` | **HUMAN ONLY.** |

### The Loop

```text
Assign task with lane restriction
        │
        ▼
Agent auto-plans (no code yet)
        │
        ▼
You review & approve
        │
        ▼
Agent executes → self-reviews → verifies
        │
        ▼
Surgical commit
```

### Surgical Commit

```bash
.cascade/commands/commit-push-pr.sh "feat: add adapter" client/adapter/ingest.py client/adapter/schema.py
```

### Workflows

| Command | When to use |
|---------|-------------|
| `/implement` | Start any feature task (the core loop) |
| `/review` | Audit another agent's work or deeper review before merge |
| `/debug` | Structured bug isolation (transport/UI only, never core) |
| `/cleanup` | Periodic sweep for dead code, unused imports, entropy |

## Key Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Project architecture & agent context (auto-loaded every session) |
| `.windsurfrules` | Agent behavior directives (auto-plan, lanes, surgical commits, continuous learning) |
| `.cascade/commands/commit-push-pr.sh` | Surgical commit-push script |

## Rules of Engagement

1. **Never** `git add .` or `git commit -a`
2. **Never** modify files outside your assigned lane
3. **Never** touch `server/core/` — leave `# HUMAN WRITES LOGIC HERE` stubs
4. **Always** wait for plan approval before writing code
5. **Always** update `.windsurfrules` when a convention is corrected
6. If a file changes unexpectedly, **stop** and ask for conflict resolution