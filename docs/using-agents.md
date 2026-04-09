# Using Coding Agents on Auto-MM-Pilot

This is the operator's playbook for coding this repo with the help of AI agents. Two harnesses are supported: **Claude Code** (primary) and **Windsurf** (secondary). Both run the same slash commands with byte-identical bodies. Pick whichever tool you prefer — or use both.

If you read only one line of this document, read this one: **`server/core/` is HUMAN ONLY.** Agents may read it. They must never write to it. A `PreToolUse` hook in `.claude/settings.json` blocks any `Edit`/`Write`/`MultiEdit`/`NotebookEdit` against a path containing `server/core/`. The rule is enforced mechanically; the rest of this guide assumes you won't try to route around it.

---

## 1. One-time setup

Do this once per machine. Skip to §2 if you've already done it.

1. **Clone the repo and install dependencies.**
   ```bash
   git clone https://github.com/PlathsOven/auto-mm-pilot.git
   cd auto-mm-pilot
   pip install -r requirements.txt
   npm --prefix client/ui install
   ```

2. **Create `.env` at the repo root** with at minimum:
   ```
   OPENROUTER_API_KEY=sk-or-v1-your-key
   APT_MODE=mock
   ```
   See `README.md` §Quick Start for the full list.

3. **Confirm the stack runs locally** before involving any agent:
   ```bash
   ./start.sh
   ```
   Open `http://localhost:5173`, verify the connection indicator shows **CONNECTED**, then stop the stack. If `./start.sh` fails, fix it before running an agent — agents cannot debug a broken bootstrap.

4. **Install your preferred harness.**
   - **Claude Code (primary):** install the CLI, open the repo directory, and confirm the `.claude/commands/` slash commands appear in the slash-command palette.
   - **Windsurf (secondary):** open the repo in Windsurf; the `.windsurf/workflows/` commands will load automatically.

5. **Verify the Manual Brain hook is active (Claude Code only).** Open a Claude Code session in the repo and ask the agent to `Write` a file at a fake path like `/tmp/server/core/verify.txt`. The tool call must fail with `BLOCKED: server/core/ is HUMAN ONLY (Manual Brain rule). See AGENTS.md.` If it succeeds, the hook isn't loaded — restart the session and try again. **Do not proceed with agent coding until this verification passes.**

---

## 2. Every session starts the same way

1. **Open the repo in your harness.** The agent auto-loads `AGENTS.md` as its top-level instructions.

2. **Run `/kickoff` with your task description.** For example:
   ```
   /kickoff add a "copy to clipboard" button on each cell of the desired position grid
   ```
   You can also run `/kickoff` with no arguments and then describe the task when prompted.

3. **Wait for the plan.** `/kickoff` reads `tasks/todo.md`, `tasks/progress.md`, and the relevant source files, then outputs a structured plan:
   - **Goal** — one sentence
   - **Approach** — one paragraph
   - **Files to create/modify** — explicit paths
   - **Verification** — how you'll know it works
   - **Risks/open questions** — anything you need to answer

4. **Review the plan carefully.** This is the cheapest place to catch a misunderstanding. Ask clarifying questions, reject scope you don't want, or ask the agent to investigate further before committing to an approach.

5. **Approve explicitly.** Say `go` / `proceed` / `approved` only when the plan is what you actually want. A vague "sure" or silent pass-through is how scope creep happens.

---

## 3. Pick the command that matches the task

After `/kickoff`, the agent (or you) selects the right follow-up command. Use this decision tree:

