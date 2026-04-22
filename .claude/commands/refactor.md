---
description: Architecture review and refactoring pass — canonicalize patterns, delete bloat, vectorize, decompose, rename for Polars-native legibility
---

## /refactor — Vibe-Code Rescue & Refactor

Tames AI-assisted repos that accumulate **pattern drift** — the same intent expressed N different ways because each section was generated in a separate conversation. Detects drift, converges on canonical patterns, locks them in.

### 0. Philosophy

**Target reader:** a non-technical derivatives trader who writes Polars pipelines in Python and basic React dashboards. Every function must be legible to this person in <30s.

**Core principle:** vibe-coded repos need *convergence* and *subtraction*, not more abstraction. Fewer patterns, fewer layers, fewer lines. Two approaches for one intent → pick the simpler, kill the other. **Every /refactor pass must remove more LOC than it adds.**

**Refactoring priorities (strict order):**
1. **Canonicalize** — one pattern per intent, enforced everywhere
2. **Minimize** — delete / inline / collapse anything that doesn't earn its keep (unused exports, thin wrappers, single-callsite helpers, speculative parameters, duplicated logic, pass-through indirection)
3. **Vectorize** — scalar loops → columnar ops so logic scales with data size
4. **Decompose** — god files/functions → single-purpose modules (only when splitting *reduces* complexity)
5. **Name** — domain vocabulary in every identifier

### 1. Context Load

Read these before touching anything:
- `CLAUDE.md` — harness rules, code style, schema source-of-truth
- `docs/architecture.md` — component map, MVP pipeline, Key Files table, boundaries
- `docs/conventions.md` — patterns used vs. avoided, file organization, commit format
- `docs/stack-status.md` — which components are PROD / MOCK / STUB / OFF
- **When scope includes `sdk/`** — `docs/sdk-quickstart.md` (the public ergonomic contract) and `sdk/posit_sdk/__init__.py` (the `__all__` export set). Symbols in `__all__` are a customer-facing contract; renames and deletions need a version-bump decision, not a silent trim.

Hard constraints: stay within your approved lane; surgical commits only (never `git add .`).

### 2. Scope

Ask the user:
- **Full codebase** — default
- **Single lane** (e.g., `client/ui/`, `server/api/`, `pitch/`)
- **Specific files**

### 3. Inventory — Map Before You Cut

Build a structural map before auditing code quality.

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

Scan for multiple implementations of the same intent (the defining pathology of vibe code):

- [ ] **Multiple HTTP client patterns** — some files use `fetch`, others use `axios`, others use a custom wrapper. Pick one, kill the rest.
- [ ] **Multiple state management approaches** — mixing `useState` + prop drilling, Context, and ad-hoc global objects. Converge on one.
- [ ] **Multiple serialization paths** — DataFrame → dict done differently in each file. Establish one `serialize` utility.
- [ ] **Multiple error handling styles** — some files use try/catch, some use `.catch()`, some use error boundaries, some swallow errors silently. Establish one pattern per layer.
- [ ] **Multiple ways to define the same type** — an interface in `types.ts`, a duplicate in a component file, a third in an API file. Single source of truth.
- [ ] **Inconsistent async patterns** — mixing `async/await`, `.then()` chains, and callbacks within the same layer.
- [ ] **Franken-paradigms** — class-based components next to functional components, OOP services next to plain functions. Pick one per layer.

For each divergence found, propose the **canonical pattern** (the simplest, most Polars-native one) and list every file that needs to converge.

### 4. Deep Audit — Code Quality

Audit every file against these pillars. Be ruthlessly critical — vibe-coded repos are full of "works but wrong" code.

#### 4A. Vectorization & Scalar Elimination

- [ ] **Row-by-row iteration** — `for row in ...`, `.iterrows()`, `.iter_rows()`, `.apply(lambda ...)` → replace with columnar Polars expressions (`with_columns`, `filter`, `group_by().agg()`) or NumPy broadcast ops
- [ ] **Python-loop aggregation** — manual accumulators (`total = 0; for x in ...: total += x`) → `.sum()`, `.agg()`, `.fold()`
- [ ] **Scalar conditionals over collections** — per-element `if/else` → `pl.when().then().otherwise()` or `np.where()`
- [ ] **Parallel arrays / dicts-of-lists** — tabular data stored as multiple aligned containers → consolidate into a single Polars DataFrame. This is critical: when a new instrument or stream is added, only the DataFrame grows — no code changes needed.
- [ ] **Loose positional args** — functions that take `(price, vol, strike, expiry, ...)` as separate floats → take a single DataFrame row or struct so the signature doesn't break when fields are added
- [ ] **Manual string templating over data** — building SQL/JSON/prompt strings with f-strings inside loops → build once with DataFrame column expressions

#### 4B. Dead Weight & Bloat

Hunt for anything that can be deleted, inlined, or collapsed without changing behaviour. Record `path:line | problem | action (delete/inline/collapse) | impact | effort | risk`.

- [ ] **Unused exports** — `export` declarations (TS) or public functions (Python) with zero importers across the project. Confirm via repo-wide grep of the symbol name before deleting. Exception: React entry defaults (`App.tsx`, `main.tsx`), FastAPI router symbols auto-wired by include/registration, and any symbol in `sdk/posit_sdk/__init__.py.__all__` — those are a public contract, not dead weight; deletion requires a version-bump decision.
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
- [ ] **Stale TODO/FIXME** — no owner and no issue ticket → resolve or delete.
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

