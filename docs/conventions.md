# Conventions

## File Organization

- **Target file size: <300 lines.** Documented convention; enforcement is deferred. Several client components exceed this today — they will be addressed in a follow-up `/refactor` session.
- **One concept per file.** A panel component, a service client, a provider — each in its own file.
- **Tests colocated** where they exist.
- **Barrel files are avoided.** Import from the concrete file, not from an index re-export.
- **Default exports are avoided.** Named exports make refactors and finds safer.

## Schema Source of Truth

- **Python (server-side) data shapes:** `server/api/models/` (Pydantic package). Every endpoint's request and response inherits from these models. The package is split into `_shared` (base primitives), `auth` (auth / account / admin / usage), `streams` (streams, connectors, snapshots, blocks, client WS frames, transforms, market values, broadcast + pipeline time-series wire shapes), and `llm` (LLM orchestration — router → intent → synthesis → critique, preview / commit / stored intent triplets, admin latency telemetry). `models/__init__.py` re-exports every public name so `from server.api.models import X` continues to work. **Read the relevant sub-module before modifying any feature that crosses the API boundary.**
- **TypeScript (client-side) data shapes:** `client/ui/src/types.ts`. Every WS payload, every HTTP response shape. **Read `types.ts` before modifying any feature that crosses the API boundary.**
- When the two diverge, Pydantic is the upstream truth — update `types.ts` to match.

## Patterns Used

- **Pydantic validation at the API boundary.** Inbound JSON is parsed into a model before the handler sees it; outbound responses are serialized from models.
- **`_WireModel` base for camelCase-on-wire responses.** `server/api/models.py` defines `_WireModel(BaseModel)` with `alias_generator=to_camel` + `populate_by_name=True`. Pipeline time-series (`PipelineTimeSeriesResponse`, `AggregatedTimeSeries`, `BlockTimeSeries`, etc.) and the WebSocket broadcast payload (`ServerPayload`, `DesiredPosition`, `UpdateCard`, `DataStream`, `GlobalContext`) inherit from it so their fields stay snake_case in Python but emit camelCase JSON. Snake-case-on-wire models (`BlockRowResponse`, `StreamResponse`, `BlockConfigPayload`) stay on plain `BaseModel`.
- **Async httpx** for outbound HTTP (OpenRouter). Never `requests`.
- **Polars columnar expressions** for all pipeline math. Lazy where possible.
- **AppShell chrome.** Every authenticated page renders inside `client/ui/src/components/shell/AppShell.tsx` — `<LeftNav/>` + main slot + `<StatusBar/>`. The focus-driven Workbench (`pages/WorkbenchPage.tsx` + `providers/FocusProvider.tsx`) replaced the old draggable-panel dashboard.
- **React Context providers** for cross-component state (WebSocket, Layout, Chat). No prop drilling beyond 2 levels.
- **SSE streaming** from the server for LLM responses. Chunks are assembled on the client.
- **Singleton WebSocket ticker** on the server. One source of truth for pipeline state across all clients.
- **TanStack Table** for data-heavy tables (column visibility, multi-column sort, global filter). Used by `EditableBlockTable`.
- **Engine-command protocol.** LLM emits ` ```engine-command` fenced blocks containing `{ action, params }`. The client (`engineCommands.ts`) parses them, strips from the displayed message, and routes: `create_manual_block` → BlockDrawer (interactive review), `create_stream` → auto-execute via REST.
- **`<think>` tag stripping.** Streaming responses pass through `_strip_think_tags()` in `client.py` before reaching the client, so reasoning-model internals never surface in the UI.
- **`.to_dicts()` for DataFrame → dict serialization.** Never `iter_rows(named=True)` loops. Use `.to_dicts()` for bulk conversion and list comprehensions for field renaming. `build_blocks_df` uses `select(...)` + `pl.concat` so block-row construction is a pure columnar pass.
- **`apiFetch` + `streamFetchSSE` in `client/ui/src/services/api.ts`.** All other service modules go through these two helpers — `apiFetch` for JSON request/response, `streamFetchSSE` for SSE token streams. Never reach for `fetch` directly from a service.
- **`parse_datetime_tolerant()` from `server/api/datetime_parsing.py`** for all datetime string parsing (ISO 8601 + DDMMMYY). Single source — do not duplicate.
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
- **Surgical staging** — `git add path1 path2`, never `git add .` or `git add -A`.
- **SDK follows every server-side canonical.** `sdk/posit_sdk/` uses Pydantic v2 for wire shapes, async httpx + websockets for IO, `__all__` named exports, full type hints, no Pandas, no `requests`. Treat it as an exemplar reference when you need a clean implementation of these patterns.

## Patterns Avoided

- **Pandas.** Use Polars. If you find Pandas, it's a bug.
- **`iterrows()` / `iter_rows()` or any scalar loop over a DataFrame.** Express it as a columnar op or use `.to_dicts()` for dict conversion.
- **Raw dicts crossing the API boundary.** Always through a Pydantic model or a TS interface.
- **Prop drilling beyond 2 levels.** Use a Context provider.
- **Barrel files** (`index.ts` re-exports). Import from the concrete module.
- **Default exports.** Named exports only.
- **Magic numbers.** Hoist to a named constant, or add a comment explaining the value.
- **`# noqa` / `@ts-ignore` without a written reason.** If you must silence a check, say why.

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
