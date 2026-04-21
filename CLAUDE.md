# Posit — Agent Instructions (Auto-Loaded)

## Project
Posit — a positional trading platform for crypto options MM desks. Physically split into a local client (ingestion + display) and a remote server (proprietary math) across a visibility barrier. Vendor product: client gets the terminal, we keep the math IP.

## Harness Sync Rule (IMPORTANT)
Slash commands exist in **two** locations and must stay byte-identical in body (frontmatter may differ):
- `.claude/commands/<name>.md` — Claude Code (primary)
- `.windsurf/workflows/<name>.md` — Windsurf (secondary, still in use)

When editing any command, update **both** files in the same commit. A Stop hook in `.claude/settings.json` warns on drift.

## Build & Test
- Local dev: `./start.sh`
- Client typecheck: `npm --prefix client/ui run typecheck`
- Client build: `npm --prefix client/ui run build`
- Server syntax check: `python -m compileall server/ -q`
- **No lint/format tooling installed** (prettier/ruff/black). Logged in `tasks/todo.md`.

## Architecture (pointer)
Client ingests + displays; server computes. Full system map: `docs/architecture.md`.

## Schemas (read before crossing API boundary)
- **Python (server) shapes:** `server/api/models.py` (Pydantic).
- **TypeScript (client) shapes:** `client/ui/src/types.ts`.
- When the two diverge, Pydantic is upstream — update `types.ts` to match.

## Code Style
- **Polars, never Pandas.** No `iterrows`, no scalar loops over DataFrames.
- **Pydantic at API boundary** (server), TS interfaces at API boundary (client). No raw dicts.
- **Async httpx** for outbound HTTP (OpenRouter). No `requests`.
- **AppShell chrome** (`client/ui/src/components/shell/AppShell.tsx` = LeftNav + main slot + StatusBar) wraps every authenticated page; the focus-driven Workbench replaces the old draggable-panel model. Context providers for cross-component state (no prop drilling >2 levels).
- **Named exports only.** No barrel files, no default exports.
- **No magic numbers** — hoist to a named constant with a comment if non-obvious.

## Workflow
1. **Plan before code.** For any non-trivial task, output a plan and pause for approval before editing files.
2. **Confirm lane** before editing (see `docs/architecture.md` Component Map).
3. **Typecheck after code batches** — `npm --prefix client/ui run typecheck` + `python -m compileall server/ -q`.
4. **Surgical commits** — `git add path1 path2`, never `git add .` or `git add -A`. Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
5. **Never push** unless explicitly asked. Never bypass hooks with `--no-verify`.
6. **After every correction or mistake**, add a lesson to `tasks/lessons.md`.

## Debugging Directive
Fix the root cause, not the symptom. One bug = one fix in one place. If your diff has a primary fix and a secondary fix, the secondary is probably the real one. If 2+ fix attempts have failed, invoke `/logic-audit` before attempting a third.

## Known Gotchas
- `server/api/llm/test_investigation.py` is a CLI harness, not prod code.
- `server/api/llm/context_db.py` is MOCK-initialized (hardcoded stream metadata).
- `server/api/ws.py` has a singleton background ticker — call `restart_ticker()` after hot reloads.
- `POSIT_MODE=mock` runs on scenario data; `POSIT_MODE=prod` expects real streams via the (not-yet-built) adapter.

## Context Pointers
- Architecture: `docs/architecture.md`
- Conventions: `docs/conventions.md`
- Decisions: `docs/decisions.md`
- Product theory: `docs/product.md`
- User flows: `docs/user-journey.md`
- Component status: `docs/stack-status.md`
- Active work: `tasks/todo.md`
- Lessons: `tasks/lessons.md`
- Mid-task handoffs: `tasks/progress.md`
