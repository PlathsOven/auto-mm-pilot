# Spec: Refactor — Pattern Convergence & Root-Cause Cleanup

> **Status:** APPROVED, ready to execute.
> **Authoring session:** 2026-04-09 (Opus 4.6 /kickoff → /spec).
> **Execution session:** a fresh Claude Code run should invoke `/refactor` and
> use this file as its plan of record. No further interview is required — the
> user has already approved every open question inline (see Decisions below).
> **Branch:** stay on `generalisation`. Single PR at the end.

---

## 0. Overview

This refactor eliminates the root causes of the "small issues" that keep
cropping up in the UI by attacking **five specific structural defects** and
then decomposing the two god files that hide them. The work is ordered by
blast radius — Phase 1 is a handful of surgical fixes that should by itself
visibly calm the terminal; Phase 2 hardens the API contract so agents stop
breaking things by typing the wrong field name; Phase 3 decomposes
`server/api/main.py` so future edits stay surgical; Phase 4 does the same for
the client mega-components and hoists magic numbers.

**Non-goal:** feature work. The operator and trader should see identical
behavior before and after (just with fewer glitches and a calmer render
profile).

---

## 1. Decisions Already Made (do NOT re-ask)

1. **All four phases are in scope.** Do not stop after Phase 1 unless a
   phase fails verification.
2. **Naming unification:** `symbol`. The server already owns the name
   (`ws.py:73` currently emits `"asset": row["symbol"]` — delete the rename).
   Every `asset` reference in client code becomes `symbol`.
3. **Wire format:** **camelCase everywhere.** The client's
   `AggregatedTimeSeries` (snake_case today) is the odd one out — the server
   serializer in `_pipeline_timeseries_sync` (`server/api/main.py:611-621`
   and `server/api/main.py:640-649`) must emit camelCase; the client
   interface then mirrors it.
4. **Pydantic → TypeScript codegen:** **deferred.** Keep `types.ts`
   hand-maintained. Add a one-line note in `docs/decisions.md` after Phase 2
   acknowledging the manual mirror.
5. **Branch:** `generalisation`. **One PR** at the very end covering all
   four phases. Commits within the PR are per-phase (see §10).
6. **`server/core/` is HUMAN ONLY.** Do not write, modify, move, or delete
   anything under that directory. Read-only is permitted. The
   `# HUMAN WRITES LOGIC HERE` stub marker is sacred (see `tasks/lessons.md`).

---

## 2. Acceptance Criteria

All of the following must hold before the PR is opened:

- [ ] `npm --prefix client/ui run typecheck` passes clean after **every**
      phase (not just at the end).
- [ ] `python -m compileall server/ -q` passes clean after every phase.
- [ ] `./start.sh` → terminal connects → each panel (Floor, Studio, Brain,
      Docs) renders → pipeline chart populates → block table populates → a
      manual block can still be created → investigation SSE streams → all
      stream CRUD operations still succeed.
- [ ] React DevTools profiler: none of the following re-render on the
      `GlobalContextBar` 47 ms timer tick:
      `DesiredPositionGrid`, `UpdatesFeed`, `AnatomyCanvas`, `PipelineChart`,
      `LlmChat`, `LiveEquationStrip`.
- [ ] `git grep -n '"asset"\|\.asset\b' -- client/ui/src/ server/api/` returns
      no hits in production code. (ApiDocs example JSON is acceptable **only
      if** updated to `symbol` as well — this is a display-only string.)
- [ ] `git grep -n 'VITE_API_URL' -- client/ui/src/` returns zero hits.
- [ ] `git grep -n 'raw_desired_position\|smoothed_desired_position\|total_fair\|total_market_fair\|smoothed_edge\|smoothed_var' -- client/ui/src/` returns zero hits (all these move to camelCase).
- [ ] `server/api/main.py` is < 150 LOC (just app factory, middleware,
      router includes, exception handler, lifespan).
- [ ] `client/ui/src/components/PipelineChart.tsx` is < 300 LOC.
- [ ] `client/ui/src/components/DesiredPositionGrid.tsx` is < 300 LOC.
- [ ] `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx` is < 350 LOC.
- [ ] No `dict[str, Any]` fields remain at the API boundary in
      `server/api/models.py`, except for `TransformStepResponse.params` /
      `TransformConfigRequest.*_params` which remain `dict[str, Any]` by
      necessity (param shapes are discovered dynamically from
      `server/core/transforms.py` — that's the one legitimate escape hatch,
      and it must be commented inline to explain why).
- [ ] A central `@app.exception_handler(Exception)` is installed; the
      investigation SSE error path (`main.py:176-178` today) routes through
      a sanitizer so stack traces cannot reach the trader.
- [ ] All client services import and use `apiFetch` from
      `services/api.ts`; no service has its own `fetch()` call.
- [ ] `WebSocketProvider` and `TransformsProvider` context values are
      memoized with `useMemo` keyed on their actual dependencies.
- [ ] The harness sync rule holds: `.claude/commands/*.md` body ==
      `.windsurf/workflows/*.md` body for every command.
- [ ] `tasks/todo.md` is updated — completed follow-ups from this refactor
      are moved out of the "Follow-ups" section.
- [ ] A single PR on `generalisation` → `main` with a description that
      references this spec file.

---

## 3. Out of Scope

- **Anything under `server/core/`.** HUMAN ONLY. If a bug is traced there,
  stop and report in `tasks/progress.md`; do not patch around it.
- **Pydantic → TS codegen.** Deferred.
- **New tests or a test framework.** The repo has none today; adding one is
  a separate decision.
- **Lint / format tooling** (prettier, ruff, black). Already a logged
  follow-up in `tasks/todo.md`.
- **`ApiDocs.tsx` decomposition.** 727 LOC but pure presentation — not a
  bug source. The only edit to this file in this spec is updating example
  JSON from `"asset"` to `"symbol"` (see Phase 1).
- **LLM prompt externalization** (`server/api/llm/prompts/*.py`). Prompts
  are hand-authored product content; not refactor targets.
- **Feature work of any kind** — Daily Wrap, Team Chat, new panels, etc.
- **Deployment, CI/CD, README, env files.** Untouched.
- **`DailyWrap.tsx`** — documented as MOCK in `CLAUDE.md` but does not exist
  in the repo. Do not recreate. If `docs/architecture.md` references it as a
  Key File, delete the row.

---

## 4. Manual Brain Boundary

- This spec never asks you to write to `server/core/`. Verify by grepping
  your final diff: `git diff main...HEAD -- server/core/` must be empty.
- Read-only imports from `server/core/` that already exist stay
  (e.g. `from server.core.config import BlockConfig`,
  `from server.core.transforms import get_registry` in
  `server/api/main.py:85-86`). These are fine.
- A PreToolUse hook in `.claude/settings.json` blocks any Edit/Write to
  paths under `server/core/`. If you see that hook fire, you're doing
  something this spec does not authorize. Stop and report.
- Never remove a `# HUMAN WRITES LOGIC HERE` comment (see
  `tasks/lessons.md`).

---

## 5. Execution Protocol for the Fresh Session

1. **Load context first.** Read in order: `CLAUDE.md`, `docs/architecture.md`,
   `docs/conventions.md`, `tasks/lessons.md`, then this spec file top to
   bottom. Do not skip.
