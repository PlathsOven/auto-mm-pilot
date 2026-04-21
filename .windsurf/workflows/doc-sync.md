---
description: Walk all context docs + sync check after a work session to keep documentation current
---

## /doc-sync — Documentation Sync Protocol

After a work session that created or modified code, walk the eight checkpoints below. **Skip any checkpoint where nothing changed.** Present all proposed doc edits for human review before committing.

### 1. `docs/architecture.md`
Verify the component map and Key Files table still match reality. If a file was added, moved, or renamed, update the row. If a lane's purpose changed, update the lane description.

### 2. `docs/user-journey.md`
Update if any user-facing flow changed — new panel, new affordance, new error state, new latency target.

### 3. `README.md` (operator's guide)
Update if prerequisites, env vars, deploy steps, or troubleshooting changed. `README.md` is the single operator's guide for both local dev and production deployment — there is no separate `DEPLOY.md`.

### 4. `docs/stack-status.md`
Update PROD / MOCK / STUB / OFF for any component whose status transitioned this session. Add new rows for new components.

### 5. `docs/conventions.md`
Verify the listed patterns still match code reality. Flag any new pattern that appeared in this session — was it a deliberate choice (document it) or a drift (flag for cleanup)?

### 6. `tasks/lessons.md`
Add any new lesson learned from a correction or failed attempt this session. Prune entries that are no longer accurate (the code has changed).

### 7. `CLAUDE.md`
Add any rule that would have prevented a mistake made this session. Remove any rule that is now obsolete. **Hard cap: under 100 lines.** If adding a rule would push it over, absorb an existing rule first.

### 8. Harness Sync Check
For every slash command in `.claude/commands/*.md`, verify the body matches `.windsurf/workflows/<same-name>.md` byte-for-byte (ignoring frontmatter). If any command was edited this session, confirm both files were updated. A Stop hook in `.claude/settings.json` runs this check automatically, but run it manually here as well to catch any drift before it lands in a commit.

Approximate command:
```bash
for f in .claude/commands/*.md; do
  name=$(basename "$f")
  wf=".windsurf/workflows/$name"
  [ -f "$wf" ] || { echo "DRIFT: $wf missing"; continue; }
  diff <(sed '/^---$/,/^---$/d' "$f") <(sed '/^---$/,/^---$/d' "$wf") >/dev/null \
    || echo "DRIFT: $name differs between .claude/commands and .windsurf/workflows"
done
```

### 9. Present
Show the human every proposed edit grouped by file. **Do not commit until approved.** When committing, use a single `docs:` commit that lists all touched files explicitly.