#### 4G. SDK Surface & Ergonomics (only when scope includes `sdk/`)

Customer-facing integration surface — the shape the external user sees matters more than internal cleanliness. Quickstart promises "integration in under ~30 minutes"; each finding below is evidence that promise is slipping.

- [ ] **Time-to-first-success bloat** — the `docs/sdk-quickstart.md` Hello World must stay ≤20 lines. If a change adds a required call or argument to get a first position update, either revert the requirement or collapse it into an existing atomic call.
- [ ] **Validation delayed until I/O** — a bad input that could have been caught at construction (Pydantic validator, `__post_init__`) but instead raises on the first network round-trip. Move validation upstream so the error fires where the bad value was created, not where it was transmitted.
- [ ] **Multi-step setup where one call suffices** — a sequence of calls always invoked in order (`create_stream` → `configure_stream` → `set_bankroll`) that should be collapsed into one atomic helper (see `bootstrap_streams`). Partial failures must roll back.
- [ ] **Error types without an actionable fix** — every raised exception class should appear in `docs/sdk-quickstart.md`'s error cheatsheet with a named fix. If the user can't tell what to do from the message alone, the message is broken.
- [ ] **Silent-zero footguns** — a "valid" input path that produces plausible-looking zeros downstream instead of an error (canonical case: omitting `market_value` collapses `edge` → `desired_pos` to 0). Must emit one `WARNING` per stream per client lifetime; never fail silently.
- [ ] **Asymmetric REST/WS behaviour** — the same logical call must behave the same way across transports, or the divergence must be loud (one WARN per state transition, not per call).
- [ ] **Idempotent setup** — any setup helper (`upsert_stream`, `bootstrap_streams`) must be safe to re-run on every process launch. A feeder that crash-loops must not create duplicate streams or leave partial state.
- [ ] **Public symbol creep** — anything in `sdk/posit_sdk/__init__.py.__all__` that isn't load-bearing for the quickstart or a documented advanced flow. Every exported symbol is a backward-compat liability; stop adding them speculatively.
- [ ] **Docstring drift from quickstart** — the class/method docstring says one thing, `docs/sdk-quickstart.md` says another. Converge on one source of truth (prefer the quickstart; update docstrings to match).

**Backward-compat rule for §4G findings:** a `/refactor` pass over `sdk/` may *add* ergonomic helpers, *tighten* validation, *improve* error messages, and *widen* what a public symbol accepts. It may NOT silently rename or remove a symbol in `__all__`, change the shape of an existing public return type, or narrow a validator in a way that rejects previously-valid input — those are breaking changes requiring a version bump, deprecation window, or explicit user decision.

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

### 6. Refactor Execution

After approval, work in this strict order:

#### Phase 0 — Logic Audit
Invoke `/logic-audit` on the highest-impact area from §5. A structural simplification at the root often eliminates 50% of downstream refactor work. If the current shape is already near-minimal, proceed to Phase 1; if a deeper redesign surfaces, pause and present the alternative before continuing.

#### Phase 1 — Delete & Inline (§4B)
Delete / inline / collapse every approved §4B finding. Reduces surface for every subsequent phase. LOC delta should be sharply negative; if not, revisit §4B.

#### Phase 2 — Canonicalize Patterns (§3.1)
Apply the elected canonical pattern everywhere for each divergence. Highest-leverage phase — makes the codebase feel like one person wrote it.

#### Phase 3 — Vectorize (§4A)
Replace scalar loops with columnar operations. Consolidate parallel arrays into DataFrames. Refactor signatures to accept DataFrames instead of loose args.

#### Phase 4 — Decompose & Modularize (§4C)
Split god files, extract shared types, enforce dependency direction. Move misplaced files.

#### Phase 5 — Rename & Annotate (§4D)
Apply domain naming, add type hints, extract magic numbers to named constants.

**Per-file procedure:**
1. Read the full file
2. Apply edits via `multi_edit` (batch all changes to one file in one call)
3. If a signature changed, grep all call sites and update atomically in the same phase
4. If a file was moved/renamed, update all imports in the same batch
5. Re-read the file after editing to confirm it's clean

**Execution rules:**
- If a refactor touches >5 files, pause after each file and verify syntax before continuing
- Preserve comments and docstrings unless provably wrong or stale
- If you discover a new issue mid-refactor, note it but do NOT fix it — it goes in the next `/refactor` cycle

### 7. Regression Check

After each phase (not just at the end):

```bash
python -m compileall server/ -q
```

```bash
npm --prefix client/ui run typecheck 2>&1 | head -50
```

Fix any errors before moving to the next phase. If a fix would be non-trivial, revert the breaking edit and flag it for the user.

### 8. Doc Sync

Delegate to `/doc-sync`. Refactors frequently touch:
- `docs/architecture.md` — file locations, Key Files table, MVP pipeline
- `docs/conventions.md` — newly canonicalized patterns (add), deprecated patterns (remove)
- `docs/stack-status.md` — component status transitions
- `tasks/lessons.md` — add any lesson surfaced by the audit
- `CLAUDE.md` — only if a load-bearing rule changed
- `docs/sdk-quickstart.md` — if any `sdk/posit_sdk/` public export, exception type, or default changed, re-verify the Hello World listing and the error cheatsheet table still compile and match reality.

Skip categories where nothing changed.

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
