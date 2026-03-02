---
description: Structured bug isolation restricted to transport and UI layers
---

## /debug — Bug Isolation & Fix

### 1. Context Load
Read `AGENTS.md` to understand the MVP pipeline and visibility barrier.

### 2. Reproduce
Gather details about the bug:
- What is the expected behavior?
- What is the actual behavior?
- Which layer does it appear in? (UI, adapter, API transport, WebSocket)

### 3. Isolate
Narrow down the root cause. Work through these layers in order:
1. **UI rendering** (`client/ui/`) — component state, props, display logic
2. **Data transport** (`client/adapter/`, `server/api/`) — serialization, WebSocket messages, API routes
3. **Data format** — schema mismatches between client and server

**CRITICAL:** If the bug appears to originate in `server/core/`, STOP. Report your findings and let the human investigate. Do NOT modify core logic to work around the bug.

### 4. Fix
Apply the minimal fix that addresses the root cause:
- Prefer upstream fixes over downstream workarounds
- Add descriptive error messages or logging if the failure mode was silent
- Do not refactor unrelated code while fixing

### 5. Verify
- Confirm the fix resolves the reported behavior
- Run available verification commands (typecheck, lint)
- Check that no regressions were introduced in adjacent functionality

### 6. Commit
List exact files changed and propose the surgical commit:
```bash
.cascade/commands/commit-push-pr.sh "fix: <description>" <file1> <file2> ...
```
