# Progress

Mid-session handoff notes. When a task is not finished at the end of a session, or when context is about to be compressed, write a handoff here so the next session can pick up cleanly.

## Status

## Convergence refactor (spec-refactor-convergence.md) — 2026-04-09

**Goal:** Execute all 4 phases of `tasks/spec-refactor-convergence.md` — pattern convergence + root-cause cleanup — on branch `generalisation`, single PR at the end.

**Approach:** Work phase by phase, strictly in spec order. No re-audit. Verification (`typecheck` + `compileall`) between phases. One commit per phase.

**Steps done:**
- [x] Phase 1 — Stop the bleeding: providers memoized, `asset` → `symbol` unified on the wire and in consumers, `transformApi.ts` routed through `apiFetch`, stale `AGENTS.md` refs updated to `CLAUDE.md` in `docs/architecture.md` + `docs/using-agents.md`, dead `DailyWrap.tsx` row removed from the Key Files table.

**Discovered during Phase 1:** `client/ui/src/components/LlmChat.tsx:47` had a pre-existing unused `isUser` variable that failed `tsc --noEmit`. Not introduced by the refactor — verified against a clean stash of the baseline. Removed it inline to unblock Phase 1 verification (trivial 1-line fix); logged here as the single off-spec delta so reviewers are aware.

**Current status:** Phase 1 edits staged in the working tree. Both `npm --prefix client/ui run typecheck` and `python -m compileall server/ -q` pass clean. Ready to commit Phase 1.

**Next step:** Commit Phase 1, then start Phase 2 (typed API boundary).


## Handoff Note Format

When writing a handoff, use this template:

```markdown
## <Task name> — <YYYY-MM-DD>

**Goal:** <one sentence — the outcome the user wants>

**Approach:** <one paragraph — the chosen strategy, not all alternatives>

**Steps done:**
- [x] <concrete step> — <file path or artifact>
- [x] <concrete step>

**Current status:** <what state the repo is in right now — staged? committed? broken tests?>

**Blockers:** <anything that needs a human decision or is waiting on an external>

**Next step:** <the very next thing to do on resume>
```