| If the task is… | Use | Notes |
|---|---|---|
| A new feature bigger than one file | `/spec` → `/implement` | `/spec` writes a full spec to `tasks/spec-<name>.md` before any code. |
| Building an approved plan | `/implement` | Auto-invokes `/preflight` if the plan touches >3 files or crosses the client/server API boundary. |
| Fixing a bug | `/debug` | Auto-invokes `/logic-audit` after 2 failed fix attempts (prevents patch-thrashing on structural bugs). |
| Cleaning up drift in an area | `/refactor` | Preserves the 246-line vibe-code-rescue methodology. Runs a Phase 0 logic audit before any code changes. |
| Auditing a PR or another agent's work | `/review` | 10-point checklist covering correctness, architecture, conventions, user journey, security, performance, logical simplicity, slop, test coverage, root cause. |
| Periodic hygiene sweep | `/cleanup` | Dead code, unused imports, duplicate deps. Never removes `# HUMAN WRITES LOGIC HERE` stubs. |
| About to touch >3 files or cross the API boundary | `/preflight` | Read-only: loads schemas, maps blast radius, checks lessons, identifies risks. Ends with a plan and a pause. |
| Stuck, or an area feels too complicated | `/logic-audit` | 6-step structural review. Ends with findings; never modifies code. |
| After a work session, before committing | `/doc-sync` | Walks every context doc and updates what changed. |

Rule of thumb: **start with `/kickoff` every time, then let the plan dictate which command comes next.** Don't jump straight into `/implement` or `/debug` without a plan.

---

## 4. What happens during the work

Once you approve a plan, the agent executes it. Your job during execution:

1. **Read every diff the agent proposes** before it lands. Don't rubber-stamp — if a change looks wrong, say so. Agents correct well when you point at a specific file and line.

2. **Watch for scope creep.** If the agent starts editing files outside the approved plan, stop it. Ask why. If the reason is legitimate, approve the new scope explicitly; if not, revert.

3. **Verification runs automatically at the end of the turn** (via the `Stop` hook in `.claude/settings.json`): client typecheck + server `compileall` + harness drift check. If any of these fail, the agent should fix them before proposing a commit. If the agent misses a failure, point at the hook output yourself.

4. **If the agent gets stuck:**
   - **Bug fix failing 2+ times in a row:** tell the agent to run `/logic-audit`. Two failed fixes almost always means the bug is structural and surface patches won't hold.
   - **Plan no longer matches reality:** interrupt, describe what you see, ask for a revised plan.
   - **Agent touches `server/core/`:** the hook will block it. Don't work around the block — investigate the underlying need. The Manual Brain rule exists because that code is legally and mathematically sensitive.

5. **Agent asks for approval on a non-trivial decision:** give a direct answer. "Yes / no / use option B" is far better than "up to you" — agents trained to defer will stall waiting for a signal.

---

## 5. Verify and commit

The agent will propose commits with explicit `git add <files>` and a conventional commit message. **You approve each commit individually.**

1. **Read the commit message.** It should describe *why*, not just *what*. If it's vague ("update files"), ask for a better one.

2. **Read the file list.** The agent stages specific paths. If anything unexpected is in the list, ask why.

3. **Run `git diff --cached` yourself** if you want an extra safety check before approving.

4. **Say `commit`** (or whatever approval phrase your harness recognizes). The agent runs the commit locally.

5. **Never push unless you explicitly ask.** The harness is configured to never auto-push. If you want the change on the remote, say `git push origin HEAD` or use `gh pr create`.

6. **Commit messages use conventional prefixes:** `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`. Agents enforce this by default.

**Never allow `git add .` or `git add -A`.** Only explicit paths. This prevents `.env` files, build artifacts, or other junk from leaking into a commit. If you catch the agent proposing `git add .`, stop it and ask for the explicit file list.

---

## 6. Between sessions

Three files hold session-crossing state. Know them.

- **`tasks/todo.md`** — active work tracker. Three sections: In Progress, Completed This Session, Blocked. Agents read this at `/kickoff` to restore context.
- **`tasks/progress.md`** — mid-task handoff. If a session ends before a task finishes, the agent writes a handoff note here so the next session can resume. At the top of every `/kickoff`, the agent checks whether `progress.md` has an unfinished handoff and asks whether to resume it.
- **`tasks/lessons.md`** — the self-improvement log. Every time an agent makes a mistake and you correct it (or an approach succeeds in a non-obvious way), the lesson lands here. The next agent reads it during `/preflight`. Keep it pruned — stale lessons are worse than no lessons.

