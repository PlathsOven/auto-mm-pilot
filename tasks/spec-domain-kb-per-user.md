# Spec: `domain_kb` per-user SQLite migration

**Status:** Draft — ready for `/implement`. Authored 2026-04-23.

**Context:** Follow-up to `tasks/spec-llm-orchestration.md` §9.6. The existing `domain_kb.json` is file-based and global — every user's corrections accumulate into one shared file, and every user's LLM prompt reads the same KB section. This spec migrates the store to a per-user SQLite table so corrections stay private to the trader who made them. The current file is not backfilled and is deleted after the migration.

## Overview

A new `domain_kb_entries` ORM table keyed on `(user_id, topic)` replaces the global `domain_kb.json` file. The feedback detector's write path (`save_domain_kb_entry`) becomes user-scoped; the prompt-inject read path (`serialize_kb_section`) is user-scoped and called at prompt-build time with the user's id. On first boot after the migration lands, the old `domain_kb.json` file is deleted (the corrections it contains are explicitly not backfilled — each user starts fresh). No new endpoints.

## Requirements

### User stories
- As a trader, I want corrections I made last week to affect my future prompts only — not other traders' prompts — so what the LLM thinks the framework says stays consistent with what I've taught it.
- As a new user signing up today, I want my LLM prompt uncluttered by another trader's old corrections — I start from a clean slate.

### Acceptance criteria
- [ ] A new `domain_kb_entries` table exists in SQLite with columns: `id` (PK autoincrement), `user_id` (FK users, cascade delete), `topic`, `misconception`, `correct_fact`, `why_it_matters`, `created_at`. Unique index on `(user_id, topic)`.
- [ ] `server/api/llm/domain_kb.py`'s `save_entry(entry)` becomes `save_entry(user_id, entry)` — writes one row scoped to the calling user. On `(user_id, topic)` conflict, the existing row's `correct_fact` / `why_it_matters` / `created_at` are updated in place (same-trader refinement — latest observation wins).
- [ ] `serialize_kb_section()` becomes `serialize_kb_section(user_id)` — returns a markdown block containing only that user's entries. Empty string when the user has no corrections.
- [ ] Every caller of `serialize_kb_section` threads `user_id` through: `server/api/llm/prompts/__init__.py::build_system_prompt` adds a `user_id` kwarg; the service + orchestrator pass it in.
- [ ] The feedback detector's `_fanout` writes via the new user-scoped path (`save_domain_kb_entry(user_id, entry)`).
- [ ] On FastAPI lifespan startup, after `init_db()`: if `domain_kb.json` exists in its historical location, it is deleted. No backfill into the new table.
- [ ] If the deletion fails (permissions, EBUSY), a warning is logged and startup continues — the file is at worst an orphan, not a blocker.
- [ ] The migration is one-way — no rollback path. A new file can't accidentally recreate the global behaviour because `domain_kb.save_entry` and `serialize_kb_section` no longer touch the filesystem.

### Performance
- Cold path on write (fires from the feedback detector post-turn).
- Prompt-build read is called once per LLM call (Stages 1–3, investigate, general). For each, a single `SELECT * WHERE user_id = ?` — at typical volumes (<50 entries per user) this is sub-millisecond.

### Security
- Per-user scoping is the whole point. Every read filters by the calling user's id; writes include the user's id. No cross-user leakage.
- FK cascade delete: when a user is deleted, their entries are deleted with them (matches the pattern on every other LLM table).
- No new endpoints, no new auth surface. Existing prompt-build flow handles everything.

## Technical Approach

Add `DomainKbEntry` to `server/api/llm/models.py` as an ORM model alongside `LlmCall` / `BlockIntent` / `LlmFailure` / `UserContextEntry`. Rewrite `server/api/llm/domain_kb.py` to drop the file-based helpers and replace them with two DB-backed functions: `save_entry(user_id, entry)` and `serialize_kb_section(user_id)`. Each thread through `SessionLocal` like the other helpers. `init_db()` registers the new table via the existing `from server.api.llm import models` import.

The file deletion happens in `server/api/main.py::lifespan` after `init_db()`. Use `pathlib.Path.unlink(missing_ok=True)` so the happy path (file already gone) is a no-op. The historical location is computed via the same logic that `domain_kb.py` used (project-root-relative).

### Data shape changes

New ORM model:

