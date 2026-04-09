---
description: Code review audit for lane compliance, quality, conventions, user journey, and logical simplicity
---

## /review — Code Review

### 1. Context Load
Read `AGENTS.md` and `docs/conventions.md` to restore the canonical patterns. Skim `docs/architecture.md` to confirm which lanes the change should have stayed within.

### 2. Scope
Identify the files/lane to review. This may be:
- A specific lane directory (e.g., `client/adapter/`)
- A set of recently changed files
- Another agent's completed work
- A PR diff

### 3. 10-Point Audit Checklist

Walk every file in scope against all ten pillars. Be concrete — cite file paths and line numbers for every finding.

**1. Correctness**
- [ ] Does the code do what it claims?
- [ ] Are all documented acceptance criteria (from a spec, if one exists) satisfied?
- [ ] Are error paths handled, not just the happy path?

**2. Architecture & Lane Compliance**
- [ ] All changes stay within the expected lane(s)
- [ ] No modifications to `server/core/` (the Brain — Manual Brain rule)
- [ ] Cross-lane imports are read-only references, not mutations
- [ ] Visibility barrier respected — no core math on the client side
- [ ] Data flows match the MVP pipeline in `docs/architecture.md`

**3. Conventions**
- [ ] Patterns used match the established ones in `docs/conventions.md` (Polars not Pandas, Pydantic at boundaries, async httpx, etc.)
- [ ] Naming is consistent with existing codebase patterns
- [ ] `# HUMAN WRITES LOGIC HERE` stubs are used and not deleted
- [ ] No new dependencies without justification
- [ ] Commit messages follow conventional format

**4. User Journey**
- [ ] The change is grounded in a real persona or flow from `docs/user-journey.md`
- [ ] No raw stack traces or debug messages visible to the trader
- [ ] WS connection state still visible through the change
- [ ] Latency budget (<200ms per tick) respected on the hot path

**5. Security**
- [ ] No secrets committed (API keys, tokens, `.env` contents)
- [ ] Input validated at boundaries (Pydantic, TS interfaces)
- [ ] Auth gates respected on `/ws/client` and any API-key endpoint
- [ ] No credentials in logs

**6. Performance**
- [ ] No scalar loops over DataFrames (no `iterrows`, no per-row Python)
- [ ] No blocking IO in async code paths
- [ ] No unnecessary allocations in the per-tick hot path
- [ ] Caching or memoization used where the inputs justify it

**7. Logical Simplicity**
- [ ] The diff is the simplest shape that satisfies the requirement
- [ ] No accidental complexity (extra layers, wrappers, intermediate DTOs) — see `/logic-audit` §3 for the common smells
- [ ] No abstractions added for hypothetical future requirements
- [ ] If you cannot hold the change in your head after one read, flag it

**8. Slop Indicators**
- [ ] No hallucinated imports (every `from` target actually exists)
- [ ] No copy-paste artifacts (variable names that reference a different context)
- [ ] No commented-out code blocks
- [ ] No abandoned experiments or debug leftovers (`console.log`, `print`, `debugger`)
- [ ] No half-implemented features that are called but don't work

**9. Test Coverage**
- [ ] New logic is covered by at least a smoke test where infrastructure exists
- [ ] Edge cases (empty state, disconnect, malformed input) are exercised
- [ ] Tests are integration-flavored where possible, not mock-heavy for the sake of speed

**10. Symptom vs. Root Cause**
- [ ] Any bug fix in the diff fixes the root cause, not a downstream symptom
- [ ] If the diff has a "primary fix" and a "secondary fix," the secondary is interrogated — it's often the real cause
- [ ] No workarounds for behavior that should be corrected upstream
- [ ] No feature flags or compatibility shims added to avoid fixing the underlying problem

### 4. Doc Sync Check
Delegate to `/doc-sync` (or at minimum verify its checkpoints are clean):
- If new directories, dependencies, or pipeline changes were introduced, `docs/architecture.md` has been updated
- If user-facing flow changed, `docs/user-journey.md` has been updated
- If component status transitioned, `docs/stack-status.md` has been updated
- If a new pattern appeared, `docs/conventions.md` has been updated or the pattern is flagged as drift

### 5. Report
Output a summary:
- **Pass** — no issues found across all 10 pillars
- **Issues** — list each with pillar number, file path, line, severity (blocker / major / minor), and recommended fix

### 6. Fix (if requested)
If the user approves fixes, apply them surgically and re-run the audit checklist on changed files only. Commit each category of fix as its own conventional commit.
