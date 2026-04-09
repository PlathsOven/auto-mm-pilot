---
description: Pre-change context load + risk assessment before touching any non-trivial area of the code
---

## /preflight — Pre-Change Checklist

Run before any change that touches more than one file, crosses the client/server boundary, or edits an area you have not read in this session. Preflight catches problems cheaply — at read-time instead of commit-time.

**When to run:**
- Before `/implement` on any task touching >3 files
- Before `/debug` on a bug with unclear origin
- Before any change crossing the Pydantic ↔ TS interface boundary
- When editing a file >300 lines

---

### 1. Load Schemas at the Boundary

If the change will touch any data that crosses the API boundary:
- Read `server/api/models.py` (Pydantic — Python shapes, source of truth)
- Read `client/ui/src/types.ts` (TypeScript shapes — must mirror Pydantic)

If the two diverge for any field you intend to touch, stop and align them **before** touching feature code. Pydantic is upstream.

### 2. Load Architecture & Conventions

- `docs/architecture.md` — confirm the component map still matches reality; identify the lane you will work in
- `docs/conventions.md` — confirm the patterns you intend to use are the established ones; flag any deviation

If the file you are about to edit is not in the Key Files table, that is a finding — either add it to the table as part of this task, or the table is stale.

### 3. Map the Blast Radius

For each file you intend to modify, grep for its importers:
- Python: `grep -rn "from server\.<module>" server/` or `grep -rn "import <name>" server/`
- TypeScript: `grep -rn "from '.*<module>'" client/ui/src/`

List every file that depends on what you're about to change. A change that looks local but is imported by 15 files is not local.

### 4. Check the Lessons Log

Read `tasks/lessons.md` and search for any entry that mentions:
- The file you are about to touch
- The pattern you intend to use
- The error mode your change could produce

If there's a relevant lesson, honor it. Lessons exist because the mistake already happened once.

### 5. Manual Brain Check

Does any file you intend to edit live under `server/core/`? If yes — **STOP**. You cannot write, modify, or refactor anything under `server/core/`. Report the need to the human and do not propose code changes for that lane.

Does your change require that `server/core/` behavior change to succeed? If yes — **STOP** and escalate. Do not patch around the Brain.

### 6. List Files to Modify

Output an exhaustive list of files you will create, modify, or delete. Include:
- Full path
- One-line reason per file
- Predicted line-count delta (rough)
- Whether the file is inside your confirmed lane

If any file is outside the lane implied by the task, justify it explicitly or move that change into a separate task.

### 7. Identify Risks

For this specific change, enumerate:
- **Schema drift risk** — could this leave Pydantic and TS out of sync?
- **WS ticker risk** — does this touch state the singleton WS ticker reads? (Hot reload will need `restart_ticker()`.)
- **MOCK/PROD drift** — does this touch a component currently MOCK in `docs/stack-status.md`?
- **Latency risk** — does this add work to the per-tick hot path?
- **Auth risk** — does this touch `/ws/client` or any API-key-gated endpoint?

Flag each applicable risk with a one-line mitigation.

### 8. Present the Plan

Output a structured plan:

```
## Preflight: <task summary>

### Files to modify
- <path> — <reason> — (~<±lines>) — lane: <lane>

### Importers / blast radius
<file → list of importers>

### Schemas touched
<models.py | types.ts | neither>

### Lessons applied
<lesson reference or "none applicable">

### Risks
- <risk> → <mitigation>

### Plan
1. <step>
2. <step>
```

**STOP. Wait for explicit approval** before touching any file. Preflight is a read-only phase.