```python
# server/api/llm/models.py

class DomainKbEntry(Base):
    """Per-user framework-correction entries written by the feedback detector.

    On ``(user_id, topic)`` conflict, the newer entry refines the older
    one — latest observation wins. The prompt-build layer reads this
    table at every LLM call and injects non-empty entries into a
    ``## DOMAIN KNOWLEDGE`` section appended to the system prompt.
    """

    __tablename__ = "domain_kb_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    topic: Mapped[str] = mapped_column(String(128), nullable=False)
    misconception: Mapped[str] = mapped_column(Text, nullable=False)
    correct_fact: Mapped[str] = mapped_column(Text, nullable=False)
    why_it_matters: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


Index("ix_domain_kb_user_topic", DomainKbEntry.user_id, DomainKbEntry.topic, unique=True)
```

- No Pydantic model needed — the detector's dict shape maps directly into the ORM write.
- No TS types — this is server-internal.

### Files to create
- none

### Files to modify
- `server/api/llm/models.py` — add `DomainKbEntry` + index.
- `server/api/llm/domain_kb.py` — rewrite: remove `_KB_PATH` / `load_kb` / file I/O. Implement `save_entry(user_id, entry)` as a SQLAlchemy upsert (select-then-update-or-insert; SQLite has no native `INSERT ... ON CONFLICT ... DO UPDATE` that SQLAlchemy 2.x emits ergonomically via ORM — the manual pattern matches `user_context.upsert_entry`). Implement `serialize_kb_section(user_id)` as a `SELECT` + markdown formatter.
- `server/api/llm/prompts/__init__.py` — `build_system_prompt` grows a required `user_id: str` kwarg; the final `base + serialize_kb_section(user_id)` uses it.
- `server/api/llm/service.py` — passes `user_id=user_id` into `build_system_prompt`.
- `server/api/llm/build_orchestrator.py` — nothing to do; the orchestrator already threads `user_id`; Stage 2/3 prompts don't include `serialize_kb_section` directly (they use their own composition). **Decision: Build-pipeline stages get the KB section too** — append `serialize_kb_section(user_id)` to the end of each stage's system prompt inside the orchestrator's stage-runner helpers. Matches the Investigate / General flow.
- `server/api/llm/feedback_detector.py::_fanout` — `save_domain_kb_entry(entry)` becomes `save_domain_kb_entry(user_id, entry)`. Already has `user_id` in scope.
- `server/api/main.py::lifespan` — after `init_db()`, run a one-line `_delete_legacy_domain_kb_file()` helper (log + continue on failure).
- Tests (if any) — existing mock integration tests exercise save_entry / serialize_kb_section; update call sites.

## Test Cases
- **First boot after migration:** `domain_kb.json` exists with 3 entries → file is deleted → the 3 entries are NOT in the new table — they're discarded by design.
- **First boot, file already absent:** no error — `unlink(missing_ok=True)` is a no-op.
- **Per-user scoping on write:** User A's detector flags a correction → row lands in `domain_kb_entries` with `user_id=A`. User B's later prompt doesn't include it.
- **Per-user scoping on read:** User A writes 2 entries, User B writes 1 → `serialize_kb_section("A")` returns A's 2; `serialize_kb_section("B")` returns B's 1.
- **Upsert on `(user_id, topic)`:** User A flags "variance summativity" twice → single row; second correct_fact overrides the first; `created_at` advances.
- **Empty state:** New user with no corrections → `serialize_kb_section` returns `""` → prompt is unaffected.
- **Cascade delete:** delete a user row → their `domain_kb_entries` rows go with them.
- **Build-pipeline prompts include KB:** Stage 1/2/3 system prompts all contain the `## DOMAIN KNOWLEDGE` section for the calling user.

## Out of Scope
- **Backfilling existing `domain_kb.json` into the new table.** Per the user, each user starts fresh. If a correction was important, the detector will re-capture it on the next relevant turn.
- **Cross-user "framework facts" promotion.** There is no admin path to promote one user's correction to a global fact. If a correction is universal (e.g. "variance is summative, vol is not") it belongs in `server/api/llm/prompts/core.py::SHARED_CORE`, not in `domain_kb_entries`.
- **A read endpoint or UI.** Developers query SQLite directly; traders see the effects via their prompts only.
- **Migration rollback / dual-read.** The file goes away after one boot; there's no fallback read path.
- **Alembic migrations.** Codebase still uses `Base.metadata.create_all()`; adding Alembic is its own much larger spec.