2. **Do NOT re-audit.** This spec is the output of a full audit done by
   three parallel explorers in the /kickoff session. Findings are already
   distilled into Phases 1-4 below. If you find a new issue not in this
   spec, note it in `tasks/progress.md` for a future refactor cycle — do
   not fix it in this pass (per `.claude/commands/refactor.md` §6).
3. **Work phase by phase, strictly in order.** After every phase:
   - Run both verification commands (`npm --prefix client/ui run typecheck`
     and `python -m compileall server/ -q`).
   - Run the manual smoke test (`./start.sh`, click through panels).
   - Create one `refactor(phaseN): <summary>` commit.
   - Update `tasks/progress.md` with a one-paragraph handoff so context
     compression doesn't lose state.
4. **Surgical commits only.** `git add path1 path2`, never `git add .`.
   Never `--no-verify`. Never push unless the user explicitly asks.
5. **Harness sync.** If you edit any file in `.claude/commands/` for any
   reason, you must mirror the body into `.windsurf/workflows/` in the
   same commit. This spec does not intentionally edit any slash command,
   but if Phase 1's drift-check uncovers existing drift, reconcile it.
6. **When in doubt, read the file.** Every `file_path:line_range` in this
   spec has been verified against the repo as of the authoring session
   (commit `66a59e6`). If line numbers have drifted, grep for the content
   anchor (e.g. `"UPDATE_THRESHOLD"`) and proceed.
7. **If a phase's verification fails and the fix is not trivial**, stop and
   write a handoff note to `tasks/progress.md` with the specific error,
   what you tried, and what you recommend. Do not ship a broken phase.

---

# PHASE 1 — Stop the Bleeding

**Goal:** kill the render storm, kill the silent env-var drift, unify naming
on the wire, and clean up stale doc references. Small diffs, ~12 files.

**Verified root causes:**

- `WebSocketProvider.tsx:105-111` — context value is a new object
  literal every render. Every `useWebSocket()` consumer re-renders on
  every tick. Combined with `GlobalContextBar`'s 47 ms timer (see
  `GlobalContextBar.tsx`) this is ~20 re-renders/sec app-wide.
- `transformApi.ts:3` — uses `VITE_API_URL`; canonical is `VITE_API_BASE`
  (`client/ui/src/config.ts:5`). Also bypasses `apiFetch`.
- `TransformsProvider.tsx:42-62` — `refresh` callback's deps are `[]`
  (OK) but the value returned to consumers on line 65 is a new object
  literal every render, cascading re-renders to every `useTransforms()`
  consumer identical to the WebSocket bug.
- `ws.py:73` — implicit rename `"asset": row["symbol"]`. Meanwhile
  `types.ts:45` has `asset` in `DesiredPosition` but `types.ts:168` has
  `symbol` in `BlockRow`. Same concept, two names in the same file.
- Stale doc references to `AGENTS.md` (now `CLAUDE.md`).

### 1.1 Fix the `WebSocketProvider` render storm

**File:** `client/ui/src/providers/WebSocketProvider.tsx`

Change the value prop on line 106–108 to a memoized object:

```tsx
const value = useMemo(
  () => ({ payload, updateHistory, connectionStatus }),
  [payload, updateHistory, connectionStatus],
);
return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
```

Add `useMemo` to the imports on line 1-8.

### 1.2 Fix the `TransformsProvider` render storm

**File:** `client/ui/src/providers/TransformsProvider.tsx`

Same treatment on line 64-67. Wrap the provider value in `useMemo`:

```tsx
const value = useMemo(
  () => ({ steps, bankroll, loading, error, refresh }),
  [steps, bankroll, loading, error, refresh],
);
return <TransformsContext.Provider value={value}>{children}</TransformsContext.Provider>;
```

Add `useMemo` to the import on line 1-8.

### 1.3 Fix `transformApi.ts` — route through `apiFetch`

**File:** `client/ui/src/services/transformApi.ts`

Full rewrite (file is 22 LOC):

```ts
import type { TransformListResponse } from "../types";
import { apiFetch } from "./api";

export async function fetchTransforms(signal?: AbortSignal): Promise<TransformListResponse> {
  return apiFetch<TransformListResponse>("/api/transforms", { signal });
}

export async function updateTransforms(
  config: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TransformListResponse> {
  return apiFetch<TransformListResponse>("/api/transforms", {
    method: "PATCH",
    body: JSON.stringify(config),
    signal,
  });
}
```

The `const BASE = import.meta.env.VITE_API_URL ...` line is DELETED.

### 1.4 Unify `asset` → `symbol` on the wire

**Server side:**

- `server/api/ws.py:73` — change `"asset": row["symbol"],` to
  `"symbol": row["symbol"],`. Keep the key order otherwise.
- `server/api/ws.py:91-112` — `_updates_from_diff` builds update cards
  that reference `pos["asset"]` on line 99 and 105. Change both to
  `pos["symbol"]`.
- Any other `"asset"` string key in `server/api/ws.py` or
  `server/api/client_ws.py` — grep and convert.

**Client types:**

- `client/ui/src/types.ts:45` — change `asset: string;` to
  `symbol: string;` inside `DesiredPosition`.
- `client/ui/src/types.ts:63` — change `asset: string;` to
  `symbol: string;` inside `UpdateCard`.
- `client/ui/src/types.ts:82` — `InvestigationContext`'s `position`
  variant already has `asset: string` and `expiry: string` — change
  `asset` to `symbol`.

**Client consumers (grep-driven, verified call sites):**

| File | Line | Current | New |
|---|---|---|---|
| `client/ui/src/components/UpdatesFeed.tsx` | 49 | `{card.asset}` | `{card.symbol}` |
| `client/ui/src/components/UpdatesFeed.tsx` | 73 | `asset={card.asset}` | `symbol={card.symbol}` |
| `client/ui/src/components/UpdatesFeed.tsx` | (prop) | `CardAttribution` component prop | Rename prop from `asset` to `symbol` |
| `client/ui/src/components/DesiredPositionGrid.tsx` | 401 | `{pendingEdit.asset}` | `{pendingEdit.symbol}` |
| `client/ui/src/components/DesiredPositionGrid.tsx` | (other) | `pendingEdit` state type | Update to `{ symbol: string; expiry: string; ... }` |
| `client/ui/src/components/LlmChat.tsx` | 7 | `ctx.card.asset` | `ctx.card.symbol` |
| `client/ui/src/components/LlmChat.tsx` | 9 | `ctx.asset` | `ctx.symbol` |
| `client/ui/src/components/equation/LiveEquationStrip.tsx` | 92 | `{focused.asset}` | `{focused.symbol}` |
| `client/ui/src/hooks/usePositionHistory.ts` | 30 | `assetSet.add(p.asset)` | `symbolSet.add(p.symbol)` (rename local variable too) |
| `client/ui/src/hooks/usePositionHistory.ts` | 32 | `${p.asset}-${p.expiry}` | `${p.symbol}-${p.expiry}` |
| `client/ui/src/hooks/useStreamContributions.ts` | 78 | `cell.asset` | `cell.symbol` |
| `client/ui/src/hooks/useStreamContributions.ts` | 93 | `fetchTimeSeries(cell.asset, cell.expiry, ...)` | `fetchTimeSeries(cell.symbol, cell.expiry, ...)` |
| `client/ui/src/hooks/useStreamContributions.ts` | 111 | `[cell?.asset, cell?.expiry]` | `[cell?.symbol, cell?.expiry]` |
| `client/ui/src/hooks/useFocusedCell.ts` | 28 | `p.asset === symbol` | `p.symbol === symbol` |
| `client/ui/src/components/shared/CommandPalette.tsx` | 84 | `cell-${p.asset}-${p.expiry}` | `cell-${p.symbol}-${p.expiry}` |
| `client/ui/src/components/shared/CommandPalette.tsx` | 86 | `${p.asset} ${p.expiry}` | `${p.symbol} ${p.expiry}` |
| `client/ui/src/components/shared/CommandPalette.tsx` | 90 | `selectDimension(p.asset, p.expiry)` | `selectDimension(p.symbol, p.expiry)` |
| `client/ui/src/components/ApiDocs.tsx` | 436, 454 | `"asset": "BTC"` | `"symbol": "BTC"` (example JSON in docs) |

