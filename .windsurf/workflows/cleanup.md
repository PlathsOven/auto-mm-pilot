---
description: Periodic codebase hygiene sweep to reduce entropy and prevent bloat
---

## /cleanup — Codebase Hygiene

### 1. Context Load
Read `CLAUDE.md` and `docs/conventions.md` so you know which patterns are canonical and which are drift.

### 2. Scope
Identify the lane or directory to sweep. Default to the full codebase.

### 3. Sweep Checklist
Scan every file in scope for:

**Dead Code**
- Unused functions, variables, or classes
- Commented-out code blocks (remove unless marked with a TODO that has an owner)
- Unreachable branches

**Import Hygiene**
- Unused imports
- Duplicate imports
- Imports that could be narrowed (e.g., importing entire module when only one function is used)
- Hallucinated imports — every `from X import Y` target must actually exist (common vibe-code debris)

**Dependency Hygiene**
- Packages in manifests (`package.json`, `requirements.txt`) that are no longer imported anywhere
- Duplicate packages that serve the same purpose (`fetch` + `axios`, Polars + Pandas, etc.)

**Consistency**
- Naming conventions that diverge from the established pattern
- Inconsistent error handling approaches within the same lane
- Hardcoded values that should be extracted to config or named constants
- Magic numbers without a named constant

### 4. Report
Output a categorized list of findings with file paths and line numbers. Do NOT auto-fix yet. Wait for human approval of the sweep scope before touching anything.

### 5. Fix (if approved)
Apply fixes one category at a time. After each category:
- Re-run verification: `npm --prefix client/ui run typecheck` + `python -m compileall server/ -q`
- Confirm no regressions

### 6. Commit
One surgical commit per category. Stage explicit paths only:

```bash
git add <files...>
git commit -m "chore: cleanup <lane> — <category>"
```

Never `git add .`. Never `--no-verify`. Never push unless explicitly asked.
