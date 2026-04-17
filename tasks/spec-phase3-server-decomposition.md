# Spec: Phase 3 — Server Decomposition

> **Status:** APPROVED, ready to execute.
> **Parent spec:** `tasks/spec-refactor-convergence.md` (Phases 1-2 already landed).
> **Prerequisite commits:** `64a8f16` (Phase 1), `4c41ee8` (Phase 2) — both on
> `generalisation`.
> **Branch:** stay on `generalisation`. Do NOT open a PR — Phase 4 follows.

---

## 0. Overview

Split `server/api/main.py` (961 LOC) into per-feature router modules so the
file drops to < 150 LOC. Along the way: move the leaky `_manual_streams`
dict into `stream_registry.py` with a proper lock, wrap the repeated
`rerun_pipeline` + `restart_ticker` pair into a single atomic helper, hoist
the two magic numbers in `ws.py` and the two hardcoded timeouts in
`llm/client.py` to `config.py`.

**Non-goal:** changing any endpoint behavior, adding features, or modifying
`server/core/`.

---

## 1. Decisions Already Made (do NOT re-ask)

1. `server/core/` is **HUMAN ONLY**. Never write, modify, or delete anything
   there. A PreToolUse hook enforces this.
2. `# HUMAN WRITES LOGIC HERE` stubs are sacred — never remove them.
3. Branch: `generalisation`. One commit for this phase.
4. Convention: no barrel files. An empty `__init__.py` for `routers/` is fine.
5. Named exports only.

---

## 2. Acceptance Criteria

All of the following must hold after Phase 3:

- [ ] `python -m compileall server/ -q` passes clean.
- [ ] `npm --prefix client/ui run typecheck` passes clean.
- [ ] `./start.sh` → terminal connects → each panel renders → pipeline chart
      populates → block table populates → manual block create/delete round-trip
      → investigation SSE streams → all stream CRUD operations succeed.
- [ ] `server/api/main.py` is **< 150 LOC** (app factory, middleware, router
      includes, exception handler, lifespan, health endpoint, two WS mounts).
- [ ] `server/api/routers/` directory contains 8 router files (see §4).
- [ ] No `rerun_pipeline` + `restart_ticker` pair appears outside
      `engine_state.py`. Every call site uses `rerun_and_broadcast()`.
- [ ] `_manual_streams` module-level dict no longer exists in any file.
      `stream_registry.py` owns manual-block metadata behind a lock.
- [ ] `TICK_INTERVAL_SECS` and `UPDATE_THRESHOLD` are defined in `config.py`
      and imported by `ws.py` — no magic numbers in `ws.py`.
- [ ] `OPENROUTER_TIMEOUT_SECS` and `OPENROUTER_STREAM_TIMEOUT_SECS` are
      defined in `config.py` and imported by `llm/client.py`.
- [ ] `git diff main...HEAD -- server/core/` is empty.

---

## 3. Out of Scope

- **Anything under `server/core/`.** HUMAN ONLY.
- **Client-side changes.** Phase 4 handles those.
- **New tests or a test framework.** No test infra exists.
- **Lint / format tooling.** Already a logged follow-up.
- **Feature work of any kind.**
- **Changing endpoint behavior** — same request → same response, just from
  a different file.

---

## 4. Route Map (verified against Phase 2 state, commit `4c41ee8`)

| New file | Source lines in `main.py` | Endpoints |
|---|---|---|
| `server/api/routers/llm.py` | 173–210 | `POST /api/investigate` |
| `server/api/routers/streams.py` | 216–321 | stream CRUD (5 endpoints) + `_stream_to_response` |
| `server/api/routers/snapshots.py` | 325–358 | `POST /api/snapshots` |
| `server/api/routers/market_pricing.py` | 364–395 | market pricing GET/POST |
| `server/api/routers/bankroll.py` | 401–430 | bankroll GET/PATCH |
| `server/api/routers/transforms.py` | 437–530 | transforms GET/PATCH + `_STEP_LABELS` |
| `server/api/routers/pipeline.py` | 538–701 | `_pipeline_dimensions_sync`, `_parse_expiry`, `_pipeline_timeseries_sync`, two GET endpoints |
| `server/api/routers/blocks.py` | 704–961 | `_blocks_from_pipeline`, 3 block endpoints |

---

## 5. Step-by-Step Execution

### 5.1 Create `server/api/routers/__init__.py`

Empty file. Required by Python for the package.

### 5.2 Create `rerun_and_broadcast` in `engine_state.py`

**File:** `server/api/engine_state.py`

Add at the bottom (after existing functions, ~line 257):

