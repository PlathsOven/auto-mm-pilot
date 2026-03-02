---
description: Core feature implementation loop with built-in dependency gating and self-review
---

## /implement — Feature Implementation

### 1. Context Load
Read `AGENTS.md` to restore project architecture and conventions.

### 2. Confirm Lane
Identify your assigned directory lane from the user's prompt. If no lane is specified, ask before proceeding. You may ONLY create/modify files within this lane.

### 3. Plan
Output a step-by-step implementation plan. Include:
- Files to create or modify (full paths)
- Any new dependencies needed, with justification
- How the change connects to the MVP pipeline (reference step numbers from AGENTS.md)

**Do NOT write any code yet. Pause and wait for explicit approval.**

### 4. Execute
Implement the approved plan. Follow these rules:
- Only touch files within your confirmed lane
- For any Python file touching MVP steps 4–6, use empty function bodies with `# HUMAN WRITES LOGIC HERE`
- Add all necessary imports at the top of each file
- Follow existing code style and naming conventions in the lane

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

Report any issues found. If clean, proceed to step 7.

### 7. Doc Sync
If your changes introduced any of the following, you MUST update `AGENTS.md` and/or `README.md`:
- New directories or files that change the project structure → update the directory tree in `README.md` and the Directory Lanes table in `AGENTS.md`
- New dependencies or tech stack additions → update Tech Stack in `AGENTS.md`
- Changes to the MVP pipeline or data flow → update MVP Pipeline in `AGENTS.md`
- New key files → update Key Files tables in both `AGENTS.md` and `README.md`

If no architectural changes were made, skip this step.

### 8. Verify
Run available verification commands (typecheck, lint, build) appropriate to the lane:
- **client/**: `npm run typecheck` or equivalent
- **server/**: `python -m py_compile` on changed files, or `mypy`/`ruff` if configured

Report results.

### 9. Commit
List the exact files you modified. Propose the surgical commit command:
```bash
.cascade/commands/commit-push-pr.sh "<conventional commit message>" <file1> <file2> ...
```
Wait for approval before executing.
