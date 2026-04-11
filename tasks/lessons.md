# Lessons

Self-improvement loop. Every time an agent is corrected — by the user, by a failed build, by a review comment — the lesson is recorded here so the same mistake is not repeated. This file is read by `/kickoff`, `/preflight`, and `/refactor` at the start of their context loads.

Format per entry: **Rule.** Then `Why:` (what went wrong, so edge cases can be judged later) and `How to apply:` (when this rule kicks in).

---

## Never modify `server/core/`

**Why:** The core math is the product and the IP. A subtle sign error or off-by-one in variance computation produces plausible-looking numbers that silently destroy PnL. The blast radius of a bad edit here is unbounded, and the bug is very hard to catch in review.

**How to apply:** Any tool call that would `Edit` or `Write` a file under `server/core/` stops immediately. If a bug traces into `server/core/`, document the findings in `tasks/progress.md` and hand off to the human — do not "fix" it. A PreToolUse hook in `.claude/settings.json` enforces this at the tool level, but the rule is the primary authority.

---

## `# HUMAN WRITES LOGIC HERE` stubs are sacred

**Why:** These stubs mark the Manual Brain interface. They tell the human "this is where the math goes." If an LLM removes them during cleanup or refactor (thinking they are dead code), the human loses the map of what still needs to be written.

**How to apply:** During `/cleanup`, `/refactor`, or any sweep that removes "unused" code, explicitly skip lines containing `HUMAN WRITES LOGIC HERE`. If you are tempted to delete one because "the function isn't called anywhere," do not. Check with the human first.

---

## Surgical commits only — never `git add .` or `git add -A`

**Why:** The repo has multiple concurrent agents and hand-edits. A blanket `git add .` can accidentally stage an unrelated file, a stray `.env`, a half-finished experiment, or a file another agent is mid-edit on. Once staged and committed, the damage is visible in history.

**How to apply:** Every commit lists exact paths: `git add path1 path2 path3 && git commit -m "..."`. If you find yourself tempted to use `.` or `-A`, stop and list the paths explicitly. Commit messages follow conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).

---

## ECharts types are exported under aliased names

**Why:** `CallbackDataParams` is the internal name in ECharts but it's exported as `DefaultLabelFormatterCallbackParams`. Using the internal name causes TS2460. The tooltip formatter signature also expects `TopLevelFormatterParams` (union of single + array), not just the single variant.

**How to apply:** When typing ECharts callbacks, import `DefaultLabelFormatterCallbackParams` (alias to `CallbackDataParams` locally if desired), and for tooltip formatters accept `CallbackDataParams | CallbackDataParams[]` to match the expected `TopLevelFormatterParams` union. For chart click handlers, use `ECElementEvent` (exported directly).