At the end of a productive session, skim the diff between `tasks/todo.md` at session start and session end. If anything's out of sync, fix it before closing the session.

---

## 7. When things go wrong

| Symptom | Cause / Fix |
|---|---|
| Agent tries to edit `server/core/` and gets blocked | The hook is working. Don't work around it — investigate why the change seems necessary. If the Brain actually needs to change, that's a human task; open `tasks/progress.md` with the findings. |
| `/debug` keeps failing on the same bug | Invoke `/logic-audit`. Two failed fixes = structural problem. Surface patches won't hold. |
| Pydantic model and TypeScript interface have drifted | Pydantic is upstream. Update `client/ui/src/types.ts` to match `server/api/models.py`. See `docs/conventions.md` §Schemas. |
| WebSocket stops updating after a server code change | Singleton WS ticker didn't restart. Call `restart_ticker()` via an admin request, or restart the server entirely. Documented in `AGENTS.md` §Known Gotchas. |
| Slash command body diverged between `.claude/commands/` and `.windsurf/workflows/` | The `Stop` hook's drift-check will print `DRIFT: <name> differs…`. Open both files; whichever was edited most recently is correct; make the other match byte-for-byte. Commit both together. |
| Agent proposes to add a new dependency | Pause. Check `requirements.txt` / `package.json` — does something already cover the need? If not, justify the new dep explicitly before approving. |
| Agent hallucinates an import or function that doesn't exist | Grep for the target before running the change. If the agent keeps doing this in one area, run `/cleanup` on that area to flag all hallucinated references at once. |
| `tasks/progress.md` handoff is stale or wrong | Delete it. Stale handoffs are worse than no handoffs — the next session will act on the wrong context. |
| `.claude/settings.json` hook changes don't take effect | Hooks load at session start, not hot-reload. Close the session and reopen it. |

---

## 8. Dual-harness rule (important if you edit a slash command)

Slash commands live in **two** locations:

- `.claude/commands/<name>.md` — Claude Code
- `.windsurf/workflows/<name>.md` — Windsurf

**Their bodies must be byte-identical.** Only the YAML frontmatter may differ. If you edit a command — to fix a typo, adjust a step, add a new rule — you must edit **both files** in the **same commit**. The `Stop` hook runs a drift-check on every agent turn and will print `DRIFT: <name> differs…` if the two diverge.

To check for drift manually:
```bash
for f in .claude/commands/*.md; do
  name=$(basename "$f")
  wf=".windsurf/workflows/$name"
  diff <(sed '/^---$/,/^---$/d' "$f") <(sed '/^---$/,/^---$/d' "$wf") >/dev/null \
    || echo "DRIFT: $name"
done
```

Zero output = clean.

---

## 9. The five things that matter most

If you forget this document, remember these five rules:

1. **`server/core/` is HUMAN ONLY.** The hook enforces it. Don't work around it.
2. **Always `/kickoff` first.** Never jump into `/implement` or `/debug` without a plan.
3. **Review every diff, approve every commit.** Agents are fast; you are the brake.
4. **Never `git add .`** — always explicit paths. Never push without asking.
5. **Write lessons down.** Every correction becomes a line in `tasks/lessons.md`. That's how the agent gets smarter on your specific codebase.

Everything else in this document is detail. These five are the spine.

---

## Reference

- `AGENTS.md` — the rules the agents read (you should read it too)
- `docs/architecture.md` — component map, MVP pipeline, Key Files table
- `docs/conventions.md` — patterns used, patterns avoided, schema source-of-truth
- `docs/decisions.md` — append-only decision log
- `docs/user-journey.md` — trader + operator personas, core flows
- `docs/stack-status.md` — PROD / MOCK / STUB / OFF per component
- `tasks/todo.md`, `tasks/progress.md`, `tasks/lessons.md` — session-crossing state
- `.claude/commands/` and `.windsurf/workflows/` — the 10 slash commands
- `.claude/settings.json` — hooks (PreToolUse block + Stop verification)
