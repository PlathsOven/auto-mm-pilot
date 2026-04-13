# Conventions

## File Organization

- **Target file size: <300 lines.** Documented convention; enforcement is deferred. `server/core/transforms.py` (726) and several client components exceed this today — they will be addressed in a follow-up `/refactor` session. `server/core/` is exempt from restructuring (HUMAN ONLY).
- **One concept per file.** A panel component, a service client, a provider — each in its own file.
- **Tests colocated** where they exist (e.g. `server/api/llm/test_investigation.py` sits next to `service.py`). Note: `test_investigation.py` is a CLI harness, not an automated test.
- **Barrel files are avoided.** Import from the concrete file, not from an index re-export.
- **Default exports are avoided.** Named exports make refactors and finds safer.

## Schema Source of Truth

- **Python (server-side) data shapes:** `server/api/models.py` (Pydantic). Every endpoint's request and response inherits from these models. **Read `models.py` before modifying any feature that crosses the API boundary.**
- **TypeScript (client-side) data shapes:** `client/ui/src/types.ts`. Every WS payload, every HTTP response shape. **Read `types.ts` before modifying any feature that crosses the API boundary.**
- When the two diverge, Pydantic is the upstream truth — update `types.ts` to match.

## Patterns Used

- **Pydantic validation at the API boundary.** Inbound JSON is parsed into a model before the handler sees it; outbound responses are serialized from models.
- **Async httpx** for outbound HTTP (OpenRouter). Never `requests`.
- **Polars columnar expressions** for all pipeline math. Lazy where possible.
- **react-grid-layout** for the dashboard panel layout. Panels are declared in `LayoutProvider.tsx`.
- **React Context providers** for cross-component state (WebSocket, Layout, Chat). No prop drilling beyond 2 levels.
- **SSE streaming** from the server for LLM responses. Chunks are assembled on the client.
- **Singleton WebSocket ticker** on the server. One source of truth for pipeline state across all clients.
- **TanStack Table** for data-heavy tables (column visibility, multi-column sort, global filter). Used by `EditableBlockTable`.
- **Engine-command protocol.** LLM emits ` ```engine-command` fenced blocks containing `{ action, params }`. The client (`engineCommands.ts`) parses them, strips from the displayed message, and routes: `create_manual_block` → BlockDrawer (interactive review), `create_stream` → auto-execute via REST.
- **`<think>` tag stripping.** Streaming responses pass through `_strip_think_tags()` in `client.py` before reaching the client, so reasoning-model internals never surface in the UI.
- **`.to_dicts()` for DataFrame → dict serialization.** Never `iter_rows(named=True)` loops. Use `.to_dicts()` for bulk conversion and list comprehensions for field renaming.
- **`parse_datetime_tolerant()` from `stream_registry.py`** for all datetime string parsing (ISO 8601 + DDMMMYY). Single source — do not duplicate.
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
- **Surgical staging** — `git add path1 path2`, never `git add .` or `git add -A`.

## Patterns Avoided

- **Pandas.** Use Polars. If you find Pandas, it's a bug.
- **`iterrows()` / `iter_rows()` or any scalar loop over a DataFrame.** Express it as a columnar op or use `.to_dicts()` for dict conversion.
- **Raw dicts crossing the API boundary.** Always through a Pydantic model or a TS interface.
- **Prop drilling beyond 2 levels.** Use a Context provider.
- **Barrel files** (`index.ts` re-exports). Import from the concrete module.
- **Default exports.** Named exports only.
- **Magic numbers.** Hoist to a named constant, or add a comment explaining the value.
- **`# noqa` / `@ts-ignore` without a written reason.** If you must silence a check, say why.

## The Manual Brain Restriction

**`server/core/` is HUMAN ONLY.** LLMs (Claude Code, Windsurf, any agent) are strictly forbidden from writing, modifying, or refactoring files under `server/core/`. This is the load-bearing invariant of the project.

**What LLMs MAY do:**
- Read `server/core/` files to understand behavior.
- Import from `server/core/` in other layers.
- When generating Python that touches pipeline steps 4–6 (target space conversion, fair value, desired position), create empty function bodies with the comment `# HUMAN WRITES LOGIC HERE`.

**What LLMs MUST NOT do:**
- Write anything inside a `server/core/` file.
- "Fix" a bug that traces into `server/core/`. Stop and report findings; the human owns the fix.
- Remove or alter `# HUMAN WRITES LOGIC HERE` stubs during cleanup or refactor.

This is enforced by a PreToolUse hook in `.claude/settings.json` that blocks `Edit`/`Write` to any path under `server/core/`. The hook is a safety net, not the rule — the rule is that you already know not to touch it.

## Commit Message Format

```
<type>: <summary in under 72 chars>

<optional body explaining why, not what — the diff shows what>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`. One logical change per commit. Never bypass hooks with `--no-verify`. Never auto-push unless explicitly asked.

## Build & Test Commands

- **Local dev:** `./start.sh` (runs both server and client)
- **Client typecheck:** `npm --prefix client/ui run typecheck`
- **Client build:** `npm --prefix client/ui run build`
- **Server syntax check:** `python -m compileall server/ -q`

No lint/format tooling is installed (no prettier, eslint, ruff, black). Installing a formatter is a follow-up entry in `tasks/todo.md`.