After these edits, grep must return zero production hits:

```
git grep -n '"asset"\|\.asset\b' -- client/ui/src/ server/api/
```

(ApiDocs example JSON lines 436 and 454 are the only acceptable matches
after the rename, and only because they're the updated `"symbol": "BTC"`
strings — grep should show zero of `asset`.)

### 1.5 Update stale `AGENTS.md` references

`AGENTS.md` was deleted; `CLAUDE.md` replaced it. Fix:

- `docs/architecture.md:36` — delete the `AGENTS.md` row from the Key Files
  table, or replace it with a `CLAUDE.md` row.
- `docs/using-agents.md` — grep and rewrite any `AGENTS.md` reference to
  `CLAUDE.md`. This file is in the "modified but uncommitted" git status,
  so be careful not to stomp other edits.
- `tasks/todo.md:27` — the line `_server/api/main.py_ (934)` etc. is the
  follow-up that this refactor resolves. Do **not** delete during Phase 1;
  mark it resolved at the end of Phase 4.
- `docs/architecture.md` Key Files table line for `DailyWrap.tsx` — delete
  if present (the file does not exist).

### 1.6 Verify harness sync

For every file in `.claude/commands/`, diff against the corresponding file
in `.windsurf/workflows/`. The bodies (everything after the frontmatter)
must be byte-identical. If drift exists, reconcile by making Windsurf match
Claude's version (Claude Code is primary per `docs/decisions.md`
2026-04-09).

Quick check:

```
for f in .claude/commands/*.md; do
  name=$(basename "$f")
  diff <(sed '/^---$/,/^---$/d' "$f") <(sed '/^---$/,/^---$/d' ".windsurf/workflows/$name")
done
```

### 1.7 Phase 1 verification

```
npm --prefix client/ui run typecheck   # must pass clean
python -m compileall server/ -q        # must pass clean
./start.sh                              # connect, click through panels, verify no errors
```

**Profiler check:** open React DevTools → Profiler tab → record 5 seconds
of idle time. `DesiredPositionGrid`, `UpdatesFeed`, `AnatomyCanvas`, and
`LlmChat` should each show at most a handful of renders, not hundreds.

### 1.8 Phase 1 commit

```
git add client/ui/src/providers/WebSocketProvider.tsx \
        client/ui/src/providers/TransformsProvider.tsx \
        client/ui/src/services/transformApi.ts \
        client/ui/src/types.ts \
        server/api/ws.py \
        client/ui/src/components/UpdatesFeed.tsx \
        client/ui/src/components/DesiredPositionGrid.tsx \
        client/ui/src/components/LlmChat.tsx \
        client/ui/src/components/equation/LiveEquationStrip.tsx \
        client/ui/src/hooks/usePositionHistory.ts \
        client/ui/src/hooks/useStreamContributions.ts \
        client/ui/src/hooks/useFocusedCell.ts \
        client/ui/src/components/shared/CommandPalette.tsx \
        client/ui/src/components/ApiDocs.tsx \
        docs/architecture.md \
        docs/using-agents.md
git commit -m "refactor(phase1): memoize providers, unify symbol naming, fix transformApi env var"
```

(Add any harness sync files reconciled in §1.6 to the same commit or a
separate `chore(harness): reconcile command/workflow drift` commit.)

---

# PHASE 2 — Tighten the API Boundary

**Goal:** replace every `dict[str, Any]` escape hatch with a typed Pydantic
submodel; add a central exception handler; unify client error handling;
convert the pipeline-timeseries endpoint to camelCase on the wire.

### 2.1 Replace `dict[str, Any]` at the boundary

**File:** `server/api/models.py`

Add these new submodels **before** the existing models that use them:

```py
class SnapshotRow(BaseModel):
    """One row of a snapshot ingestion payload.

    Extra keys are permitted because the set of `key_cols` varies per
    stream — the server validates the required set at ingestion time in
    `stream_registry.ingest_snapshot`. Everything else (timestamp,
    raw_value) is statically required.
    """
    model_config = {"extra": "allow"}

    timestamp: str = Field(..., description="ISO 8601 timestamp")
    raw_value: float = Field(..., description="Raw measurement value")


class CellContext(BaseModel):
    """Cell context forwarded to the LLM investigation endpoint.

    Mirrors `InvestigationContext` in `client/ui/src/types.ts`. The
    discriminated `type` field distinguishes between a card click and a
    cell click.
    """
    model_config = {"extra": "allow"}

    type: Literal["update", "position"]
```

Then update existing models:

- `InvestigateRequest.cell_context` (line 21) — change type from
  `dict[str, Any] | None` to `CellContext | None`.
- `SnapshotRequest.rows` (line 85) — change type from
  `list[dict[str, Any]]` to `list[SnapshotRow]`.
- `ManualBlockRequest.snapshot_rows` (line 184) — change type from
  `list[dict[str, Any]]` to `list[SnapshotRow]`.
- `UpdateBlockRequest.snapshot_rows` (line 201) — change type from
  `list[dict[str, Any]] | None` to `list[SnapshotRow] | None`.
- `ClientWsInboundFrame.rows` (line 212) — change type from
  `list[dict[str, Any]]` to `list[SnapshotRow]`.

**Do NOT change** `TransformStepResponse.params` (line 268) or the seven
`*_params` fields in `TransformConfigRequest` (lines 279-292). These are
legitimate dynamic shapes driven by `server/core/transforms.py`
introspection. Add an inline comment on each explaining the exception:

```py
# Dynamic shape discovered at runtime from server/core/transforms.py
# parameter definitions; cannot be statically typed.
params: dict[str, Any]
```

### 2.2 Discriminated union for client WS frames

**File:** `server/api/models.py`

After `ClientWsError` (line 234), add:

```py
from typing import Annotated, Union

ClientWsOutboundFrame = Annotated[
    Union[ClientWsAck, ClientWsError],
    Field(discriminator="type"),
]
```

Update the sender in `server/api/client_ws.py` to annotate return
types as `ClientWsOutboundFrame` where applicable. (If that file already
picks between the two without annotation, just add the union and leave
the runtime code alone — the discriminator is for parsers.)

### 2.3 Central FastAPI exception handler

**File:** `server/api/main.py`

Add, immediately after `app = FastAPI(...)` (line 108) and before the CORS
middleware (line 110):

```py
from fastapi import Request
from fastapi.responses import JSONResponse

class ApiError(BaseModel):
    """Canonical client-facing error envelope.

    Never contains stack traces. Callers can rely on the shape:
    `{ "error": { "code": int, "message": str } }`.
    """
    code: int
    message: str


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled exception in %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": 500, "message": "Internal server error"}},
    )
```