```python
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
    from server.api.ws import restart_ticker  # lazy — circular import guard

    kwargs: dict[str, Any] = {}
    if bankroll is not None:
        kwargs["bankroll"] = bankroll
    if market_pricing is not None:
        kwargs["market_pricing"] = market_pricing
    if transform_config is not None:
        kwargs["transform_config"] = transform_config

    await asyncio.to_thread(rerun_pipeline, stream_configs, **kwargs)
    await restart_ticker()
```

You will also need `import asyncio` at the top of `engine_state.py` (check if
already present).

**WARNING:** The lazy import of `restart_ticker` inside the function body is
**intentional** — hoisting it to the module top triggers a circular import.
Add a comment explaining this if one is not already there.

### 5.3 Move `_manual_streams` into `stream_registry.py`

**File:** `server/api/stream_registry.py`

Add, below the existing imports but before `StreamRegistration`:

```python
@dataclass
class ManualBlockMetadata:
    """Tracks manually-created blocks for source attribution."""
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

Add a module-level singleton:

```python
_manual_block_store: _ManualBlockStore | None = None

def get_manual_block_store() -> _ManualBlockStore:
    global _manual_block_store
    if _manual_block_store is None:
        _manual_block_store = _ManualBlockStore()
    return _manual_block_store
```

**Also:** update `StreamRegistry.delete()` (line 279) to call
`get_manual_block_store().unmark(stream_name)` so deleting a manual block
cleans up the metadata. Today, deleted manual blocks leak.

### 5.4 Hoist magic numbers to `config.py`

**File:** `server/api/config.py`

Add these constants (below the existing ones, e.g. after `POSIT_MODE` on
line 57):

```python
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

Delete lines 29 and 32 (the two constants). Replace with imports:

```python
from server.api.config import POSIT_MODE, TICK_INTERVAL_SECS, UPDATE_THRESHOLD
```

(Replace the existing `from server.api.config import POSIT_MODE` on line 23.)

**File:** `server/api/llm/client.py`

Replace the hardcoded `timeout=30.0` (line 53) with:

```python
from server.api.config import OPENROUTER_TIMEOUT_SECS, OPENROUTER_STREAM_TIMEOUT_SECS
```

And use `timeout=OPENROUTER_TIMEOUT_SECS` and
`timeout=OPENROUTER_STREAM_TIMEOUT_SECS` at the two call sites.

### 5.5 Extract the 8 router files

Each router file follows this template:

```python
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

**Critical details per router:**

#### `routers/llm.py` (from main.py 144–210)
- Moves `_llm_service` singleton + `_get_llm_service()`.
- Moves `POST /api/investigate` handler + SSE `event_generator`.
- Imports: `LlmService`, `InvestigateRequest`, `StreamingResponse`,
  engine state getters (`get_engine_state`, `get_pipeline_snapshot`,
  `get_snapshot_buffer`, `get_mock_now`).

#### `routers/streams.py` (from main.py 216–321)
- Moves `_stream_to_response` helper.
- Moves all 5 stream CRUD endpoints.
- Imports: stream models, `BlockConfig` (from `server.core.config`),
  `StreamRegistration`, `get_stream_registry`.
- **No** `rerun_pipeline` / `restart_ticker` — stream CRUD doesn't re-run.

#### `routers/snapshots.py` (from main.py 325–358)
- Moves `POST /api/snapshots`.
- **Replace** the `rerun_pipeline` + `restart_ticker` pair (lines 343–344)
  with `await rerun_and_broadcast(stream_configs)`.
- Import `rerun_and_broadcast` from `engine_state`.

#### `routers/market_pricing.py` (from main.py 364–395)
- Moves market pricing GET/POST.
- **Replace** the pair (lines 378–379) with
  `await rerun_and_broadcast(stream_configs, market_pricing=req.pricing)`.

#### `routers/bankroll.py` (from main.py 401–430)
- Moves bankroll GET/PATCH.
- **Replace** the pair (lines 417–418) with
  `await rerun_and_broadcast(stream_configs, bankroll=req.bankroll)`.

#### `routers/transforms.py` (from main.py 437–530)
- Moves `_STEP_LABELS` constant + both endpoints.
- **Replace** the pair (lines 521–522) with
  `await rerun_and_broadcast(stream_configs, transform_config=full_config)`.
- Imports: `get_registry` (from `server.core.transforms`).

#### `routers/pipeline.py` (from main.py 538–701)
- Moves `_pipeline_dimensions_sync`, `_parse_expiry`,
  `_pipeline_timeseries_sync`, and 2 GET endpoints.
- No rerun_pipeline calls (read-only endpoints).
- Imports: `polars`, engine state getters, `get_current_tick_ts` from `ws`.

#### `routers/blocks.py` (from main.py 704–961)
- Moves `_blocks_from_pipeline` + 3 block endpoints.
- **Replace** `_manual_streams` dict with `get_manual_block_store()`:
  - `sn in _manual_streams` → `store.is_manual(sn)` (line 757)
  - `_manual_streams[req.stream_name] = {...}` → `store.mark(req.stream_name, _dt.now().isoformat())` (line 852)
- **Replace** the two `rerun_pipeline` + `restart_ticker` pairs (lines
  861–862 and 946–947) with `await rerun_and_broadcast(stream_configs)`.

### 5.6 Trim `main.py` to the shell

After all routers are extracted, `main.py` should contain ONLY:

1. Imports
2. `lifespan` async context manager
3. `app = FastAPI(...)` + CORS middleware + exception handler
4. Router includes:
   ```python
   from server.api.routers.llm import router as llm_router
   from server.api.routers.streams import router as streams_router
   from server.api.routers.snapshots import router as snapshots_router
   from server.api.routers.market_pricing import router as market_pricing_router
   from server.api.routers.bankroll import router as bankroll_router
   from server.api.routers.transforms import router as transforms_router
   from server.api.routers.pipeline import router as pipeline_router
   from server.api.routers.blocks import router as blocks_router

   app.include_router(llm_router)
   app.include_router(streams_router)
   app.include_router(snapshots_router)
   app.include_router(market_pricing_router)
   app.include_router(bankroll_router)
   app.include_router(transforms_router)
   app.include_router(pipeline_router)
   app.include_router(blocks_router)
   ```
5. `GET /api/health`
6. The two WebSocket mounts:
   ```python
   @app.websocket("/ws")
   async def ws_endpoint(websocket: WebSocket) -> None:
       await pipeline_ws(websocket)

   @app.websocket("/ws/client")
   async def ws_client_endpoint(websocket: WebSocket) -> None:
       await client_ws(websocket)
   ```

Target < 150 LOC. The 961-line original → ~120 lines.

### 5.7 Surface silent WS broadcast errors

**File:** `server/api/ws.py` — the `_broadcast` function (line 172).

Currently it silently discards disconnected clients:

```python
except Exception:
    disconnected.append(ws)
