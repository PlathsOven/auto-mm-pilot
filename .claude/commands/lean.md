---
description: Aggressive single-axis subtraction pass — hunt dead code, redundancy, and bloat across the repo, then delete it
---

## /lean — Subtraction Pass

A narrow, deep workflow focused on **one axis only: deletion**. Every finding must be something that can disappear with no behaviour change. No canonicalization, no vectorization, no decomposition, no renaming — those belong in `/refactor`. This command exists so a lean pass can be run without the overhead of a full architectural refactor.

**Companion commands:**
- `/cleanup` — lightweight hygiene checklist (imports, naming drift, magic numbers)
- `/refactor` — full 5-phase architecture pass (delete + canonicalize + vectorize + decompose + rename)
- `/lean` — *this command*. Subtraction only, applied exhaustively.

---

### 0. Philosophy

**Core principle:** A lean pass that adds net LOC has failed. The only output this command produces is a smaller, equivalent codebase. When in doubt between "delete" and "keep," delete — if it turns out to matter, `git revert` is cheap; carrying dead weight forever is not.

**What this command does NOT do:**
- Rename variables for clarity
- Rewrite loops as vectorized expressions
- Split god files
- Introduce new abstractions or "cleaner" patterns
- Convert one style to another

If a finding requires any of the above, note it and defer to `/refactor`. This pass is subtraction and only subtraction.

---

### 1. Context Load