(`BaseModel` is already imported via the other models; `Request` and
`JSONResponse` need to be added to the imports on lines 34-36.)

### 2.4 Sanitize the investigation SSE error path

**File:** `server/api/main.py`, lines 176-178

Current:

```py
except Exception as exc:
    log.exception("Investigation stream failed")
    yield f"event: error\ndata: {exc}\n\n"
```

New:

```py
except Exception:
    log.exception("Investigation stream failed")
    yield "event: error\ndata: {\"code\": 500, \"message\": \"Investigation failed\"}\n\n"
```

The stack trace / exception repr no longer leaks to the trader. Server log
captures the detail via `log.exception`.

### 2.5 Unify client error handling

**File:** `client/ui/src/services/api.ts`

Extend `apiFetch` to throw a structured error:

```ts
import { API_BASE } from "../config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let code: number | null = null;
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: number; message?: string } };
      if (body.error) {
        code = body.error.code ?? null;
        message = body.error.message ?? message;
      }
    } catch {
      // Body isn't JSON — fall back to raw text
      message = (await res.text().catch(() => "")) || `${res.status}`;
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}
```

Audit every service that calls `apiFetch` (`blockApi.ts`, `llmApi.ts`,
`pipelineApi.ts`, `streamApi.ts`, `transformApi.ts` — transformApi
converted in Phase 1). Any bespoke error-parsing logic in a service file
that checks `error.message` string contents should be updated to use
`err instanceof ApiError` and `err.status` / `err.code` / `err.message`.

**`llmApi.ts` is the main one to inspect** — it has a custom streaming
callback-based error handler; make sure non-stream paths go through the
new `ApiError` class.

### 2.6 Convert the pipeline-timeseries endpoint to camelCase

**File:** `server/api/main.py`, `_pipeline_timeseries_sync` (lines 556-659)

Change every snake_case key in the two dict literals (block-level at
lines 598-606, aggregated at lines 611-621, current_agg at lines 640-649)
to camelCase:

```
timestamps → timestamps               (unchanged)
total_fair → totalFair
total_market_fair → totalMarketFair
edge → edge                           (unchanged)
smoothed_edge → smoothedEdge
var → var                             (unchanged)
smoothed_var → smoothedVar
raw_desired_position → rawDesiredPosition
smoothed_desired_position → smoothedDesiredPosition
market_fair → marketFair              (block-level)
space_id → spaceId
aggregation_logic → aggregationLogic
block_name → blockName                (block-level, current_blocks)
current_decomposition → currentDecomposition  (top-level key on line 655)
```

The top-level dict on line 651-658 has these keys: `symbol`, `blocks`,
`aggregated`, `current_decomposition` — rename `current_decomposition` to
`currentDecomposition`. Also add `expiry` before returning (line 677 in
the async wrapper already does this).

The per-block struct on lines 598-606 has: `block_name`, `space_id`,
`aggregation_logic`, `timestamps`, `fair`, `market_fair`, `var` — rename
the snake_case ones.

The current_blocks entries (lines 628-635) have: `block_name`, `space_id`,
`fair`, `market_fair`, `var` — same rename.

**File:** `client/ui/src/types.ts`

Rewrite `AggregatedTimeSeries` (lines 143-153):

```ts
export interface AggregatedTimeSeries {
  timestamps: string[];
  totalFair: number[];
  totalMarketFair: number[];
  edge: number[];
  smoothedEdge: number[];
  var: number[];
  smoothedVar: number[];
  rawDesiredPosition: number[];
  smoothedDesiredPosition: number[];
}
```

Rewrite `BlockTimeSeries` (lines 132-140):

```ts
export interface BlockTimeSeries {
  blockName: string;
  spaceId: string;
  aggregationLogic: string;
  timestamps: string[];
  fair: number[];
  marketFair: number[];
  var: number[];
}
```

Rewrite `CurrentBlockDecomposition` (lines 156-162):

```ts
export interface CurrentBlockDecomposition {
  blockName: string;
  spaceId: string;
  fair: number;
  marketFair: number;
  var: number;
}
```

Rewrite `PipelineTimeSeriesResponse` (lines 197-206):

```ts
export interface PipelineTimeSeriesResponse {
  symbol: string;
  expiry: string;
  blocks: BlockTimeSeries[];
  aggregated: AggregatedTimeSeries;
  currentDecomposition: {
    blocks: CurrentBlockDecomposition[];
    aggregated: Record<string, number>;
  };
}
```

**Consumer update — `PipelineChart.tsx`:**

Grep for every snake_case reference and convert:

| Line (approx) | Current | New |
|---|---|---|
| 38 | `type DecompositionMode = "variance" \| "fair_value" \| "desired_position" \| "smoothed_desired_position"` | Keep the string literals **as internal UI enum values** — they are NOT wire names. Leave unchanged. Add a comment explaining the distinction. |
| 42 | `smoothed_desired_position: "Desired Pos (Smooth)"` | keep (internal map key) |
| 85 | `aggregated.total_fair` | `aggregated.totalFair` |
| 86 | `aggregated.smoothed_var ?? aggregated.var` | `aggregated.smoothedVar ?? aggregated.var` |
| 87 | `aggregated.raw_desired_position ?? aggregated.smoothed_desired_position` | `aggregated.rawDesiredPosition ?? aggregated.smoothedDesiredPosition` |
| 88 | `aggregated.smoothed_desired_position` | `aggregated.smoothedDesiredPosition` |
| 92, 101 | DecompositionMode checks | leave (internal enum) |
| 155 | `"smoothed_desired_position"` as a key literal | leave (internal mode key) |
| 419 | `data: aggregated.raw_desired_position` | `data: aggregated.rawDesiredPosition` |
| 430 | `data: aggregated.smoothed_desired_position` | `data: aggregated.smoothedDesiredPosition` |
| 463 | `data: aggregated.total_fair` | `data: aggregated.totalFair` |
| 476 | `data: aggregated.total_market_fair` | `data: aggregated.totalMarketFair` |

**Internal-vs-wire rule:** the `DecompositionMode` union in
`PipelineChart.tsx:38` uses snake_case string literals as UI state values
(e.g. `"smoothed_desired_position"` as the current mode). These are **not
wire names** — they are opaque UI tokens. They stay as-is. Do **not**
rename them to `smoothedDesiredPosition` — that would be busywork and
would force every UI selector, URL param, etc. to update.

After Phase 2.6, `git grep 'total_fair\|total_market_fair\|smoothed_edge\|smoothed_var\|raw_desired_position\|smoothed_desired_position' -- client/ui/src/` should return **only** the internal `DecompositionMode` string-literal references — not field accesses.

### 2.7 Add the manual-mirror decision

**File:** `docs/decisions.md`

Append a new entry dated 2026-04-09:

