# Agentic Coding Setup Checklist

**What to put in your codebase so an LLM agent can work effectively.**
Distilled from `agentic-coding-playbook.md`.

---

## 1. Agent Instructions File

**File:** `CLAUDE.md` / `.windsurfrules` (root of repo)

The single file loaded into every agent session. Keep it **under 100 lines**. Contains:

- **Build & test commands** — exact CLI for build, test (full + single), lint, typecheck
- **Code style rules** — import style, error handling pattern, formatting conventions
- **Architecture summary** — layer names + dependency direction (one sentence), with file path pointers to deeper docs
- **Workflow rules** — typecheck cadence, commit message format, what to preserve on compaction
- **Known gotchas** — project-specific traps the agent would hit without being told (legacy patterns, null vs undefined, platform flags)
- **Debugging directive** — "fix root cause, not symptoms" with examples

**Exclude:** codebase overviews, generic advice, exhaustive API docs, anything the agent already does correctly unprompted. Every line must prevent a specific mistake.

**Format:** Bullet points. When prohibiting something, always state the alternative. Use `IMPORTANT` sparingly. Link to deeper docs by file path, never inline them.

---

## 2. Context Documents

Structured docs the agent reads on demand. The instructions file is the table of contents; these are the chapters.

### `docs/architecture.md`
- System overview (one paragraph: what it is, who it serves)
- Component map (directory → responsibility, one line each)
- Data flow (request path from input to output)
- Key design decisions (decision + rationale, not just the decision)
- Boundaries & contracts (response wrappers, error base classes, event schemas)

### `docs/conventions.md`
- File organization rules (one export per file, 300-line cap, naming scheme)
- Patterns used (Result type, repository pattern, DI style)
- Patterns avoided (inheritance, default exports, barrel files, magic strings)
- Testing conventions (colocation, naming, mocking rules)

### `docs/decisions.md` (append-only log)
- Each entry: date, context, decision, rationale, consequences
- Never edited, only appended — serves as an audit trail

### `docs/user-journey.md`
- Personas (role, context, goal, technical level, pain points)
- Core flows (entry → action → feedback → error → exit for each)
- Invariants (what the user must never/always see, latency budgets)
- Edge cases (empty states, connection drops, concurrency)

---

## 3. Task Tracking Documents

Files the agent reads **and writes** to maintain state across sessions.

### `tasks/todo.md`
- In-progress items with sub-task checkboxes
- Completed items (for session context)
- Blocked items with reason

### `tasks/lessons.md`
- Date-stamped entries of mistakes and corrections
- Agent updates this after every mistake — the self-improvement loop
- Prune entries when the code they reference is refactored away

### `tasks/progress.md` (when mid-task)
- Handoff note: goal, approach, steps done, current status, blockers
- Written by agent at session end so a fresh session can pick up cold

---

## 4. Directory & File Structure

Structural rules that make agents dramatically more effective:

- **300-line hard cap per file** — beyond this, agents lose track and make conflicting edits
- **Flat-ish structure, one concept per file** — agents navigate by filename (`user.service.ts` > 15 levels of nesting)
- **Monorepo when possible** — agent needs schemas, API definitions, and implementation all accessible
- **Schemas in a dedicated directory** — single source of truth for all data shapes (e.g., Zod schemas)
- **Colocated tests** — `foo.service.test.ts` next to `foo.service.ts`

### Recommended Layout

```
project-root/
├── CLAUDE.md / .windsurfrules     # Agent instructions (< 100 lines)
├── docs/
│   ├── architecture.md            # System map
│   ├── conventions.md             # Coding patterns
│   ├── decisions.md               # Decision log (append-only)
│   └── user-journey.md            # UX flows & personas
├── tasks/
│   ├── todo.md                    # Active work
│   ├── lessons.md                 # Mistake log
│   └── progress.md               # Mid-task handoff notes
├── src/
│   ├── schemas/                   # Data shape definitions (source of truth)
│   ├── lib/                       # Shared utilities
│   └── features/                  # Feature modules (flat, one concept per file)
├── test/
│   └── integration/
├── .claude/
│   ├── settings.json              # Hooks config
│   ├── commands/                  # Custom slash commands
│   └── skills/                    # Reusable skill definitions
└── .windsurf/
    ├── rules/                     # Trigger-based rule files
    └── workflows/                 # Workflow definitions
```