```

Change to:

```python
except WebSocketDisconnect:
    disconnected.append(ws)
except Exception:
    log.debug("WS broadcast error for client: %s", type(exc).__name__)
    disconnected.append(ws)
```

Use `log.debug` for the normal disconnect path (already handled by
`WebSocketDisconnect`), and `log.debug` for unexpected exceptions too —
these happen frequently enough that `log.exception` would flood the logs.
The key is distinguishing them from server bugs in the log if someone
needs to investigate.

---

## 6. Verification

```bash
python -m compileall server/ -q
npm --prefix client/ui run typecheck
./start.sh
```

Smoke test every endpoint group from the UI per the acceptance criteria in §2.

---

## 7. Commit

One surgical commit:

```bash
git add server/api/main.py \
        server/api/routers/__init__.py \
        server/api/routers/llm.py \
        server/api/routers/streams.py \
        server/api/routers/snapshots.py \
        server/api/routers/market_pricing.py \
        server/api/routers/bankroll.py \
        server/api/routers/transforms.py \
        server/api/routers/pipeline.py \
        server/api/routers/blocks.py \
        server/api/engine_state.py \
        server/api/stream_registry.py \
        server/api/ws.py \
        server/api/config.py \
        server/api/llm/client.py \
        server/api/client_ws.py \
        tasks/progress.md
git commit -m "refactor(phase3): split main.py into routers, atomic rerun_and_broadcast, hoist magic numbers"
```

Never `git add .`. Never `--no-verify`. Never push unless explicitly asked.

---

## 8. Risks & Gotchas

1. **Circular import: `engine_state` ↔ `ws`** — `rerun_and_broadcast` must
   import `restart_ticker` lazily inside the function body. Do not hoist.
2. **`engine_state.py:76` lazy import of `stream_registry`** — keep it lazy.
   Hoisting triggers a circular import.
3. **`ws.py`'s module-level `_clients` and `_ticker_task` globals are
   intentional** — singleton ticker pattern per `docs/decisions.md`. Do not
   try to refactor them into a class.
4. **`client_ws.py` also calls `rerun_pipeline` + `restart_ticker`** (line
   62–63). Replace with `await rerun_and_broadcast(stream_configs)`.
5. **Pydantic `BaseModel` import in `main.py`** was added in Phase 2 for
   the `ApiError` class. Keep that in `main.py` since the exception handler
   stays there.
6. **The `list_transforms()` endpoint in `routers/transforms.py`** calls
   `get_registry()` from `server.core.transforms`. This is a read-only
   import — allowed per Manual Brain rules.