```
## 2026-04-09 — Keep `types.ts` as a hand-maintained mirror of `models.py`

**Context:** Phase 2 of the broad refactor tightened the API contract by
replacing `dict[str, Any]` escape hatches with typed Pydantic submodels.
The question of whether to auto-generate `client/ui/src/types.ts` from
Pydantic (via `pydantic2ts` or equivalent) was raised and deferred.

**Decision:** Continue hand-maintaining `types.ts`. When a Pydantic model
in `server/api/models.py` changes, the authoring agent must update
`types.ts` in the same commit. Enforcement is by convention and by
/doc-sync review — no tooling.

**Rationale:** Codegen is ~1 day of work including the build-step
plumbing. Until schema drift becomes a real pain again, the manual sync
is cheap. The Phase 2 contract tightening reduces the churn rate on
models.py, so drift is less likely in the near term.

**Consequences:** Agents must continue to read `models.py` before any
work that crosses the API boundary. This is already a `CLAUDE.md` rule.
Revisit this decision if drift surfaces >2 bugs per quarter.
```

### 2.8 Phase 2 verification

```
npm --prefix client/ui run typecheck
python -m compileall server/ -q
./start.sh   # hit investigation SSE, pipeline chart, manual block create
```

Sanity checks:
- Open the network tab, hit `/api/pipeline/timeseries` — confirm response
  body is camelCase.
- Throw a fake 500 from an endpoint (temporarily `raise RuntimeError("x")`
  in a handler, then revert) — confirm client receives
  `{"error": {"code": 500, "message": "Internal server error"}}` with no
  traceback.
- Click through investigation chat — confirm the SSE error path (if
  triggered by a malformed model call) no longer leaks the exception repr.

### 2.9 Phase 2 commit

```
git add server/api/models.py \
        server/api/main.py \
        server/api/client_ws.py \
        client/ui/src/services/api.ts \
        client/ui/src/services/llmApi.ts \
        client/ui/src/types.ts \
        client/ui/src/components/PipelineChart.tsx \
        docs/decisions.md
git commit -m "refactor(phase2): typed API boundary, central error handler, camelCase timeseries"
```

---

# PHASE 3 — Server Decomposition

**Goal:** split `server/api/main.py` (934 LOC) into per-feature routers;
move `_manual_streams` into `stream_registry` with a lock; wrap the
`rerun_pipeline + restart_ticker` pair into one function; hoist magic
numbers to `config.py`.

### 3.1 Route map (verified line ranges from commit 66a59e6)

| New file | Source lines in `main.py` | Endpoints |
|---|---|---|
| `server/api/routers/llm.py` | 152-188 | `POST /api/investigate` |
| `server/api/routers/streams.py` | 195-297 | stream CRUD (5 endpoints) + `_stream_to_response` helper |
| `server/api/routers/snapshots.py` | 304-334 | `POST /api/snapshots` |
| `server/api/routers/market_pricing.py` | 341-371 | market pricing GET/POST |
| `server/api/routers/bankroll.py` | 378-407 | bankroll GET/PATCH |
| `server/api/routers/transforms.py` | 414-508 | transforms GET/PATCH + `_STEP_LABELS` constant |
| `server/api/routers/pipeline.py` | 515-679 | `_pipeline_dimensions_sync`, `_parse_expiry`, `_pipeline_timeseries_sync`, two GET endpoints |
| `server/api/routers/blocks.py` | 685-934 | `_blocks_from_pipeline`, 3 block endpoints |

**Convention (per `docs/conventions.md`):** no barrel files. Do not create
`server/api/routers/__init__.py` with re-exports. An empty `__init__.py`
is acceptable if Python demands it.

### 3.2 Router skeleton

Each router file follows this template:

```py
"""<one-line purpose>."""

from __future__ import annotations

import logging
# ... other module-specific imports

from fastapi import APIRouter, HTTPException

from server.api.models import (...)
# ... engine_state / stream_registry imports as needed

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/...")
async def ...():
    ...
```

Then `server/api/main.py` mounts them:

```py
from server.api.routers.llm import router as llm_router
from server.api.routers.streams import router as streams_router
# ... etc
app.include_router(llm_router)
app.include_router(streams_router)
# ...
```

### 3.3 Handle shared helpers

Some helpers move with their primary router; others become shared:

- `_stream_to_response` (main.py:195-217) → **moves into**
  `routers/streams.py` as a module-private function.
- `_STEP_LABELS` (main.py:414-422) → **moves into** `routers/transforms.py`
  as a module-private constant.
- `_parse_expiry` (main.py:542-553) → **moves into** `routers/pipeline.py`
  (used only there).
- `_pipeline_dimensions_sync` and `_pipeline_timeseries_sync` (main.py:515,
  556) → **move into** `routers/pipeline.py`.
- `_blocks_from_pipeline` (main.py:689-766) → **moves into**
  `routers/blocks.py` as a module-private function.
- `_get_llm_service` + `_llm_service` singleton (main.py:119-130) →
  **moves into** `routers/llm.py` as module-private.

### 3.4 Move `_manual_streams` into `stream_registry`

Currently `server/api/main.py:686` has:

```py
_manual_streams: dict[str, dict] = {}
```

This is **module-level mutable state** accessed by two handlers
concurrently with no lock, and never pruned when a manual stream is
deleted. Move the store into `server/api/stream_registry.py` as a
thread-safe typed store.

Add to `stream_registry.py`:

```py
import threading

@dataclass
class ManualBlockMetadata:
    created_at: str

class _ManualBlockStore:
    def __init__(self) -> None:
        self._entries: dict[str, ManualBlockMetadata] = {}
        self._lock = threading.Lock()

    def mark(self, stream_name: str, created_at: str) -> None:
        with self._lock:
            self._entries[stream_name] = ManualBlockMetadata(created_at=created_at)

    def unmark(self, stream_name: str) -> None:
        with self._lock:
            self._entries.pop(stream_name, None)

    def is_manual(self, stream_name: str) -> bool:
        with self._lock:
            return stream_name in self._entries
```

Expose a singleton via `get_manual_block_store()` (mirrors the
`get_stream_registry()` pattern).

Update `StreamRegistry.delete()` to call `manual_block_store.unmark(name)`
so deletion is no longer leaky. This is the data-integrity fix — today a
deleted manual block's metadata lingers.

In `routers/blocks.py`:
- `_blocks_from_pipeline` line 733 currently reads
  `sn in _manual_streams`. Replace with `store.is_manual(sn)` where
  `store = get_manual_block_store()`.
- `create_manual_block` line 828 currently writes
  `_manual_streams[req.stream_name] = {...}`. Replace with
  `store.mark(req.stream_name, _dt.now().isoformat())`.

After this, `_manual_streams` as a module-level dict no longer exists.

### 3.5 Wrap `rerun_pipeline + restart_ticker` into one atomic function

Currently 12 call sites repeat this pattern:

```py
await asyncio.to_thread(rerun_pipeline, stream_configs)
await restart_ticker()
```

Grep verified locations (line numbers in main.py before decomposition):
320-321, 355-356, 394-395, 498-499, 836-837, 919-920. Also client_ws.py.

**Fix:** add to `server/api/engine_state.py`:

```py
from typing import Any as _Any  # if not already imported

async def rerun_and_broadcast(
    stream_configs: list,
    *,
    bankroll: float | None = None,
    market_pricing: dict[str, float] | None = None,
    transform_config: dict | None = None,
) -> None:
    """Re-run the pipeline and restart the WS ticker as an atomic pair.

    Every code path that previously called ``rerun_pipeline`` followed
    by ``restart_ticker`` must call this instead. Forgetting the
    second call leaves the UI showing stale data.

    The ticker restart import is done lazily to avoid circular imports
    between ``engine_state`` and ``ws``.
    """
    from server.api.ws import restart_ticker  # lazy

    kwargs: dict[str, _Any] = {}
    if bankroll is not None:
        kwargs["bankroll"] = bankroll
    if market_pricing is not None:
        kwargs["market_pricing"] = market_pricing
    if transform_config is not None:
        kwargs["transform_config"] = transform_config

    await asyncio.to_thread(rerun_pipeline, stream_configs, **kwargs)
    await restart_ticker()
```

