---
description: Structured bug isolation restricted to transport and UI layers
---

## /debug — Bug Isolation & Fix

### 1. Context Load
Read `AGENTS.md` and `docs/architecture.md` to understand the MVP pipeline and the client/server visibility barrier. Skim `tasks/lessons.md` for any entry that touches the area of the bug.

### 2. Reproduce
Gather details about the bug:
- What is the expected behavior?
- What is the actual behavior?
- Which layer does it appear in? (UI, adapter, API transport, WebSocket)
- Is there a recent commit or change that correlates with the onset?

### 3. Isolate
Narrow down the root cause. Work through these layers in order:
1. **UI rendering** (`client/ui/`) — component state, props, display logic
2. **Data transport** (`client/adapter/`, `server/api/`) — serialization, WebSocket messages, API routes
3. **Data format** — schema mismatches between `server/api/models.py` (Pydantic) and `client/ui/src/types.ts` (TypeScript)

**CRITICAL:** If the bug appears to originate in `server/core/`, STOP. Report your findings in `tasks/progress.md` and let the human investigate. Do NOT modify core logic to work around the bug. Do NOT patch around the Brain.

### 4. Fix
Apply the **minimal** fix that addresses the root cause:
- Prefer upstream fixes over downstream workarounds
- Fix the root cause, not the symptom — one bug = one fix in one place
- If your diff has a primary fix and a secondary fix, the secondary is probably the real one; reconsider the primary
- Add descriptive error messages or logging if the failure mode was silent
- Do not refactor unrelated code while fixing

**Escalation rule:** if 2 fix attempts have already failed, **STOP and invoke `/logic-audit`** before attempting a third. Two failed fixes usually means the bug is structural and a surface-level patch will not hold.

### 5. Verify
- Confirm the fix resolves the reported behavior
- Run `npm --prefix client/ui run typecheck` and `python -m compileall server/ -q`
- Check that no regressions were introduced in adjacent functionality
- If the bug was caused by schema drift, confirm Pydantic and TS are now aligned

### 6. Commit
List the exact files you modified. Stage and commit surgically:

```bash
git add <file1> <file2> ...
git commit -m "fix: <description>"
```

After the fix lands, add a one-line lesson to `tasks/lessons.md` describing what class of bug this was and how to avoid it next time.