Read these first so the sweep respects the hard invariants:
- `CLAUDE.md` — Manual Brain rule, harness sync, surgical commits, schema source-of-truth
- `docs/architecture.md` — Key Files table (what's wired into the production flow) and Component Map
- `docs/stack-status.md` — which components are PROD / MOCK / STUB / OFF (MOCK and STUB files look unused but are load-bearing scaffolding; do not delete)
- `tasks/lessons.md` — recent corrections, especially around sacred stubs

Hard constraints to hold throughout:
- `server/core/` is **HUMAN ONLY** — read-only audit. Never edit or delete files under this path.
- `# HUMAN WRITES LOGIC HERE` stubs are **sacred** — never remove, even if the enclosing function appears unused.
- Files flagged in `docs/stack-status.md` as MOCK / STUB (e.g. `DailyWrap.tsx`, `server/api/llm/context_db.py`, `server/api/llm/test_investigation.py`) are intentional scaffolding — do not delete without human approval, even if the call graph says they're orphans.
- Entry-point defaults that frameworks auto-wire (`App.tsx`, `main.tsx`, FastAPI routers registered via `include_router`) look orphan to naïve grep — exclude them.

---

### 2. Scope

Ask the user:
- **Full codebase** (excluding `server/core/`) — default
- **Single lane** — `client/ui/`, `server/api/`, `pitch/`, etc.
- **Specific files or directories**

---

### 3. Sweep — Deletion Candidates

Scan every file in scope. For every candidate, record: `path:line | category | reason | projected LOC saved | risk (low/med/high)`.

#### 3A. Orphan Files

- [ ] Files that nothing imports anywhere in the project.
- Verify by grepping every named export of the file across the repo. If every export has zero external importers, the file is an orphan.
- Exclusions: framework entry points (`App.tsx`, `main.tsx`, `index.ts` entry bundles), FastAPI routers auto-registered via `include_router(...)`, files listed as MOCK/STUB in `docs/stack-status.md`, files under `server/core/`, files named in the Key Files table of `docs/architecture.md`.

#### 3B. Unused Exports & Symbols

- [ ] `export` declarations (TS) or public functions/classes (Python) with zero importers.
- [ ] Private top-level symbols in a file that are defined but never referenced inside the file.
- [ ] Interface / type aliases with no consumers.
- Verify every candidate via repo-wide grep of the symbol name before flagging.

#### 3C. Trivial Wrappers & Pass-Throughs

- [ ] Functions whose entire body is `return otherFn(args)` or a single delegating call with no transformation.
- [ ] Re-export shims — files whose only job is `export { X } from "./x"`.
- [ ] Provider / component wrappers that pass props through unchanged.
- For each: propose inlining the caller and deleting the wrapper. If the wrapper's only export is the shim itself, the file goes too.

#### 3D. Single-Callsite Helpers

- [ ] Functions / hooks / components called from exactly one place, ≤10 lines, with no load-bearing abstraction barrier.
- Prefer inlining unless: (a) the helper has domain-named intent that documents something the inlined form would obscure, or (b) a second caller is imminent per `tasks/todo.md`.

#### 3E. Speculative & Vestigial Parameters

- [ ] Function parameters always passed the same value (or always omitted as a default) at every call site. Inspect every call; if never varied, remove.
- [ ] Parameters accepted by the signature but never referenced inside the body. Remove from signature and every call site in the same edit.

#### 3F. Dead Branches & Unreachable Code

- [ ] `if/else` paths that cannot trigger given the current call graph (e.g. a check against an enum value no caller ever passes).
- [ ] Fallback code for cases that can't occur given current typing.
- [ ] Legacy option handlers for options removed from the public API.
- [ ] Functions defined but never reached from any entry point.

#### 3G. Duplicate Logic

- [ ] The same computation, formatting, or conditional expressed in 2+ places with ≥80% overlap.
- Action: delete the duplicate at the less-central callsite and route it through the other. This is the one case where this command may add a single import line to save many duplicated lines elsewhere — still net-negative LOC.

#### 3H. Commented-Out Code & Stale TODOs

- [ ] Multi-line commented-out code blocks with no owner and no linked issue.
- [ ] `TODO` / `FIXME` comments with no owner, no ticket, and no plausible resolution path.
- **Exception:** `# HUMAN WRITES LOGIC HERE` stubs are sacred. Never delete, even if the enclosing function body is empty. These are the Manual Brain interface boundary.

#### 3I. Debug Leftovers

- [ ] `console.log`, `console.debug`, `print()`, `pprint()`, `debugger` statements in non-debug code paths.
- Exclusions: intentional structured logging (e.g. `logger.info(...)`, `console.warn` for user-facing errors), logging statements inside obvious dev-mode guards.

#### 3J. Dependency Bloat

- [ ] Packages listed in `client/ui/package.json` / `server/requirements.txt` that are not imported anywhere.
- [ ] Duplicate packages that serve the same purpose (e.g. `fetch` + `axios`, two date-formatting libs). Keep one; delete the other.
- Verify "unused" by grepping the package name across the relevant lane before flagging.

#### 3K. Placeholder / Abandoned Experiments

- [ ] Stub constants, example data, or scaffolding left from abandoned features (e.g. `const EXAMPLE_ROWS = [...]` never referenced).
- [ ] Half-built components, partial feature branches merged dark.
- Cross-reference `docs/stack-status.md` — if a component is marked OFF or was removed, its residue should go too.

#### 3L. Over-Typed Containers

- [ ] `dict[str, Any]` / `Record<string, unknown>` / `any` used where a real shape already exists in `server/api/models.py` or `client/ui/src/types.ts`.
- Action: tighten to the real shape. This may add a few type annotations (net-neutral lines) but removes runtime fragility — counts as a lean win if it also enables deleting defensive checks downstream.

#### 3M. Hallucinated / Unreachable Imports

- [ ] `import` / `from X import Y` where `Y` does not exist in `X` (LLM hallucination debris).
- [ ] Imports of removed modules that lint hasn't caught yet.

---

### 4. Report

Output a structured kill list grouped by category 3A → 3M:

```
[3X] <path>:<line>
  Category: <e.g. single-callsite helper>
  Reason:   <one line, why this can disappear>
  Action:   delete | inline | collapse
  LOC:      −<n>
  Risk:     low | medium | high
  Verify:   <what grep / test confirms safety>
```

End the report with:
- **Counts** per category (3A through 3M)
- **Projected LOC delta** — must be **negative**. If it isn't, the sweep wasn't deep enough; re-audit before proposing execution.
- **Top 15 highest-impact deletions** ranked by `LOC saved × (1 / risk)`
- **Execution order** — dependency-graph-aware: orphan files first (least risk of breaking anything else), then unused exports, then wrappers / single-callsite helpers, then parameter removal, then branches / duplicates / comments / debug / deps last.
- **Things that look like bloat but aren't** — ≤5 items where surface-level bloat has hidden value (real abstraction barriers, external contracts, load-bearing MOCK scaffolding). Record these so the next `/lean` pass doesn't re-flag them.

**STOP. Do NOT delete anything yet. Wait for explicit approval of the kill list and execution order.**

---

### 5. Execution

After approval, work category by category in the approved execution order.

**Per-category procedure:**
1. Stage the deletions for that category only (may span multiple files).
2. For each file touched: read the full file first, then apply deletions via `Edit` (batch all deletions in one file in sequential `Edit` calls or a single multi-edit where supported).
3. If a symbol was deleted, grep for its name repo-wide and update / remove every reference in the same category batch — never leave a dangling import.
4. If a file was deleted, update every import of it in the same batch.
5. After the category's edits, re-run verification (see §6) before moving to the next category.

**Execution rules:**
- **NEVER modify `server/core/`.** Report findings; skip.
- **`# HUMAN WRITES LOGIC HERE` stubs are sacred.** Never remove.
- **Surgical edits.** No drive-by fixes. If you spot a rename opportunity or a pattern divergence mid-deletion, note it for the next `/refactor` — do not touch it here.
- If a deletion turns out to break something unexpected, revert that specific deletion and flag it in the report with the reason it couldn't be removed. Continue with the rest of the category.
- Never use `--no-verify`. Never bypass hooks.

---

### 6. Verification

After each category's deletions:

```bash
python -m compileall server/ -q
```

```bash
npm --prefix client/ui run typecheck 2>&1 | head -50
```

Fix import / typing fallout in the same category batch. If a fix requires changing non-trivial logic, revert the deletion — this command is subtraction only; logic changes go to `/refactor`.

---

### 7. Commit

One surgical commit per category, using native git only. Example message shapes:

```bash
git add <files...>
git commit -m "chore(lean): delete orphan files — <n> files, −<loc> LOC"

git add <files...>
git commit -m "chore(lean): remove unused exports across <lane>"

git add <files...>
git commit -m "chore(lean): inline single-callsite helpers in <lane>"

git add <files...>
git commit -m "chore(lean): drop speculative parameters from <function list>"

git add <files...>
git commit -m "chore(lean): prune unused dependencies from <manifest>"
```

Never `git add .`. Never `git add -A`. Never `--no-verify`. Never push unless explicitly asked.

End the session by appending the total LOC delta and category counts to the final user message so the net-lean outcome is visible.