(You will need `import asyncio` at the top of `engine_state.py` if not
present.)

Every router's `rerun_pipeline` + `restart_ticker` pair becomes one
`await rerun_and_broadcast(stream_configs, bankroll=..., ...)` call.

### 3.6 Hoist magic numbers into `config.py`

**File:** `server/api/config.py`

Add:

```py
# ---------------------------------------------------------------------------
# WebSocket ticker
# ---------------------------------------------------------------------------

# How often (in real seconds) we push a new tick to clients
TICK_INTERVAL_SECS: float = 2.0

# Minimum |delta| in smoothed_desired_position required to emit an UpdateCard
UPDATE_THRESHOLD: float = 50.0


# ---------------------------------------------------------------------------
# OpenRouter HTTP timeouts
# ---------------------------------------------------------------------------

OPENROUTER_TIMEOUT_SECS: float = 30.0
OPENROUTER_STREAM_TIMEOUT_SECS: float = 60.0
```

**File:** `server/api/ws.py`

Delete lines 29 and 32. Import the two constants from `config.py`.

**File:** `server/api/llm/client.py`

Replace hardcoded `timeout=30.0` (line 53) and `timeout=60.0` (line 78)
with the new config constants.

### 3.7 Surface silent WS broadcast errors

**File:** `server/api/ws.py` (around line 178 per the audit)

Wherever a `try/except` silently removes a disconnected client without
logging, add `log.exception(...)` or `log.debug(...)` with enough info
(client count, error class) so disconnects can be distinguished from
actual server bugs. Do NOT flood the log on every disconnect — use
`log.debug` for the normal path and `log.exception` only when the
exception is not a known disconnect error (e.g. `WebSocketDisconnect`).

### 3.8 Trim `main.py` to the shell

After all routers are extracted, `server/api/main.py` should contain only:

- Imports
- `lifespan` asynccontextmanager
- `app = FastAPI(...)`
- CORS middleware
- Central exception handler (from Phase 2)
- Router includes
- `GET /api/health`
- `@app.websocket("/ws")` → `pipeline_ws`
- `@app.websocket("/ws/client")` → `client_ws`

Target < 150 LOC. The 934-line original → ~120 lines.

### 3.9 Phase 3 verification

```
npm --prefix client/ui run typecheck
python -m compileall server/ -q
./start.sh
```

Smoke test every endpoint group from the UI:
- Floor panel → grid renders → updates feed populates
- Studio → create a stream → configure it → ingest a snapshot → see
  pipeline rerun
- Studio → edit bankroll → see pipeline rerun
- Studio → edit market pricing → see pipeline rerun
- Studio → edit a transform config → see pipeline rerun
- Brain → manual block creation flow → new block appears in block table
- Delete the manual block → confirm `manual_block_store.is_manual(name)`
  returns False (test by creating a new stream with the same name —
  should NOT show `source="manual"`)
- Docs panel → investigation chat → SSE streams

### 3.10 Phase 3 commit

```
git add server/api/main.py \
        server/api/routers/ \
        server/api/engine_state.py \
        server/api/stream_registry.py \
        server/api/ws.py \
        server/api/config.py \
        server/api/llm/client.py \
        server/api/client_ws.py
git commit -m "refactor(phase3): split main.py into routers, atomic rerun_and_broadcast, hoist magic numbers"
```

---

# PHASE 4 — Client Decomposition

**Goal:** break up the client mega-components that hide state complexity;
extract reusable hooks; hoist magic numbers to a `constants.ts` module.

### 4.1 Create `client/ui/src/constants.ts`

```ts
/** UI constants. Any magic number that appears inline in a component belongs here. */

export const POLL_INTERVAL_TRANSFORMS_MS = 10_000;
export const POLL_INTERVAL_BLOCKS_MS = 5_000;
export const POLL_INTERVAL_TIMESERIES_MS = 5_000;
export const POLL_INTERVAL_SELECTION_MS = 5_000;

export const HOVER_DELAY_MS = 350;

export const SIDEBAR_DEFAULT_WIDTH_PX = 176;
export const SIDEBAR_MIN_WIDTH_PX = 120;
export const SIDEBAR_MAX_WIDTH_PX = 400;

export const UPDATE_HISTORY_MAX_LENGTH = 100;
export const GLOBAL_CONTEXT_TICK_MS = 47;
```

Then grep for each value and replace with a named import:

- `PipelineChart.tsx` — sidebar widths (lines ~288, ~385), 5000 ms poll
  (line ~361)
- `DesiredPositionGrid.tsx` — `HOVER_DELAY_MS` constant (may already be
  local; delete local and import from `constants.ts`)
- `TransformsProvider.tsx` — `POLL_INTERVAL_MS` (line 13) → import
  `POLL_INTERVAL_TRANSFORMS_MS`
- `SelectionProvider.tsx` — `POLL_MS` (line 40) → import
  `POLL_INTERVAL_SELECTION_MS`
- `WebSocketProvider.tsx` — the `100` cap in updateHistory `.slice(0, 100)`
  (line 47) → `UPDATE_HISTORY_MAX_LENGTH`
- `GlobalContextBar.tsx` — the 47 ms tick interval → `GLOBAL_CONTEXT_TICK_MS`

### 4.2 Decompose `PipelineChart.tsx` (779 → <300 LOC)

Target structure after split:

```
client/ui/src/components/PipelineChart.tsx               <- container, <300 LOC
client/ui/src/components/PipelineChart/DecompositionSidebar.tsx
client/ui/src/components/PipelineChart/chartOptions.ts   <- pure ECharts config builder
client/ui/src/hooks/usePipelineTimeSeries.ts             <- data fetching + caching
```

**Extraction map:**

- Lines 1-279 (module-level LRU cache `tsCache`, `sci` helper,
  `DecompositionSidebar` component) →
  - `DecompositionSidebar` component → `PipelineChart/DecompositionSidebar.tsx`
  - `tsCache` + fetch logic → `hooks/usePipelineTimeSeries.ts`
  - `sci` formatter → either move into a utility module (`utils.ts`) if
    general, or inline into the file that uses it
- Lines 299-364 (data fetching effect) → fold into
  `usePipelineTimeSeries.ts`
- Lines 406-681 (ECharts `option` builder) → `chartOptions.ts` as a pure
  function `buildPipelineChartOptions(aggregated, blocks, mode, ...)`
- Remaining `PipelineChart.tsx` container: reads `useWebSocket`, calls
  `usePipelineTimeSeries()`, renders `<DecompositionSidebar />` and
  `<ReactEChartsCore option={buildPipelineChartOptions(...)} />`

