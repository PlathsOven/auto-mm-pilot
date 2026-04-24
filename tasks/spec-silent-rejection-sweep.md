# Spec: Silent-rejection sweep (M4 follow-up)

**Status:** Draft — ready for `/implement`. Authored 2026-04-23.

**Context:** Follow-up to `tasks/spec-llm-orchestration.md` (M4 §10.2). Completes the feedback loop by logging proposals that were surfaced to the trader but neither confirmed nor explicitly cancelled — i.e. the trader walked away.

## Overview

A small background sweep running inside the FastAPI process tracks outstanding Build-mode proposals in an in-memory per-user map. Proposals that survive longer than the silent-rejection threshold without a commit or a preview-rejection are flagged and written to `llm_failures` with `signal_type="silent_rejection"`. The map is volatile (lost on restart) — this is intentional: silent rejection is a signal for the product team, not an audit-critical record, and durability is not worth the extra plumbing.

## Requirements

### User stories
- As a product analyst, I want silent-rejection events logged so I can see which preset / synthesis paths the trader abandons at the preview step — abandonment is a stronger signal than an explicit cancel because it implies the preview didn't even warrant a decision.

### Acceptance criteria
- [ ] When `/api/blocks/preview` runs for a user, a pending-proposal entry is registered in an in-memory map with a wall-clock timestamp + the payload's `stream_name` + `conversation_turn_id` (optional; may be null if the preview was called outside a Build converse turn).
- [ ] When `/api/blocks/commit` runs, the corresponding pending entry is removed (matched on user_id + stream_name; delete-all-matching semantics).
- [ ] When `POST /api/llm/failures` receives `signal_type="preview_rejection"`, the corresponding entry is removed (matched on user_id + `metadata.stream_name` when present).
- [ ] A background sweep runs every `silent_rejection_sweep_interval_secs` (spec default 30s); for every entry older than `silent_rejection_threshold_secs` (spec default 120s), it logs an `llm_failures` row with `signal_type="silent_rejection"`, `trigger="idle_timeout"`, and removes the entry.
- [ ] The sweep runs inside the FastAPI lifespan — started in `lifespan` on startup, stopped on shutdown via `asyncio.CancelledError`.
- [ ] The sweep is idempotent under concurrent mutations (register/commit/cancel can run while the sweep is iterating).
- [ ] If the sweep coroutine crashes, it logs and restarts itself — the sweep never silently dies.
- [ ] Bounded memory: each user's pending-proposal list is capped (e.g. 32 entries); on overflow, the oldest entry is evicted and logged as `silent_rejection` eagerly.

### Performance
- Cold path — no latency impact on the trader-facing flow. One dict insert on preview, one dict delete on commit / cancel.
- Sweep runs every 30s, iterating a single dict keyed by user_id. O(total pending proposals across users) per sweep; at typical volume (<100 open proposals globally) this is sub-millisecond.

### Security
- Map is process-local; no network, no external services, no additional auth surface.
- Logged rows stay in the existing `llm_failures` table with the existing FK to `users.id` — same access boundary as M4.

## Technical Approach

The pending map lives in a new `server/api/llm/pending_proposals.py` module — same lane as the other orchestration helpers. API surface:

```python
def register(user_id: str, stream_name: str, conversation_turn_id: str | None) -> None
def resolve(user_id: str, stream_name: str) -> None  # matches + removes
def sweep() -> list[SweepHit]  # returns entries that breached the threshold (idle-timeout logging is the caller's job)
```

A `PendingProposal` dataclass stores `created_at`, `stream_name`, `conversation_turn_id`. The top-level `_pending: dict[str, list[PendingProposal]]` is guarded by an `asyncio.Lock` — register/resolve/sweep all acquire it.

The background sweep lives in `server/api/llm/silent_rejection_sweep.py`: a `run_sweep_forever(config)` coroutine that loops `asyncio.sleep(interval)` → `sweep()` → log-each-hit → `asyncio.CancelledError` on shutdown. It's launched from `server/api/main.py`'s `lifespan` handler alongside `init_db()`.

### Data shape changes
- No ORM changes. `llm_failures` already supports `signal_type="silent_rejection"` and `trigger="idle_timeout"` (spec §9.2).
- No Pydantic / TS changes. No new endpoints.

### Files to create
- `server/api/llm/pending_proposals.py` — in-memory per-user map + register / resolve / sweep helpers.
- `server/api/llm/silent_rejection_sweep.py` — `run_sweep_forever(config)` coroutine.

### Files to modify
- `server/api/routers/build.py` — after the `build_preview` call in `blocks_preview`, call `pending_proposals.register(user.id, payload.stream_name, None)`. After successful commit in `blocks_commit`, call `pending_proposals.resolve(user.id, payload.stream_name)`. In `log_llm_failure` when `signal_type == "preview_rejection"`, also call `pending_proposals.resolve(user.id, metadata.get("stream_name"))` defensively.
- `server/api/main.py` — in `lifespan`, start the sweep task with `asyncio.create_task(run_sweep_forever(get_llm_orchestration_config()))`; cancel + await it on shutdown.
- `server/api/llm/orchestration_config.py` — already has `silent_rejection_threshold_secs` (120s) and `silent_rejection_sweep_interval_secs` (30s). Add one more knob: `pending_proposals_max_per_user: int = 32` (env var `LLM_PENDING_PROPOSALS_MAX_PER_USER`).

## Test Cases
- **Happy:** preview registers → commit resolves → sweep finds nothing.
- **Silent-rejection:** preview registers → no commit, no cancel → sweep (after threshold + interval) logs one `llm_failures(signal_type="silent_rejection")` row + removes the entry.
- **Explicit cancel still works:** preview registers → `POST /api/llm/failures` with `preview_rejection` → entry removed. Sweep after threshold finds nothing. `preview_rejection` row lands; no `silent_rejection` row.
- **Commit beats sweep by a hair:** preview registers → commit runs at threshold + 1s → entry removed before sweep — no `silent_rejection` row.
- **Concurrent users:** 100 users each with 1 open preview → sweep logs 100 rows on the same tick without corruption.
- **Overflow eviction:** one user opens 33 previews without committing any → 33rd triggers eviction of the oldest, which is logged immediately as `silent_rejection` with `metadata={"reason": "overflow"}`.
- **Shutdown:** FastAPI shutdown cancels the sweep cleanly — no zombie task, no traceback beyond `asyncio.CancelledError`.
- **Sweep crash recovery:** artificially raise inside the sweep → `run_sweep_forever` catches, logs, sleeps 5s, retries. After one full recovery cycle, normal sweeping resumes.

## Out of Scope
- **Durable pending-proposal storage.** Lost on restart — acceptable because silent_rejection is an analytics signal and restarts are rare.
- **Client-side "navigation-away" detection.** The sweep runs server-side only; the client is not modified. Abandonment is detected by the passage of time, not by the client notifying on unmount.
- **Retroactive backfill.** Proposals from previous runs are never recovered.
- **Per-user threshold overrides.** A single global `silent_rejection_threshold_secs` applies to all users; tuning per user is not in scope.
