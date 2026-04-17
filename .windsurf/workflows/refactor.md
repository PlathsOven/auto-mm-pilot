---
description: Architecture review and refactoring pass — canonicalize patterns, delete bloat, vectorize, decompose, rename for Polars-native legibility
---

## /refactor — Vibe-Code Rescue & Refactor

A structured workflow for taming codebases built primarily through AI-assisted "vibe coding." Vibe-coded repos accumulate a specific class of entropy — not bugs, but **pattern drift**: the same intent expressed N different ways because each section was generated in a separate conversation. This workflow detects that drift, converges on canonical patterns, and locks them in.

---

### 0. Philosophy

**Target reader:** a non-technical derivatives trader who writes Polars pipelines in Python and basic React dashboards. Every function must be legible to this person in under 30 seconds.

**Core principle:** Vibe-coded repos don't need more abstraction — they need *convergence* and *subtraction*. The goal is fewer patterns, fewer layers, fewer lines. When two approaches exist for the same thing, pick the simpler one and kill the other everywhere. When one approach exists for a thing that doesn't need doing, delete it entirely. **Every pass of /refactor must remove more LOC than it adds.**

**Refactoring priorities (strict order):**
1. **Canonicalize** — one pattern per intent, enforced everywhere
2. **Minimize** — delete / inline / collapse anything that doesn't earn its keep (unused exports, thin wrappers, single-callsite helpers, speculative parameters, duplicated logic, pass-through indirection)
3. **Vectorize** — scalar loops → columnar ops so logic scales with data size
4. **Decompose** — god files/functions → single-purpose modules (but only when splitting *reduces* complexity; don't decompose for its own sake)
5. **Name** — domain vocabulary in every identifier

---

### 1. Context Load

Read these files and internalize the constraints before touching anything:
- `CLAUDE.md` — harness rules, Manual Brain, code style, schema source-of-truth
- `docs/architecture.md` — component map, MVP pipeline, Key Files table, boundaries
- `docs/conventions.md` — patterns used vs. avoided, file organization, commit format
- `docs/stack-status.md` — which components are PROD / MOCK / STUB / OFF

Hard constraints to hold in memory throughout:
- `server/core/` is **HUMAN ONLY** — audit it, report findings, but NEVER modify it
- All changes must stay within your approved lane
- Surgical commits only — never `git add .`

---

### 2. Scope

Ask the user:
- **Full codebase** (excluding `server/core/`) — default
- **Single lane** (e.g., `client/ui/`, `server/api/`, `pitch/`)
- **Specific files**

---

### 3. Inventory — Map Before You Cut

Before auditing code quality, build a structural map. This catches the macro-level rot that vibe coding produces.

#### 3.0 File Census

For the scope, list every file with:
- **Purpose** (one phrase)
- **Imports from** (which other project files it depends on)
- **Imported by** (which other project files depend on it)
- **Status**: ACTIVE (called in production flow) / ORPHAN (not imported anywhere) / DUPLICATE (>60% overlap with another file)

Output the census as a table. Flag:
- [ ] **Orphaned files** — files that nothing imports. Candidates for deletion.
- [ ] **Duplicate files** — files with substantially overlapping logic (common in vibe-coded repos where a feature was re-prompted from scratch instead of edited). Candidates for merge.
- [ ] **Circular dependencies** — A imports B imports A. Must be broken.
- [ ] **Wrong-layer files** — files that live in one directory but belong in another based on what they actually do (e.g., a "utility" that's really a route handler).

#### 3.1 Pattern Divergence Scan

The defining pathology of vibe code. Scan for multiple implementations of the same intent:

- [ ] **Multiple HTTP client patterns** — some files use `fetch`, others use `axios`, others use a custom wrapper. Pick one, kill the rest.
- [ ] **Multiple state management approaches** — mixing `useState` + prop drilling, Context, and ad-hoc global objects. Converge on one.
- [ ] **Multiple serialization paths** — DataFrame → dict done differently in each file. Establish one `serialize` utility.
- [ ] **Multiple error handling styles** — some files use try/catch, some use `.catch()`, some use error boundaries, some swallow errors silently. Establish one pattern per layer.
- [ ] **Multiple ways to define the same type** — an interface in `types.ts`, a duplicate in a component file, a third in an API file. Single source of truth.
- [ ] **Inconsistent async patterns** — mixing `async/await`, `.then()` chains, and callbacks within the same layer.
- [ ] **Franken-paradigms** — class-based components next to functional components, OOP services next to plain functions. Pick one per layer.

For each divergence found, propose the **canonical pattern** (the simplest, most Polars-native one) and list every file that needs to converge.

---

### 4. Deep Audit — Code Quality

Now audit every file against these pillars. **Be ruthlessly critical.** Vibe-coded repos are full of "works but wrong" code — functional on the happy path, rotten underneath.

#### 4A. Vectorization & Scalar Elimination

Scalar code is the silent scaling killer. Catch it all.

- [ ] **Row-by-row iteration** — `for row in ...`, `.iterrows()`, `.iter_rows()`, `.apply(lambda ...)` → replace with columnar Polars expressions (`with_columns`, `filter`, `group_by().agg()`) or NumPy broadcast ops
- [ ] **Python-loop aggregation** — manual accumulators (`total = 0; for x in ...: total += x`) → `.sum()`, `.agg()`, `.fold()`
- [ ] **Scalar conditionals over collections** — per-element `if/else` → `pl.when().then().otherwise()` or `np.where()`
- [ ] **Parallel arrays / dicts-of-lists** — tabular data stored as multiple aligned containers → consolidate into a single Polars DataFrame. This is critical: when a new instrument or stream is added, only the DataFrame grows — no code changes needed.
- [ ] **Loose positional args** — functions that take `(price, vol, strike, expiry, ...)` as separate floats → take a single DataFrame row or struct so the signature doesn't break when fields are added
- [ ] **Manual string templating over data** — building SQL/JSON/prompt strings with f-strings inside loops → build once with DataFrame column expressions

#### 4B. Dead Weight & Bloat

Every pass of /refactor must reduce LOC and indirection. Hunt aggressively for anything that can be deleted, inlined, or collapsed without changing behaviour. For each finding record `path:line | problem | action (delete / inline / collapse) | impact | effort | risk`.

- [ ] **Unused exports** — `export` declarations (TS) or public functions (Python) with zero importers across the project. Confirm via repo-wide grep of the symbol name before deleting. Exception: React entry defaults (`App.tsx`, `main.tsx`), FastAPI router symbols auto-wired by include/registration.
- [ ] **Trivial wrappers** — functions whose entire body is `return otherFn(args)` or a single delegating call with no transformation. Inline the caller and delete the wrapper (and its file, if that was its only export).
- [ ] **Single-callsite helpers** — functions / hooks / components called from exactly one place that inline in ≤10 lines. Prefer inline unless the abstraction barrier is load-bearing (>1 caller likely, crosses a public boundary, or is domain-named in a way that documents intent).
- [ ] **Abandoned experiments** — half-built features, commented-out blocks, functions never reached from any entry point. If it's not in the active call graph, delete it.
- [ ] **Hallucinated APIs** — calls to functions, methods, or library APIs that don't actually exist (LLMs hallucinate these). Grep for every import and verify the target exists.
- [ ] **Dead branches** — `if/else` paths that cannot trigger given the current call graph; legacy option handlers for options never set; fallback code for cases that can't occur.
- [ ] **Speculative parameters** — function params always passed the same value (or always omitted as a default) at every call site. Inspect every call; if never varied, remove the parameter.
- [ ] **Vestigial parameters** — accepted but never used inside the body. Remove from signature and all call sites.
- [ ] **Duplicate logic** — same computation / conditional / formatting expressed in 2+ places. Extract to one helper (or collapse to the existing one) and update callers.
- [ ] **Re-export / pass-through indirection** — files whose only job is re-exports; classes that wrap a handful of static methods for no gain; providers that just pass props. Inline the consumer's import and delete the shim — *unless* the indirection buys real legibility (e.g., flattening a deeply-nested JSX provider stack).
- [ ] **Over-typed dicts** — `dict[str, Any]` / `Record<string, unknown>` where a narrower typed shape exists or could easily be written. Tighten to the real shape.
- [ ] **Stale TODO/FIXME** — no owner and no issue ticket → resolve or delete. **Exception:** `# HUMAN WRITES LOGIC HERE` stubs are sacred; never remove them.
- [ ] **Copy-paste artifacts** — variable names that reference a different context (e.g., `userList` in a file about instruments) because the code was copy-pasted from another file.
- [ ] **Debug leftovers** — `console.log`, `print()`, `debugger` statements in non-debug code paths.
- [ ] **Placeholder / example data** — "replace with real entries" scaffolding that never got replaced; stub constants from abandoned features.

#### 4C. Modularity & File Hygiene

- [ ] **God files** (>300 lines doing multiple things) — split by responsibility (300-line cap per `docs/conventions.md`)
- [ ] **God functions** (>40 lines) — decompose into named sub-steps
- [ ] **One export per file for non-utility modules** — a component file exports one component, a model file exports one model
- [ ] **Clean dependency direction** — lower layers (config → types → utils → logic → routes → UI) must not import upward
- [ ] **Shared types in one place** — Python: one `models.py` per package. TypeScript: one `types.ts` per feature area. No redefinitions.
- [ ] **Config separate from logic** — no hardcoded URLs, intervals, thresholds, or magic numbers in logic files. Extract to a `config` or `constants` module.

#### 4D. Naming & Readability

The reader is a Polars-native trader. Write for them.

- [ ] **Domain vocabulary in identifiers** — `fair_value`, `target_position`, `annualized_vol`, `bid_ask_spread` — NOT `x`, `tmp`, `val`, `data`, `result`, `item`
- [ ] **Verb-phrase function names** — `compute_fair_value()`, `build_snapshot_df()`, `broadcast_tick()` — NOT `process()`, `handle()`, `run()`, `doStuff()`
- [ ] **Polars pipeline style** — chain reads top-to-bottom like SQL: `df.filter(...).with_columns(...).group_by(...).agg(...)`. No intermediate temp variables unless naming adds genuine clarity.
- [ ] **Flat control flow** — max 2 indentation levels inside a function. If deeper, extract a helper with a descriptive name.
- [ ] **No nested ternaries** — use `if/elif/else` or `pl.when` chains
- [ ] **Full type annotations** — Python: `def f(df: pl.DataFrame) -> pl.DataFrame`. TypeScript: explicit return types on all exports. No `any`.
- [ ] **Named constants** — every magic number gets a `SCREAMING_SNAKE_CASE` name: `SECONDS_PER_YEAR`, `DEFAULT_TICK_MS`, `MAX_RETRY_COUNT`

#### 4E. TypeScript / React (client-side)

- [ ] **No prop drilling >2 levels** — use Context or a provider
- [ ] **No inline styles** — Tailwind classes only
- [ ] **Pure components** — side effects in hooks, not in render
- [ ] **Zero `any` types** — strict typing everywhere
- [ ] **WebSocket payloads typed** via shared interfaces in `types.ts`
- [ ] **No duplicate component variants** — if two components are >70% identical, parameterize one and delete the other

#### 4F. Python / FastAPI (server-side)

- [ ] **Pydantic models** for all API request/response shapes — no raw dicts crossing boundaries
- [ ] **`async def`** for all IO-bound operations (HTTP, file, DB)
- [ ] **No module-level mutable globals** — use explicit singletons with clear init/lifecycle, or FastAPI dependency injection
- [ ] **Polars over Pandas** — migrate any Pandas usage unless a hard external dependency requires it
- [ ] **No bare `except:`** — catch specific exceptions, log them, re-raise or return typed errors

---

### 5. Report

Output a structured report grouped by audit section (3.0 → 4F):

```
[SECTION] <path>:<line>
  Problem:  <one line>
  Current:  <code snippet>
  Fix:      <refactored snippet or approach>
  Impact:   high | medium | low
  Effort:   trivial (<5 min) | moderate (5–30 min) | significant (>30 min)
```

End with:
- **Counts** per section
- **Canonical patterns elected** (from §3.1) — list each pattern choice with rationale
- **Top 10 highest-impact changes** ranked by Impact × (1 / Effort)
- **Execution order** — dependency-graph-aware: shared types first, then utils, then logic, then routes/UI, then tests
- **Projected LOC delta** — sum of `bytes saved` from §4B findings minus new code added by canonicalization / decomposition. Must be negative; if it isn't, the pass isn't net-lean and §4B needs another sweep before execution begins.
- **Things that LOOK like bloat but aren't** — ≤5 items where surface-level bloat has hidden value (real abstraction barriers, external API contracts, load-bearing indirection). Record these so the next /refactor pass doesn't re-flag them.

**STOP. Do NOT refactor yet. Wait for explicit approval of the report, canonical pattern choices, and execution order.**

---

### 6. Refactor Execution

After approval, work in this strict order:

#### Phase 0 — Logic Audit
Before cutting any code, invoke `/logic-audit` on the highest-impact area identified in §5. A structural simplification at the root often eliminates 50% of the downstream refactor work — do it before you touch the surface. If the audit reveals the current shape is already near-minimal, proceed to Phase 1. If it reveals a deeper redesign, pause and present the alternative to the human before continuing the refactor.

#### Phase 1 — Delete & Inline (§4B)
Delete / inline / collapse every §4B finding the report approved. This reduces surface for every subsequent phase — canonicalization has fewer files to touch, vectorization has fewer loops to fix, decomposition has fewer knots to untangle. The LOC delta after this phase should be sharply negative; if it isn't, revisit §4B before moving on.

#### Phase 2 — Canonicalize Patterns (§3.1)
For each pattern divergence, apply the elected canonical pattern everywhere. This is the highest-leverage phase — it makes the codebase feel like one person wrote it.

#### Phase 3 — Vectorize (§4A)
Replace scalar loops with columnar operations. Consolidate parallel arrays into DataFrames. Refactor function signatures to accept DataFrames instead of loose args.

#### Phase 4 — Decompose & Modularize (§4C)
Split god files, extract shared types, enforce dependency direction. Move misplaced files to correct directories.

#### Phase 5 — Rename & Annotate (§4D)
Apply domain naming, add type hints, extract magic numbers to named constants.

**Per-file procedure within each phase:**
1. Read the full file
2. Apply edits via `multi_edit` (batch all changes to one file in one call)
3. If a function signature changed, `grep_search` for all call sites and update them atomically in the same phase
4. If a file was moved/renamed, update all imports in the same edit batch
5. After editing, re-read the file to confirm it's clean

**Execution rules:**
- **NEVER modify `server/core/`** — document needed changes, skip. The Manual Brain rule is absolute.
- **`# HUMAN WRITES LOGIC HERE` stubs are sacred** — never remove them in a cleanup pass.
- If a refactor touches >5 files, pause after each file and verify syntax before continuing
- Preserve comments and docstrings unless provably wrong or stale
- If you discover a new issue mid-refactor that wasn't in the report, note it but do NOT fix it — it goes in the next `/refactor` cycle

---

### 7. Regression Check

After each phase (not just at the end):

```bash
python -m compileall server/ -q
```

```bash
npm --prefix client/ui run typecheck 2>&1 | head -50
```

Fix any errors before moving to the next phase. If a fix would be non-trivial, revert the breaking edit and flag it for the user.

---

### 8. Doc Sync

Delegate to `/doc-sync`. Refactors frequently touch:
- `docs/architecture.md` — file locations, Key Files table, MVP pipeline
- `docs/conventions.md` — newly canonicalized patterns (add), deprecated patterns (remove)
- `docs/stack-status.md` — component status transitions
- `tasks/lessons.md` — add any lesson surfaced by the audit
- `CLAUDE.md` — only if a load-bearing rule changed

Skip categories where nothing changed.

---

### 9. Commit

One surgical commit per phase, using native git only:

```bash
git add <files...>
git commit -m "refactor(phase1): delete & inline — orphans, thin wrappers, speculative params"

git add <files...>
git commit -m "refactor(phase2): canonicalize patterns — <list elected patterns>"

git add <files...>
git commit -m "refactor(phase3): vectorize scalar loops in <lane>"

git add <files...>
git commit -m "refactor(phase4): decompose god files, extract shared types"

git add <files...>
git commit -m "refactor(phase5): rename to domain vocabulary, add type hints"
```

Never `git add .`. Never `--no-verify`. Never push unless explicitly asked. Wait for approval before executing each commit.