**Critical fix during the split:** line 325 currently has

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
```

This suppresses a deps warning. When moving the effect into
`usePipelineTimeSeries.ts`, fix the root cause by including the missing
deps (or memoizing the external functions). Do NOT carry the disable
comment over.

### 4.3 Decompose `DesiredPositionGrid.tsx` (424 → <300 LOC)

Target structure:

```
client/ui/src/components/DesiredPositionGrid.tsx            <- renderer, <300 LOC
client/ui/src/hooks/usePositionEdit.ts                      <- edit state machine
client/ui/src/hooks/usePositionHover.ts                     <- hover timer state
```

**`usePositionEdit.ts`** owns: `pendingEdit`, `overrides` (Map),
`inputRef`, `prevEditKeyRef`, `handleDoubleClick`, `confirmOverride`,
`cancelEdit`, `removeOverride`, `getDisplayValue`. Exposes:

```ts
export function usePositionEdit() {
  return {
    pendingEdit, overrides, inputRef,
    startEdit, confirmEdit, cancelEdit, removeOverride,
    getDisplayValue,
  };
}
```

**`usePositionHover.ts`** owns: `hoverCell`, `hoverTimeoutRef`,
`handleMouseEnter`, `handleMouseLeave`. Reads `HOVER_DELAY_MS` from
`constants.ts`. Exposes:

```ts
export function usePositionHover() {
  return { hoverCell, onMouseEnter, onMouseLeave };
}
```

**Remaining `DesiredPositionGrid.tsx`**: view state (`viewMode`,
`timeframe`), grid rendering, calls both hooks.

**Bug fix during split:** currently switching `timeframe` while an edit is
pending does not cancel the edit (pendingEdit targets one cell; the cell
key encodes timeframe implicitly via the displayed value). When moving
edit state into `usePositionEdit.ts`, make it expose a
`cancelEdit()` that the parent calls inside a
`useEffect(() => cancelEdit(), [timeframe])` to force cancellation on
timeframe switch.

### 4.4 Fix `AnatomyCanvas.tsx` over-subscription (453 → <350 LOC)

**File:** `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx`

**Problem 1:** line 88 reads `const { payload } = useWebSocket()` but only
uses `payload?.positions.length` (line 149). Every tick triggers an
unnecessary re-render of the entire React Flow tree.

**Fix:** create a narrow selector hook in `WebSocketProvider.tsx`:

```ts
export function useWebSocketPositionCount(): number {
  const { payload } = useWebSocket();
  return payload?.positions.length ?? 0;
}
```

Replace the line-88 destructure with `useWebSocketPositionCount()`. Now
AnatomyCanvas only re-renders when the position count actually changes.

**Problem 2:** lines 91-100 shadow provider state via `localSteps`, and
the effect on line 91 syncs provider → local. This creates a race: if
the user edits while a poll is mid-flight, the sync clobbers their edit.

**Fix:** remove `localSteps`. Edit provider steps directly. If
`TransformsProvider` does not expose a `setSteps` function, add one:

```ts
// in TransformsProvider.tsx, inside the provider component
const [steps, setSteps] = useState<Record<string, TransformStep> | null>(null);
// ...expose setSteps in the context value
const value = useMemo(
  () => ({ steps, setSteps, bankroll, loading, error, refresh }),
  [steps, bankroll, loading, error, refresh],
);
```

And in `AnatomyCanvas.tsx`, replace `setLocalSteps(...)` with
`setSteps(...)` from the provider, then `await refresh()` to reconcile.

**Problem 3:** if `AnatomyCanvas.tsx` exceeds ~350 LOC after the above
fixes, extract `AnatomyCanvasInner` into its own file or split out the
React Flow node/edge builders. Use judgement — do not split if the
result is more confusing than the starting state. The hard ceiling is
comprehension, not LOC.

### 4.5 Fix `useStreamContributions.ts` abort-signal race

**File:** `client/ui/src/hooks/useStreamContributions.ts`, around lines
93-110

Currently `cache.set(...)` runs before the abort check. If the component
unmounts mid-fetch, the resolved promise still writes cached state and
potentially calls a state setter on an unmounted component.

**Fix:** check `controller.signal.aborted` before any `cache.set` or
`setState` call, and guard the setState:

```ts
fetchTimeSeries(cell.symbol, cell.expiry, controller.signal)
  .then((data) => {
    if (controller.signal.aborted) return;
    cache.set(key, data);
    setContributions(data);
  })
  .catch((err) => {
    if (controller.signal.aborted) return;
    setError(err instanceof Error ? err.message : String(err));
  });
```

### 4.6 Fix `StreamTable.tsx` exhaustive-deps disable

**File:** `client/ui/src/components/studio/StreamTable.tsx:208`

Remove the `eslint-disable-next-line react-hooks/exhaustive-deps` comment
and include the missing dependencies (`onOpenStream`, `handleDelete`) in
the `useMemo` deps array. If including them causes the columns to rebuild
too often, wrap the callers in `useCallback` higher up the tree.

### 4.7 Clean up `tasks/todo.md`

The "Follow-ups" section at the bottom of `tasks/todo.md` includes:

> - [ ] Source file decomposition per 300-line convention. Candidates:
>   `server/api/main.py` (934), `client/ui/src/components/PipelineChart.tsx`
>   (779), ...

After Phase 4 lands, mark each decomposition candidate that was actually
addressed as done. Leave `ApiDocs.tsx` (727) and `transforms.py` (726,
HUMAN ONLY) as open.

Do **not** delete the formatter/prettier/ruff follow-up or the Stop-hook
latency note — those are untouched by this refactor.

### 4.8 Phase 4 verification

```
npm --prefix client/ui run typecheck
python -m compileall server/ -q
./start.sh
```

Manual smoke test focusing on the refactored components:
- PipelineChart: select a symbol/expiry, switch between the four
  decomposition modes, confirm the chart re-renders correctly, confirm
  the sidebar values match
- DesiredPositionGrid: double-click a cell, edit, confirm; double-click
  another cell, switch timeframe while editing, confirm the edit is
  cancelled cleanly; hover over a cell, confirm the hover card appears
  after ~350 ms and disappears on mouse-out
- AnatomyCanvas: open a stream, edit a transform param, confirm
  persistence; watch the profiler during 5 s idle — no re-renders
- Global smoke: every panel still renders, nothing crashes

**Profiler re-verification:** re-run the React DevTools profiler check
from §1.7 / Acceptance Criteria. No re-renders on the 47 ms
`GlobalContextBar` tick from `DesiredPositionGrid`, `UpdatesFeed`,
`AnatomyCanvas`, `PipelineChart`, `LlmChat`, or `LiveEquationStrip`.

### 4.9 Phase 4 commit

```
git add client/ui/src/constants.ts \
        client/ui/src/components/PipelineChart.tsx \
        client/ui/src/components/PipelineChart/ \
        client/ui/src/components/DesiredPositionGrid.tsx \
        client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx \
        client/ui/src/components/studio/StreamTable.tsx \
        client/ui/src/hooks/usePipelineTimeSeries.ts \
        client/ui/src/hooks/usePositionEdit.ts \
        client/ui/src/hooks/usePositionHover.ts \
        client/ui/src/hooks/useStreamContributions.ts \
        client/ui/src/providers/WebSocketProvider.tsx \
        client/ui/src/providers/TransformsProvider.tsx \
        client/ui/src/providers/SelectionProvider.tsx \
        client/ui/src/components/GlobalContextBar.tsx \
        tasks/todo.md