---

## 5. Types & Schemas as Source of Truth

Dedicate a directory to canonical data shape definitions (e.g., Zod schemas in `src/schemas/`). Everything else derives from these:

- Controllers validate against them
- Services accept the inferred types
- Repositories map to/from the shapes
- API docs generate from them
- The agent reads them to know what a data entity looks like

Add to your instructions file: *"All data shapes are defined in `src/schemas/`. Read the relevant schema before modifying any feature."*

---

## 6. Operator's Guide

**Files:** `README.md` and/or `DEPLOY.md`

Must contain copy-pasteable instructions for a non-technical reader:

- **Quick Start** — prerequisites (exact versions), clone, install, configure (.env), run (one command), verify (how to confirm it works)
- **Deployment** — step-by-step per environment, required secrets/env vars, verification
- **Troubleshooting** — common failure modes with fixes

Every command must be copy-pasteable. Assume the reader has never used a terminal.

---

## 7. Custom Commands & Workflows

Reusable agent workflows stored as files, not copy-pasted prompts.

| Command | Purpose | Location |
|---------|---------|----------|
| **kickoff** | Session start: load context → plan → pause for approval | `.windsurf/workflows/` or `.claude/commands/` |
| **implement** | Feature build: plan → execute → self-review → doc sync | Same |
| **debug** | Bug fix: reproduce → logic audit → isolate → fix → doc sync | Same |
| **refactor** | Cleanup: logic audit → inventory → audit → fix → doc sync | Same |
| **review** | Code review: correctness, architecture, UX, simplicity | Same |
| **spec** | Feature spec: interview → structured specification | Same |
| **cleanup** | Hygiene sweep: dead code, imports, consistency | Same |
| **doc-sync** | Update all context docs to match reality (runs at end of every workflow) | Same |
| **preflight** | Pre-change check: read schemas, architecture, conventions, identify risks | Same |
| **logic-audit** | Force structural reasoning before code changes (data flow, abstraction count, simplest alternative) | Same |

---

## 8. Hooks & Automated Guardrails

Configure in `.claude/settings.json` or equivalent:

- **Post-edit hook** — auto-format written files (e.g., Prettier)
- **Pre-commit hook** — typecheck + lint (deterministic gate, blocks broken commits)
- **Sensitive-path guard** — block writes to migrations, .env, or security-critical files without explicit approval
- **Structural lint rules** — enforce layer dependencies, file size caps, no circular imports

---

## 9. Component Registry

**File:** `STACK_STATUS.md` or equivalent

Tracks the status of every component: **PROD / MOCK / STUB / OFF**. Updated by the agent via doc-sync whenever a component changes status. Prevents the agent from wiring into mock code thinking it's production.

---

## 10. Doc Sync Protocol (The Feedback Loop)

The mechanism that keeps everything above accurate. Runs at the end of **every** workflow:

1. Update architecture doc — component map, data flow, key files table
2. Update user journey — if any user-facing flow changed
3. Update operator's guide — if deps, env vars, or deploy process changed
4. Update component registry — PROD/MOCK/STUB/OFF status
5. Update conventions doc — verify listed patterns match reality
6. Update lessons log — add new lessons, prune stale ones
7. Update rules file — add missing rules, remove obsolete ones
8. Present all doc changes for human review before commit

If nothing changed in a category, skip it.

---

## Summary: The Minimum Viable Setup

If you're starting from zero, set up in this priority order:

1. **Instructions file** (< 100 lines) — build commands, style rules, architecture pointers, gotchas
2. **Architecture doc** — component map, data flow, design decisions
3. **Schemas directory** — canonical data shapes
4. **300-line file cap** — restructure any file that exceeds it
5. **Task tracking** (`tasks/todo.md`, `tasks/lessons.md`) — session state + self-improvement loop
6. **Kickoff workflow** — automated session start that loads context and plans before coding
7. **Doc-sync workflow** — automated end-of-session doc maintenance
8. **Operator's guide** — copy-pasteable quick start and deploy
9. **Conventions doc** — patterns used, patterns avoided
10. **Hooks** — post-edit formatter, pre-commit typecheck
