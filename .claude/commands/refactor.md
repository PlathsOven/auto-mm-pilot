---
description: Comprehensive architecture review and refactoring pass — vectorize, modularize, simplify for Polars-native readability
---

## /refactor — Vibe-Code Rescue & Refactor

A structured workflow for taming codebases built primarily through AI-assisted "vibe coding." Vibe-coded repos accumulate a specific class of entropy — not bugs, but **pattern drift**: the same intent expressed N different ways because each section was generated in a separate conversation. This workflow detects that drift, converges on canonical patterns, and locks them in.

---

### 0. Philosophy

**Target reader:** a non-technical derivatives trader who writes Polars pipelines in Python and basic React dashboards. Every function must be legible to this person in under 30 seconds.

**Core principle:** Vibe-coded repos don't need more abstraction — they need *convergence*. The goal is fewer patterns, not more layers. When two approaches exist for the same thing, pick the simpler one and kill the other everywhere.

**Refactoring priorities (strict order):**
1. **Canonicalize** — one pattern per intent, enforced everywhere
2. **Vectorize** — scalar loops → columnar ops so logic scales with data size
3. **Decompose** — god files/functions → single-purpose modules
4. **Name** — domain vocabulary in every identifier
5. **Delete** — if it's not called, it's gone

---

### 1. Context Load

Read these files and internalize the constraints before touching anything:
- `AGENTS.md` — harness rules, Manual Brain, code style, schema source-of-truth
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

#### 4B. Dead Weight (Vibe-Code Specific)

Vibe coding leaves specific debris. Hunt it aggressively.

- [ ] **Abandoned experiments** — half-built features, commented-out blocks, functions called from nowhere. If it's not in the active call graph, delete it.
- [ ] **Hallucinated APIs** — calls to functions, methods, or library APIs that don't actually exist (LLMs hallucinate these). Grep for every import and verify the target exists.
- [ ] **Stale TODO/FIXME** — if a TODO has no owner and no issue ticket, resolve or delete it. (Exception: `# HUMAN WRITES LOGIC HERE` stubs are sacred.)
- [ ] **Vestigial parameters** — function params that are accepted but never used inside the body. Remove from signature and all call sites.
- [ ] **Copy-paste artifacts** — variable names that reference a different context (e.g., `userList` in a file about instruments) because the code was copy-pasted from another file.
- [ ] **Debug leftovers** — `console.log`, `print()`, `debugger` statements in non-debug code paths.

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

**STOP. Do NOT refactor yet. Wait for explicit approval of the report, canonical pattern choices, and execution order.**

---

### 6. Refactor Execution

After approval, work in this strict order:

#### Phase 0 — Logic Audit
Before cutting any code, invoke `/logic-audit` on the highest-impact area identified in §5. A structural simplification at the root often eliminates 50% of the downstream refactor work — do it before you touch the surface. If the audit reveals the current shape is already near-minimal, proceed to Phase 1. If it reveals a deeper redesign, pause and present the alternative to the human before continuing the refactor.

#### Phase 1 — Delete Dead Weight (§4B)
Remove orphaned files, dead functions, hallucinated imports, debug leftovers. This reduces noise for all subsequent phases.

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
- `AGENTS.md` — only if a load-bearing rule changed

Skip categories where nothing changed.

---

### 9. Commit

One surgical commit per phase, using native git only:

```bash
git add <files...>
git commit -m "refactor(phase1): delete dead weight — orphaned files, debug leftovers"

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