git commit -m "refactor(phase4): decompose PipelineChart/DesiredPositionGrid, narrow WS subscriptions, hoist constants"
```

---

## 6. Doc Sync (after Phase 4)

After all four phases land, invoke `/doc-sync`. Expect updates to:

- `docs/architecture.md` — Key Files table. Add:
  - `server/api/routers/*.py` rows
  - `server/api/orchestration.py` if created (or note on `engine_state.py`'s
    new `rerun_and_broadcast`)
  - `client/ui/src/constants.ts`
  - `client/ui/src/components/PipelineChart/` subdirectory
  - New hooks (`usePipelineTimeSeries`, `usePositionEdit`, `usePositionHover`)
  Remove any stale rows.

- `docs/conventions.md` — add a note under "Patterns Used":
  - "Context provider values are memoized with `useMemo`." (new canonical)
  - "HTTP services route through `apiFetch` + `ApiError`." (now enforced)
  - "Magic numbers hoist to `client/ui/src/constants.ts` or
    `server/api/config.py`." (already said; reinforce)

- `docs/stack-status.md` — no status transitions expected; refresh line
  counts if relevant.

- `tasks/lessons.md` — add lessons surfaced by the refactor:
  - "Every Context provider `value` prop must be memoized. Unmemoized
    value objects are the #1 source of cascading re-renders."
  - "Every HTTP service must route through the central `apiFetch`
    helper. Per-service fetch wrappers drift in error format and env-var
    handling."
  - "Atomic operation pairs (rerun_pipeline + restart_ticker) should be
    one function, not two. Callers forget the second call."

- `CLAUDE.md` — no load-bearing rule changed; skip unless doc-sync
  surfaces a genuine addition.

- `tasks/todo.md` — move completed follow-ups out of "Follow-ups",
  record any new lessons discovered during execution.

---

## 7. Final PR

After Phase 4 commit lands on `generalisation`:

1. Push `generalisation` to origin (with user approval — per
   `CLAUDE.md`, never push without being asked, so confirm before
   running `git push`).
2. Open a single PR `generalisation` → `main` with this title:
   `refactor: pattern convergence and root-cause cleanup (4 phases)`
3. PR body:

```
## Summary
- Phase 1: memoize providers, unify symbol naming, fix transformApi env var
- Phase 2: typed API boundary, central error handler, camelCase timeseries
- Phase 3: split main.py into routers, atomic rerun_and_broadcast, hoist magic numbers
- Phase 4: decompose PipelineChart/DesiredPositionGrid, narrow WS subscriptions, hoist constants

See `tasks/spec-refactor-convergence.md` for full rationale and verification notes.

## Test plan
- [ ] `npm --prefix client/ui run typecheck`
- [ ] `python -m compileall server/ -q`
- [ ] `./start.sh`, click through Floor/Studio/Brain/Docs panels
- [ ] React DevTools profiler: no re-renders on 47 ms GlobalContextBar tick
- [ ] Manual block creation + deletion round-trip
- [ ] Investigation SSE chat works end-to-end
- [ ] Pipeline chart populates across all 4 decomposition modes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Do **not** force-push. Do **not** close/reopen. If CI fails on the PR,
fix forward with a new commit (not an amend).

---

## 8. Risks & Known Gotchas for the Executing Session

1. **Pydantic `extra="allow"` on SnapshotRow** — this lets key_cols pass
   through without static validation, because key_cols are stream-specific.
   The runtime validation in `stream_registry.ingest_snapshot` is the
   authority there. Do not remove `extra="allow"` thinking it's a leak.

2. **`DecompositionMode` string literals are UI-internal** — do NOT rename
   them to camelCase during Phase 2.6. They are opaque UI state tokens,
   not wire field names. Only the `aggregated.*` field accesses change.

3. **Circular import risk in `engine_state.rerun_and_broadcast`** — the
   function imports `restart_ticker` lazily inside the function body to
   avoid a circular dep with `ws.py`. Do not hoist this import to the
   top of the file.

4. **`ws.py`'s module-level `_clients` and `_ticker_task` globals are
   intentional** — they implement the singleton ticker pattern per
   `docs/decisions.md` 2025 ("Singleton WebSocket ticker with broadcast").
   Do not try to refactor them into a class during Phase 3 — that is out
   of scope.

5. **`engine_state.py:76` lazy import of `stream_registry`** — keep it
   lazy. Hoisting it triggers a circular import. Add a comment if one is
   not already there.

6. **`AnatomyCanvas.tsx` `AnatomyCanvasInner`** — the outer component is
   just a `<ReactFlowProvider>` wrapper (lines 76-82). Do not delete the
   wrapper; React Flow requires it.

7. **The 47 ms `GLOBAL_CONTEXT_TICK_MS` constant** — verify the actual
   value in `GlobalContextBar.tsx` before hoisting. The audit says 47 ms;
   if the real value is different, use the real value and update this
   spec's acceptance criteria to match.

8. **`types.ts` is load-bearing** — ANY typecheck error caused by the
   rename sweep is probably a consumer file you missed. Grep before
   moving on.

9. **Do not add tests** — there is no test framework in this repo. A
   refactor that introduces a test framework is a separate decision.

10. **HUMAN WRITES LOGIC HERE stubs are sacred.** If any such comment
    appears in your output during a "cleanup" pass, revert the deletion.
    See `tasks/lessons.md` entry #2.

---

## 9. Quick Reference — File Counts

| File | Before | Target |
|---|---|---|
| `server/api/main.py` | 934 | < 150 |
| `client/ui/src/components/PipelineChart.tsx` | 779 | < 300 |
| `client/ui/src/components/DesiredPositionGrid.tsx` | 424 | < 300 |
| `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx` | 453 | < 350 |
| `server/api/ws.py` | 406 | ~360 (hoisted constants only) |
| `server/api/stream_registry.py` | 349 | ~400 (absorbs ManualBlockStore) |
| `server/api/engine_state.py` | 256 | ~300 (adds rerun_and_broadcast) |
| New: `server/api/routers/*.py` | — | ~8 files totalling ~900 LOC |
| New: `client/ui/src/constants.ts` | — | ~15 LOC |
| New: `client/ui/src/components/PipelineChart/` | — | 2 files |
| New: `client/ui/src/hooks/{usePipelineTimeSeries,usePositionEdit,usePositionHover}.ts` | — | 3 files |

---

## 10. Commits (summary, all on `generalisation`)

1. `refactor(phase1): memoize providers, unify symbol naming, fix transformApi env var`
2. `refactor(phase2): typed API boundary, central error handler, camelCase timeseries`
3. `refactor(phase3): split main.py into routers, atomic rerun_and_broadcast, hoist magic numbers`
4. `refactor(phase4): decompose PipelineChart/DesiredPositionGrid, narrow WS subscriptions, hoist constants`
5. `docs: sync architecture/conventions/lessons for convergence refactor` (from /doc-sync)

Each commit stands on its own — passes typecheck, passes syntax check,
runs under `./start.sh`. If any commit cannot meet that bar, stop and
write a handoff note to `tasks/progress.md`.

Never `git add .`. Never `--no-verify`. Never push without explicit user
approval. Never bypass the `server/core/` block — if a tool call is
blocked by the PreToolUse hook, you have violated the spec; stop and
report.

---

## 11. Sign-off

User approved all phases, `symbol` naming, camelCase wire format, codegen
deferral, and one-PR branch strategy during the /kickoff session on
2026-04-09 (Opus 4.6, model `claude-opus-4-6`, commit `66a59e6`). The
fresh executing session does not need to re-confirm these — they are
settled. If the user changes their mind at runtime, update this spec
file in-place rather than forking behavior silently.
