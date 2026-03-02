---
description: Code review audit for lane compliance, quality, and convention adherence
---

## /review — Code Review

### 1. Context Load
Read `AGENTS.md` and `.windsurfrules` to restore conventions.

### 2. Scope
Identify the files/lane to review. This may be:
- A specific lane directory (e.g., `client/adapter/`)
- A set of recently changed files
- Another agent's completed work

### 3. Audit Checklist
Review every file in scope against these criteria:

**Lane Compliance**
- [ ] All changes are within the expected lane directory
- [ ] No modifications to `server/core/` (the Brain)
- [ ] Any cross-lane imports are read-only references, not mutations

**Code Quality**
- [ ] No dead code or commented-out blocks
- [ ] No unused imports
- [ ] No hardcoded values that should be config/env
- [ ] Error handling present for all network/IO/WebSocket operations
- [ ] No overly broad try/except or catch blocks

**Conventions**
- [ ] Naming consistent with existing codebase patterns
- [ ] Stub rule followed: functions touching MVP steps 4–6 have `# HUMAN WRITES LOGIC HERE`
- [ ] No new dependencies added without justification

**Architecture**
- [ ] Visibility barrier respected — no core logic on client side
- [ ] Data flows match the MVP pipeline in AGENTS.md

**Doc Sync**
- [ ] If new directories, dependencies, or pipeline changes were introduced, `AGENTS.md` and `README.md` have been updated accordingly
- [ ] Directory tree in `README.md` matches actual project structure
- [ ] Directory Lanes table in `AGENTS.md` matches actual project structure

### 4. Report
Output a summary:
- **Pass** — no issues found
- **Issues** — list each with file path, line, and recommended fix

### 5. Fix (if requested)
If the user approves fixes, apply them surgically and re-run the audit checklist on changed files only.
