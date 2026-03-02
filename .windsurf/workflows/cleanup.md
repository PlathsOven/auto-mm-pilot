---
description: Periodic codebase hygiene sweep to reduce entropy and prevent bloat
---

## /cleanup — Codebase Hygiene

### 1. Context Load
Read `AGENTS.md` and `.windsurfrules`.

### 2. Scope
Identify the lane or directory to sweep. Default to the full codebase excluding `server/core/`.

### 3. Sweep Checklist
Scan every file in scope for:

**Dead Code**
- Unused functions, variables, or classes
- Commented-out code blocks (remove unless marked with a TODO)
- Unreachable branches

**Import Hygiene**
- Unused imports
- Duplicate imports
- Imports that could be narrowed (e.g., importing entire module when only one function is used)

**Dependency Hygiene**
- Packages in manifests (`package.json`, `requirements.txt`) that are no longer imported anywhere
- Duplicate packages that serve the same purpose

**Consistency**
- Naming conventions that diverge from the established pattern
- Inconsistent error handling approaches within the same lane
- Hardcoded values that should be extracted to config

### 4. Report
Output a categorized list of findings with file paths and line numbers. Do NOT auto-fix yet.

### 5. Fix (if approved)
Apply fixes one category at a time. After each category:
- Re-run verification (typecheck, lint)
- Confirm no regressions

### 6. Commit
```bash
.cascade/commands/commit-push-pr.sh "chore: cleanup <lane>" <file1> <file2> ...
```
