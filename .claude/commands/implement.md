---
description: Core feature implementation loop with built-in dependency gating and self-review
---

## /implement — Feature Implementation

### 1. Context Load
Read `CLAUDE.md` and `docs/architecture.md` to restore project structure, lane ownership, and the MVP pipeline. If the task touches data that crosses the API boundary, also read `server/api/models.py` and `client/ui/src/types.ts`.

### 2. Confirm Lane
Identify your assigned directory lane from the user's prompt (see Component Map in `docs/architecture.md`). If no lane is specified, ask before proceeding. You may ONLY create/modify files within this lane.

### 3. Plan
Output a step-by-step implementation plan. Include:
- Files to create or modify (full paths)
- Any new dependencies needed, with justification
- How the change connects to the MVP pipeline (reference step numbers from `docs/architecture.md`)

**If the plan touches >3 files, or crosses the client/server boundary, invoke `/preflight` first** and incorporate its risk findings into this plan.

**Do NOT write any code yet. Pause and wait for explicit approval.**

### 4. Execute
Implement the approved plan. Follow these rules:
- Only touch files within your confirmed lane
- For any Python file touching MVP steps 4–6, use empty function bodies with `# HUMAN WRITES LOGIC HERE` — never write logic inside `server/core/`
- Add all necessary imports at the top of each file
- Follow existing code style and naming conventions in the lane (see `docs/conventions.md`)

### 5. Dependency Gate
If you added any new package during execution:
- State what was added and why
- Confirm no existing package in the codebase already covers this need
- Pause for approval if any dependency is non-trivial (i.e., not a standard lib or already in the manifest)

### 6. Self-Review
Before reporting completion, audit your own work:
- [ ] No files modified outside assigned lane
- [ ] No core trading logic written (only stubs where needed)
- [ ] No dead code or unused imports
- [ ] Error handling present for network/IO operations
- [ ] Consistent naming with existing codebase conventions
- [ ] Pydantic ↔ TypeScript schemas still aligned if boundary was touched

Report any issues found. If clean, proceed to step 7.

### 7. Doc Sync
Delegate to `/doc-sync`. That workflow walks every context doc (`docs/architecture.md`, `docs/user-journey.md`, `README.md`, `docs/stack-status.md`, `docs/conventions.md`, `tasks/lessons.md`, `CLAUDE.md`) and updates only what changed this session. Skip this step only if your changes made **zero** user-visible, architectural, dependency, or status changes.

### 8. Verify
Run available verification commands appropriate to the lane:
- **client/**: `npm --prefix client/ui run typecheck`, then `npm --prefix client/ui run build` if touching build-affecting files
- **server/**: `python -m compileall server/ -q`

Report results. Do not proceed to commit if either fails.

### 9. Commit
List the exact files you modified. Stage and commit surgically:

```bash
git add <file1> <file2> ...
git commit -m "<conventional commit message>"
```

**Never** use `git add .` or `git add -A`. Never push unless the user explicitly asks. Never bypass hooks with `--no-verify`. Wait for approval before executing the commit.
