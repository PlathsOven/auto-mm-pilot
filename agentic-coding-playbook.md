# The Agentic Coding Playbook

**A practitioner's guide to building production software with Claude Code, Windsurf Cascade, and similar tools.**

*Synthesized from: Anthropic's official best practices, Boris Cherny's (Claude Code creator) published workflow, OpenAI's harness engineering post, HumanLayer's context engineering research, the SlopCodeBench paper, Addy Osmani's 80% Problem analysis, Martin Fowler's harness engineering article, the OpenSpec methodology, and dozens of practitioner blog posts from 2024–2026.*

---

## Core Principles

### Context Is Everything
Every failure mode in agentic coding traces back to context management. The agent knows nothing except what's in its context window. As utilization climbs past ~40%, performance degrades — hallucinations increase, instructions get ignored, code quality drops. Your entire workflow should be designed to keep context lean, accurate, and focused.

### Docs Are Code
Documentation is not a chore you do after shipping. It is a first-class artifact that the LLM reads, updates, and maintains as part of every workflow. If the docs are stale, the agent's next session starts from a lie. **The LLM must update docs automatically — the human reviews them, not writes them.**

### The Human Is the Architect
LLMs are fast, knowledgeable implementers with specific blind spots: logical design, mathematical reasoning, architectural elegance, and root-cause analysis of structural problems. The human's job is not to write every line — it is to make every *design decision*, catch accidental complexity, and force simplification where the LLM defaults to additive solutions.

### User Journey Is the Compass
Every feature, refactor, and bug fix exists in the context of a real person using the product. Design choices must be grounded in: who is the user, what are they trying to do, what do they see, and what happens when something goes wrong. This applies equally to end-users of the product and to non-technical developers who need to run and deploy the system.

---

## A. Project Setup — The LLM-Friendly Codebase

### A1. The CLAUDE.md / .windsurfrules File

**What it is:** The single file loaded into every agent session. It's your most powerful lever and your most dangerous footgun.

**The golden rule:** Under 100 lines. Boris Cherny (creator of Claude Code) runs ~100 lines and outperforms people with 800-line configs. The Claude Code system prompt already consumes ~50 of your ~150–200 instruction budget. Every unnecessary line dilutes the ones that matter.

**What goes in:**

```markdown
# CLAUDE.md

## Build & Test
- `npm run build` — TypeScript build
- `npm test` — full suite (slow, use sparingly)
- `npm test -- --grep "pattern"` — run single test
- `npm run lint` — ESLint + Prettier check
- `npm run typecheck` — tsc --noEmit

## Code Style
- ES modules (import/export), never CommonJS
- Destructure imports: `import { foo } from 'bar'`
- Explicit return types on all exported functions
- Error handling: Result<T, E> pattern, never throw for expected failures
- Use early returns to reduce nesting

## Architecture
- Layered: Types → Config → Repository → Service → Runtime → API
- Dependencies flow inward only. API depends on Service, never reverse.
- All external data parsed/validated at boundaries (Zod schemas in src/schemas/)
- For architecture details: see docs/architecture.md
- For conventions: see docs/conventions.md
- For user journey: see docs/user-journey.md

## Workflow
- Typecheck after every series of code changes
- Run the single relevant test, not the full suite
- Commit messages: conventional commits (feat:, fix:, refactor:)
- Never commit secrets, .env files, or credentials
- When compacting, preserve: list of modified files, current test status, active task

## Known Gotchas
- The payments module uses a legacy callback pattern — do NOT refactor to async/await (external SDK constraint)
- `UserService.findById()` returns null, not undefined, for missing users
- Docker build requires `--platform linux/amd64` on ARM Macs

## Debugging
- IMPORTANT: Fix the ROOT CAUSE only. Never patch symptoms.
- If a fix adds defensive code (guards, checks, constraints, wrappers,
  try-catches) around a value that shouldn't be wrong in the first place,
  you're patching a symptom. Remove the patch. Trace backward to where
  the bad state originates. Fix that.
- One bug = one fix in one place. If your diff has a "primary fix" and
  a "secondary fix," the secondary fix is probably the real one. Question
  which is actually the root cause.

```

**What does NOT go in:** Codebase overviews (agents discover structure fine on their own), generic advice ("write clean code"), exhaustive API docs, anything Claude already does correctly without being told. For each line, ask: "Would Claude make a specific mistake without this?" If no, cut it.

**Format rules:**
- Bullet points, not paragraphs (easier for models to parse)
- Always provide the alternative when prohibiting something ("Never use --foo; prefer --baz instead")
- Use IMPORTANT/MUST sparingly for critical rules
- Link to deeper docs with file paths, don't inline them ("For error patterns, see docs/conventions.md")
- Never use @file imports for large docs (embeds entire file every session)

**For Windsurf:** Use the `.windsurf/rules/` directory with separate rule files. Each rule file gets a trigger mode (always_on, model_decision, glob, manual). Keep individual rules under 6000 chars, total under 12,000.

**Maintenance:** Treat it like code. When the agent makes a mistake, add a rule. When behavior is correct without a rule, remove the rule. Review weekly. Check it into git.

### A2. The Context Documents

Your CLAUDE.md is the table of contents. The real knowledge lives in structured docs the agent reads on demand. Based on OpenAI's harness engineering approach (they tried the "one big file" approach — it failed):

**`docs/architecture.md`** — The system map

```markdown
# Architecture

## System Overview
[Project name] is a [type] that [purpose]. It serves [users] by [value].

## Component Map
```
api/          → Express REST API, handles auth + request validation
services/     → Business logic, one service per domain entity
repositories/ → Database access layer (Prisma), no business logic
schemas/      → Zod schemas, single source of truth for all data shapes
workers/      → Background job processors (BullMQ)
lib/          → Shared utilities (logger, errors, config)
```

## Data Flow
Request → Middleware (auth, rate limit) → Controller → Service → Repository → DB

## Key Design Decisions
- **Why Zod over class-validator:** Runtime validation at boundaries, TypeScript inference, composable
- **Why repository pattern:** Swappable data layer for testing, DB migration flexibility
- **Why BullMQ over cron:** Retry semantics, observability, horizontal scaling

## Boundaries & Contracts
- All API responses use the `ApiResponse<T>` wrapper (see schemas/api-response.ts)
- All errors extend `AppError` (see lib/errors.ts)
- Cross-service communication is via typed events (see schemas/events.ts)
```

**`docs/conventions.md`** — How we write code here

```markdown
# Conventions

## File Organization
- One exported entity per file (one service, one controller, one schema)
- Files under 300 lines. If longer, decompose.
- Name files by what they export: `user.service.ts`, `order.schema.ts`
- Group by feature in large codebases: `features/payments/`, not `controllers/payments-controller.ts`

## Patterns We Use
- Result<T, E> for operations that can fail expectedly
- Repository pattern for all DB access
- Factory functions over classes where possible
- Dependency injection via constructor params, not decorators

## Patterns We Avoid
- Inheritance hierarchies (prefer composition)
- Default exports (makes refactoring harder)
- Magic strings (use const enums or as const objects)
- Barrel files (index.ts re-exports — they break tree shaking and confuse agents)

## Testing
- Unit tests colocated: `user.service.test.ts` next to `user.service.ts`
- Integration tests in `test/integration/`
- Test naming: `should [expected behavior] when [condition]`
- No mocking unless crossing a boundary (DB, external API)
```

**`docs/decisions.md`** — Why things are the way they are (append-only log)

```markdown
# Decision Log

## 2026-04-08: Use BullMQ for background jobs
**Context:** Need reliable async processing for email sends and webhook deliveries.
**Decision:** BullMQ over node-cron or Agenda.
**Rationale:** Redis-backed, native retry/backoff, dead letter queues, dashboard (Bull Board).
**Consequences:** Redis dependency added. Workers must be idempotent.

## 2026-04-01: Monorepo with pnpm workspaces
**Context:** API + worker + shared types were diverging in separate repos.
**Decision:** Consolidate into monorepo.
**Rationale:** Single source of truth for types, atomic cross-package changes, simplified CI.
**Consequences:** Longer CI times, need workspace-aware tooling.
```

**`tasks/todo.md`** — Active work tracking (the agent reads and writes this)

```markdown
# Current Sprint

## In Progress
- [ ] Add rate limiting to /api/orders endpoint
  - [x] Research express-rate-limit vs custom middleware
  - [ ] Implement sliding window with Redis
  - [ ] Add tests
  - [ ] Update API docs

## Completed This Session
- [x] Fix N+1 query in OrderService.findByUser()

## Blocked
- [ ] Stripe webhook signature validation — waiting on Stripe support re: test mode keys
```

**`tasks/lessons.md`** — The self-improvement loop (critical)

```markdown
# Lessons Learned

## 2026-04-08
- When modifying Zod schemas, always check downstream: controllers, OpenAPI spec, and client types
- The test database uses a different schema prefix — always specify `test_` in integration tests
- Don't use `Promise.all` for DB writes that must be ordered — use sequential awaits

## 2026-04-07
- The Docker build cache busts on any package.json change — copy lock file first, then install, then copy source
```

### A3. Directory & File Structure Rules

These patterns make agents dramatically more effective:

**File size limit: 300 lines hard cap.** Beyond this, agents lose track of what's in the file, make conflicting edits, and context fills up reading single files. This is the single highest-ROI structural rule.

**Flat-ish structure, one concept per file.** Agents navigate by file names. `user.service.ts` is instantly findable. A 15-level-deep nested structure wastes tool calls on exploration.

**Monorepo when possible.** Agents work best when schemas, API definitions, and implementation are all accessible. As the Puzzmo team noted: a monorepo lets the agent read the schema, the API definition, and the per-screen request to understand the full picture.

**Recommended layout:**

```
project-root/
├── CLAUDE.md                    # Agent instructions (< 100 lines)
├── docs/
│   ├── architecture.md          # System map
│   ├── conventions.md           # How we code
│   └── decisions.md             # Why we decided things
├── tasks/
│   ├── todo.md                  # Active work
│   └── lessons.md               # Mistake log
├── src/
│   ├── schemas/                 # Zod schemas = single source of truth
│   ├── lib/                     # Shared utilities
│   ├── features/
│   │   ├── users/
│   │   │   ├── user.service.ts
│   │   │   ├── user.service.test.ts
│   │   │   ├── user.controller.ts
│   │   │   ├── user.repository.ts
│   │   │   └── user.types.ts
│   │   └── orders/
│   │       └── ...
│   └── app.ts
├── test/
│   └── integration/
├── .claude/
│   ├── settings.json            # Hooks config
│   ├── skills/                  # Reusable skill definitions
│   └── commands/                # Custom slash commands
└── .windsurf/
    └── rules/                   # Windsurf-specific rules
```

### A4. Types & Schemas as Source of Truth

The agent's #1 hallucination source is inventing APIs, field names, and data shapes. The fix: make schemas the canonical reference that everything else derives from.

```typescript
// src/schemas/order.schema.ts — THE source of truth
import { z } from 'zod';

export const OrderSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  items: z.array(OrderItemSchema),
  status: z.enum(['draft', 'submitted', 'paid', 'shipped', 'delivered', 'cancelled']),
  totalCents: z.number().int().nonneg(),
  createdAt: z.date(),
});

export type Order = z.infer<typeof OrderSchema>;

// The controller validates with this schema
// The service accepts this type
// The repository maps to/from this shape
// The API docs generate from this schema
// The agent reads THIS FILE to know what an Order looks like
```

Put schemas in a dedicated directory. Tell the agent in CLAUDE.md: "All data shapes are defined in src/schemas/. Read the relevant schema before modifying any feature."

### A5. The User Journey Document

**`docs/user-journey.md`** — The experience map

Every product decision is downstream of a user story. This document is the single source of truth for *who uses the system, what they do, and what they expect to happen*. The LLM reads this before implementing features and checks against it during review.

```markdown
# User Journey

## Personas
### Primary: [Role name]
- **Context:** [Who they are, what they do day-to-day]
- **Goal:** [What they're trying to achieve with this product]
- **Technical level:** [Can they use a terminal? Read code? Deploy?]
- **Pain points without this product:** [What they do today]

### Secondary: [Role name]
...

## Core Flows
### Flow 1: [Name]
1. **Entry:** [How the user arrives — URL, app launch, notification]
2. **Action:** [What they do — click, type, configure]
3. **Feedback:** [What they see — loading state, success, data update]
4. **Error:** [What happens when it fails — message, recovery path]
5. **Exit:** [Where they go next]

### Flow 2: [Name]
...

## Invariants
- [The user must NEVER see: raw error traces, undefined states, stale data without indication]
- [The user must ALWAYS see: confirmation before destructive actions, loading states for async ops]
- [Latency budget: X ms for Y operation]

## Edge Cases
- [What happens if the user has no data yet? (empty states)]
- [What happens if the connection drops mid-operation?]
- [What happens if two users act on the same resource?]
```

**When to reference it:**
- Before implementing any UI feature → read the relevant flow
- During review → check that the implementation matches the flow
- After shipping → update the doc if the flow changed
- The LLM updates this doc as part of the Doc Sync Protocol (see §D3)

### A6. The Operator's Guide

The product's users include **the non-technical human developer** who needs to run, configure, and deploy the system. The README and/or a dedicated DEPLOY.md must always contain:

```markdown
## Quick Start (Local Development)
1. Prerequisites: [exact versions — Node 20+, Python 3.12+, etc.]
2. Clone: `git clone <repo>`
3. Install: [exact commands, copy-pasteable]
4. Configure: [which .env files, what values, where to get API keys]
5. Run: [one command to start everything]
6. Verify: [how to confirm it's working — open browser to X, see Y]

## Deployment
1. [Step-by-step for each environment]
2. [Which secrets/env vars are needed]
3. [How to verify the deployment succeeded]

## Troubleshooting
- [Common failure mode 1 → fix]
- [Common failure mode 2 → fix]
```

**Rules:**
- Every command must be copy-pasteable. No "set up your database" without the exact command.
- Assume the reader has never used the terminal beyond `cd` and `ls`.
- The LLM must keep these docs current — when a dependency changes, a new env var is added, or the deploy process changes, the operator's guide is updated in the same PR.

---

## B. The Prompting Protocol — Session-to-Session Workflow

### B1. Starting a Session

**Make this a workflow, not a copy-paste.** The kickoff prompt should be a slash command (`/kickoff` in Windsurf, a custom command in Claude Code) so the agent executes it consistently every time. See the `/kickoff` workflow definition for the full procedure.

The workflow automates:
1. Read master docs (CLAUDE.md / AGENTS.md / .windsurfrules)
2. Read tasks/todo.md for current state
3. Read docs/user-journey.md to ground the session in the user's experience
4. Accept the task description
5. Read the relevant source files
6. Output a step-by-step plan
7. **Pause for human approval before any code is written**

For complex tasks, prefix with "think hard" or "ultrathink" to activate extended reasoning.

**Why the plan step matters:** Every high-quality source emphasizes planning before implementation. The plan is your checkpoint. You review it, correct misunderstandings, and scope the work before any code is written. This costs 2 minutes and saves 20.

### B2. Scoping Tasks

**Good task size:** One logical change that you could describe in a PR title. "Add rate limiting to the orders endpoint." "Refactor UserService to use Result pattern." "Write integration tests for the payment flow."

**Bad task size:** "Build the entire authentication system." "Refactor the codebase to use the new patterns." These are projects, not tasks. Decompose them.

**The prompt quality spectrum:**

| Bad | Good |
|-----|------|
| "Add caching" | "Add Redis caching to OrderService.findById() with 5-min TTL. Invalidate on order update. Use the existing Redis client in lib/redis.ts." |
| "Fix the bug" | "Users report 500 errors on POST /api/orders when items array is empty. Add validation that returns 400 with a clear error message. Add a test case." |
| "Make it better" | "The N+1 query in OrderService.findByUser() is causing slow responses. Use a JOIN or Prisma include to fetch orders with items in one query. Verify with the existing integration test." |

**Rules of thumb:**
- Include the "why" — agents make better architectural choices when they understand intent
- Name the files you expect to change — reduces exploration tool calls
- Specify the verification step — "run the test," "typecheck," "verify the endpoint with curl"
- Constrain scope — "only modify files in src/features/orders/"

**User Journey Checkpoint:** For any user-facing feature, the task prompt should reference the relevant flow in docs/user-journey.md. Ask: which persona does this serve? Which flow does it belong to? What does the user see before, during, and after? This prevents building features that are technically correct but experientially wrong.

### B3. Single Long Session vs. Multiple Sessions

**Use a single session when:**
- The task is under ~30 minutes of agent work
- All changes are in closely related files
- You're iterating on one feature

**Break into separate sessions when:**
- You're switching to a completely different part of the codebase (`/clear` or new session)
- Context is past ~40% utilization (you'll notice: slower responses, instructions being ignored, repeated mistakes)
- You want a fresh-eyes review of work done in a previous session

**The two-session pattern (from Boris Cherny):**
1. Session A: Spec & plan. "Interview me about this feature, then write a complete spec to tasks/spec.md"
2. Session B: Implement from spec with clean context. "Read tasks/spec.md and implement it."

**The TDD variant:**
1. Session A: Write failing tests
2. Session B: Write code that passes the tests

**Manual compaction:** When context is filling up but you're mid-task:
```
Write everything we've done so far to tasks/progress.md — include:
the end goal, the approach, steps completed, current status, and any
failures we're working around. Then /compact focus on the task state.
```

### B4. Human-in-the-Loop Checkpoints

Review is the difference between agentic engineering and vibe coding. Checkpoints:

1. **After the plan, before implementation.** Read the plan. Does it match your intent? Does it touch only the files it should? Is the approach sound?

2. **After each logical unit of change.** Read the diff. Look for: hallucinated imports, unnecessary abstractions, dead code, changed files you didn't expect, weakened error handling. Accept or request corrections.

3. **Before committing.** Run the full type check and relevant tests yourself. Verify the agent didn't silently break something it didn't test.

**The review mindset:** You are the architect. The agent is a fast, capable, but sometimes careless junior engineer. You don't write every line — you verify every decision. "Would a staff engineer approve this?" is the bar.

### B5. Ending a Session — The Closed Loop

Before closing out, **the LLM executes the Doc Sync Protocol** (see §D3). This is not optional — the human reviews, but the LLM writes. The session does not end until docs are current.

1. **LLM updates tasks/todo.md** — mark completed items, note what's still in progress
2. **LLM updates tasks/lessons.md** — if any mistake was corrected during the session, write a rule preventing it. This is Boris Cherny's #1 tip. Over time, the agent literally gets better at your project.
3. **LLM runs the Doc Sync Protocol** — update architecture docs, user journey, operator's guide, and component registry as needed (see §D3 for the full checklist)
4. **Human reviews all doc changes** — approve, correct, or reject
5. **Commit with a clear message** — `feat: add rate limiting to orders endpoint`
6. **If mid-task, LLM writes a handoff note:**

```
Write a handoff note to tasks/progress.md that captures: what we
were doing, what's done, what's remaining, any decisions made,
any blockers. A fresh session should be able to pick this up cold.
```

---

## C. Custom Skills, Commands & Workflows

### C1. Pre-Flight Check (run before major changes)

**Claude Code:** `.claude/commands/preflight.md`
```markdown
Before making changes to $ARGUMENTS, perform a pre-flight check:

1. Read the relevant schema files in src/schemas/
2. Read docs/architecture.md to understand the component boundaries
3. Read docs/conventions.md for coding patterns
4. Identify all files that import from or depend on the target area
5. Check tasks/lessons.md for any relevant gotchas
6. List all files you plan to modify and why
7. Identify risks: what could break?
8. Present the plan and wait for approval before proceeding
```

**Windsurf:** Create as `.windsurf/rules/preflight.md` with trigger: manual.

### C2. Refactor Sweep (periodic slop cleanup)

**Claude Code:** `.claude/commands/refactor-sweep.md`
```markdown
Perform a refactor sweep on $ARGUMENTS (or the most recently modified files if none specified):

1. Check for files over 300 lines — propose decomposition
2. Look for duplicated logic across files — extract to shared utilities
3. Find any `any` types, missing return types, or type assertions — fix them
4. Identify dead code (unused exports, unreachable branches) — remove it
5. Check for inconsistent patterns (some files use callbacks, others async/await) — standardize
6. Look for hardcoded values that should be constants or config
7. Run typecheck and tests after each change
8. Summarize what you changed and why
```

### C3. Doc Sync Protocol (the closed feedback loop)

This is the most important command in the playbook. It is the mechanism by which the LLM keeps docs current *automatically*, not as a human afterthought. Every workflow (`/implement`, `/debug`, `/refactor`, `/review`) must invoke this before completion.

**Claude Code:** `.claude/commands/doc-sync.md`  
**Windsurf:** `.windsurf/workflows/` — embedded as a final step in every workflow
```markdown
Update all context documents to reflect what just changed. Work through this checklist:

1. **Architecture doc** (docs/architecture.md or AGENTS.md):
   - Verify component map matches reality — add new components, remove deleted ones
   - Verify data flow diagrams are still accurate
   - Update Key Files table if files were created/moved/deleted
2. **User Journey doc** (docs/user-journey.md):
   - If a user-facing flow changed, update it
   - If a new flow was introduced, add it
   - If error handling changed, update the Error section of affected flows
3. **Operator's Guide** (README.md / DEPLOY.md):
   - If dependencies changed, update install steps
   - If env vars were added/removed, update configuration section
   - If the run/deploy process changed, update those steps
   - If a new common failure mode was discovered, add to Troubleshooting
4. **Component registry** (STACK_STATUS.md or equivalent):
   - Update PROD/MOCK/STUB/OFF status for any component that changed
5. **Conventions doc** (docs/conventions.md):
   - Check that listed patterns are actually used, flag any new patterns that have emerged
6. **Lessons log** (tasks/lessons.md):
   - Remove lessons that are no longer relevant (the code they reference has been refactored)
   - Add any new lessons from this session
7. **Rules file** (CLAUDE.md / .windsurfrules):
   - Remove instructions that are no longer needed
   - Add any that this session revealed are missing
8. **Present all doc changes for human review** — do not commit until approved

If nothing changed in a category, skip it. The goal is zero-cost maintenance, not busywork.
```

### C4. Review (critique recent changes)

**Claude Code:** `.claude/commands/review.md`
```markdown
Review the changes made in $ARGUMENTS (default: the current git diff against main):

Act as a skeptical staff engineer doing a code review. Check for:
1. **Correctness:** Does the logic handle edge cases? Empty arrays, null values, concurrent access?
2. **Architecture:** Do the changes respect the layer boundaries in docs/architecture.md?
3. **Conventions:** Do they follow docs/conventions.md?
4. **User journey:** Do the changes match the relevant flow in docs/user-journey.md? What does the user actually see?
5. **Security:** Any user input passed unsanitized? SQL injection? Auth bypass?
6. **Performance:** Any obvious N+1 queries, missing indexes, unbounded loops?
7. **Logical simplicity:** (see §C7 Logic Audit) Is the design the simplest possible? Could the same result be achieved with fewer abstractions, fewer files, or a more direct data flow? Flag any accidental complexity.
8. **Slop indicators:** Unnecessary abstractions, over-engineering, code that looks like it was generated to look impressive rather than be simple?
9. **Test coverage:** Are the changes tested? Are the tests meaningful or just checking happy paths?
10. **Symptom patching:** Flag any change that adds defensive code around bad state rather than fixing what produces the bad state. Ask: "Why does this bad state exist? Is the source fixed, or just contained?"

Be specific. Quote the line. Suggest the fix. Don't be polite — be accurate.
```

### C5. Spec Writer (for complex features)

**Claude Code:** `.claude/commands/spec.md`
```markdown
I want to build: $ARGUMENTS

Interview me about this feature using the AskUserQuestion tool. Ask about:
- User stories and acceptance criteria
- Edge cases and error scenarios
- Performance requirements
- Security considerations
- Integration points with existing code
- What should NOT change

Keep asking until we've covered everything. Don't ask obvious questions.
Then write a complete spec to tasks/spec-[feature-name].md including:
- Overview
- Detailed requirements
- Technical approach
- Files to create/modify
- Test cases to write
- Out of scope (explicitly)
```

### C6. Hooks (automated guardrails)

Configure in `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "tool": "write",
        "command": "npx prettier --write $FILE",
        "description": "Auto-format after every file write"
      }
    ],
    "PreCommit": [
      {
        "command": "npm run typecheck && npm run lint",
        "description": "Block commits that fail typecheck or lint"
      }
    ]
  }
}
```

Key hooks to set up:
- **Post-edit:** Run formatter on written files (catches the last 10% of formatting issues)
- **Pre-commit:** Typecheck + lint (deterministic gate, catches errors before they're committed)
- **Pre-tool-use on sensitive paths:** Block writes to migration files, .env, or config without explicit approval

### C7. Logic Audit (force structural reasoning)

LLMs are weak at recognizing when a problem is not a code bug but a **design flaw**. They default to additive fixes — more code, more abstraction, more indirection — when the real answer is often *remove something* or *redesign the data flow*. This command forces the agent to reason structurally before writing code.

**Claude Code:** `.claude/commands/logic-audit.md`  
**Windsurf:** `.windsurf/workflows/` — embed in `/debug` and `/refactor`
```markdown
Before proposing any code changes for $ARGUMENTS, perform a logic audit:

1. **Draw the data flow.** Trace the path of data from input to output. List every transformation,
   every handoff between modules, every place where data changes shape. Write this as a numbered list.

2. **Count the abstractions.** For each abstraction (class, wrapper, middleware, utility function, 
   indirection layer): what *variation* does it handle? If the answer is "only one case," the 
   abstraction is not justified. Flag it.

3. **Check for accidental complexity.** For each step in the data flow, ask:
   - Is this step *inherently* necessary, or does it exist to work around a design choice?
   - Could this step be eliminated by changing an upstream decision?
   - Is this step doing the same thing as another step but differently?

4. **Propose the simplest alternative.** If the current design has N layers/steps, can the same 
   result be achieved with N-1? With N/2? What is the *minimum* design that produces the same output?
   - Could a class hierarchy be a single function?
   - Could a multi-step pipeline be a single Polars expression chain?
   - Could a complex state machine be a simple if/else?
   - Could scattered related values be a single DataFrame instead of parallel arrays?

5. **Identify the root design decision.** If the current problem is a symptom of a poor earlier 
   design choice, name that choice explicitly. "The bug exists because X was designed as Y, but it 
   should have been Z." Do NOT propose a workaround for the symptom.

6. **Present findings.** Output:
   - The data flow diagram (from step 1)
   - Unjustified abstractions (from step 2)
   - Accidental complexity (from step 3)
   - The simplest alternative design (from step 4)
   - The root design decision to change (from step 5)

   Wait for human approval before implementing any changes.
```

**When to invoke:**
- Before debugging any issue that has resisted 2+ fix attempts
- During `/refactor` as Phase 0 (before any code changes)
- Anytime the human suspects the problem is architectural, not implementational
- When a diff is suspiciously large for a seemingly simple change

---

## D. Codebase Hygiene — The Maintenance Loop

### D1. The Weekly Refactoring Cadence

**Every week, run:**
1. `/refactor` on the most-changed directories (includes Phase 0 Logic Audit)
2. `/doc-sync` to sync all docs with reality (the Doc Sync Protocol, §C3)
3. `/review` on the full diff since last week's cleanup

**What to target:**
- Files that grew past 300 lines
- New patterns that emerged but aren't documented
- Duplicated code across features
- Type safety regressions (`any` types that crept in)
- Dead code from abandoned approaches

### D2. Detecting Architectural Drift

The agent makes 50 changes that each seem reasonable in isolation but collectively drift from your intended architecture. Detection methods:

**Automated (set up once, runs forever):**
- Custom lint rules that enforce layer dependencies (e.g., "files in repositories/ cannot import from services/")
- File size lint that flags files over 300 lines
- Import graph analysis that detects circular dependencies
- OpenAI's approach: structural tests that validate the architecture invariants

**Manual (during weekly review):**
- Read the git log for the week. Do the changes tell a coherent story?
- Compare the actual import graph against docs/architecture.md
- Look for "convenience" shortcuts where something reaches across a layer boundary

**Fixing drift:** Start a fresh session, provide docs/architecture.md, and ask: "Review src/features/orders/ for violations of the architectural boundaries defined in docs/architecture.md. List every violation. Propose fixes. Do not implement until I approve."

### D3. Keeping Context Docs Accurate — The Doc Sync Protocol

The Doc Sync Protocol (§C3) is the mechanism. The discipline is:
- **After every implementation session:** The LLM runs the Doc Sync Protocol before the session ends. This is mandatory, not optional.
- **After every mistake:** LLM updates lessons.md immediately (this is the self-improvement loop)
- **After every decision:** LLM appends to decisions.md with date, context, decision, rationale
- **After every deployment change:** LLM updates the Operator's Guide (README.md / DEPLOY.md)
- **After every user-facing change:** LLM updates docs/user-journey.md
- **Monthly:** Full audit — does every section of architecture.md describe something that still exists?

OpenAI runs a "doc-gardening" agent that scans for stale documentation and opens fix-up PRs. The Doc Sync Protocol is the equivalent for human-scale teams: built into every workflow, not a separate process.

**The key insight:** When docs are updated by the LLM as part of the workflow, they are *always current*. When docs are updated by the human as an afterthought, they are *always stale*. Close the loop.

### D4. Manual vs. Agent Refactoring

**Let the agent refactor when:**
- The change is mechanical (rename, move files, update imports)
- There's a clear pattern to apply uniformly (add error handling to all endpoints)
- You can verify with tests and typecheck

**Do it yourself when:**
- The refactoring requires understanding business context the agent doesn't have
- It's an architectural decision (merge two services, split a module)
- The current code is so tangled that the agent would need to read too many files (context overload)
- The problem is **logical design** — the data model is wrong, the abstraction boundaries are in the wrong place, the algorithm is fundamentally flawed. LLMs will try to patch around these; the human must redesign.

In practice: you decide *what* to refactor and *how*. The agent executes. You verify.

**The Logic Audit bridge:** When you suspect the problem is design-level but aren't sure, run the Logic Audit (§C7) first. The agent maps the data flow and counts abstractions. You read the map and make the design decision. Then the agent implements your decision mechanically.

---

## E. Anti-Patterns and Rules

### E1. Never Let the Agent Do Unsupervised

- **Delete files or database tables** without explicit listing and approval
- **Modify authentication, authorization, or security middleware** without line-by-line review
- **Change database schemas or migrations** — always review, always test rollback
- **Install new dependencies** — agents default to adding libraries for things you can do in 10 lines
- **Refactor across more than 5 files at once** without a written plan
- **Make "improvements" you didn't ask for** — scope creep is the agent's natural mode

### E2. Prompt Patterns That Produce Bad Output

| Anti-Pattern | Why It Fails | Do This Instead |
|---|---|---|
| "Build the whole feature" | Too much scope, agent loses coherence | Break into 3-5 discrete tasks |
| "Make it production-ready" | Vague, agent adds unnecessary abstractions | Specify: add error handling, input validation, logging |
| "Fix everything" | No clear stopping condition | List specific issues to fix |
| "Refactor to be cleaner" | Subjective, agent may over-abstract | "Extract the validation logic into a separate function" |
| Multi-turn debugging spiral | Context fills with failed attempts | After 3 failed attempts, start a fresh session with what you learned |
| "You're the expert, just do it" | Removes your architectural oversight | "Here's the approach. Implement it." |
| Pasting entire error logs | Fills context with noise | Paste only the relevant stack trace lines |

### E3. Signs a Session Has Gone Off the Rails

- **The agent repeats a mistake you already corrected** → context is degraded, /compact or restart
- **Responses are getting slower and less focused** → context utilization is high
- **The agent "forgets" rules from CLAUDE.md** → too much accumulated context is drowning instructions
- **The agent apologizes and tries again with the same approach** → it's stuck in a loop, restart with a different approach
- **You see "convenience" code appearing** — utility functions that exist only to support the agent's approach, not your architecture → stop, review, likely revert
- **The diff is much larger than expected** → the agent changed things you didn't ask for, review carefully
- **The agent starts inventing APIs or field names** → it's lost track of the schemas, point it back to the schema files

### E4. Common Mistakes with Agentic Coding

1. **Trusting without reviewing.** The agent produces code that looks right and passes tests but is architecturally wrong. Always read the diff. "AI slop" is code that's functional but unmaintainable.

2. **Not investing in the harness.** People spend hours prompting and minutes on CLAUDE.md, docs, and hooks. Invert this. The upfront infrastructure investment pays back every session.

3. **Letting CLAUDE.md rot.** A stale rules file is worse than no rules file. The agent follows outdated instructions confidently.

4. **Never starting fresh.** Continuing a degraded session because you've "built up context" is a trap. The context is poisoned. Start fresh with a clean handoff note.

5. **Treating the agent as an oracle.** It's not. It's a fast, knowledgeable, sometimes careless implementer. You are the architect. The bottleneck is your domain expertise and judgment, not the tool.

6. **Overloading with MCPs and tools.** Each MCP consumes thousands of tokens just in tool definitions. Past ~20K tokens of MCP overhead, you've crippled the agent's working memory. Use the minimum tools needed.

7. **Skipping the spec phase.** The two-session pattern (spec, then implement) feels slower but produces dramatically better results. The spec catches misunderstandings before they become code.

8. **Not using subagents.** For research, exploration, or review tasks, spawn a subagent to keep the parent context clean. The intermediate tool calls and exploration noise should never pollute your main session.

### E5. LLM Blind Spots — Know What They Can't Do

LLMs have specific, repeatable weaknesses. Designing your workflow around these is not optional — it's the difference between a productive partnership and an expensive frustration machine.

**Logical design & mathematical reasoning:**
- LLMs cannot reliably determine whether a design is *logically minimal*. They will happily add a third layer of abstraction when a direct function call would suffice.
- They cannot reason about mathematical invariants (e.g., "this sum must always equal 1.0") without being explicitly told.
- They cannot detect when a bug is actually a *design flaw* — they will patch symptoms indefinitely.
- **Mitigation:** Use the Logic Audit (§C7) before complex changes. The human makes all design decisions.

**Vectorization & data architecture:**
- LLMs default to scalar, imperative code. They will write `for row in df.iterrows()` when a single Polars expression would be 100x faster and 5x more readable.
- They struggle to see when parallel arrays (`prices = [], vols = [], strikes = []`) should be a single DataFrame.
- **Mitigation:** The `/refactor` workflow includes explicit vectorization auditing (Phase 3). Call it out in task prompts: "Use columnar operations, not loops."

**Root-cause analysis:**
- When a fix fails, LLMs add *more* code rather than questioning the original approach. After 2-3 failed attempts, they're in a context-poisoned spiral.
- They prefer additive solutions (add a guard, add a check, add a wrapper) over subtractive ones (remove the broken abstraction).
- **Mitigation:** After 2 failed fix attempts, stop. Run the Logic Audit. Start a fresh session with the audit results.

**Architectural simplicity:**
- LLMs over-abstract. They introduce factory patterns, strategy patterns, and middleware chains where a simple function would suffice.
- They cannot judge whether an abstraction is *justified by actual variation* — they abstract speculatively.
- **Mitigation:** The review checklist (§C4) explicitly checks abstraction justification. Every class/wrapper/layer must handle >1 case to exist.

---

## Quick Reference Card

```
SESSION START
─────────────
1. /kickoff (or /clear + manual kickoff prompt)
2. Agent reads: master docs → todo → user journey → relevant source
3. Agent outputs plan. Human reviews and approves.

DURING SESSION
──────────────
• Review every plan before approving
• Review every diff before accepting
• After 2 failed fix attempts → run /logic-audit, then fresh session
• At ~40% context → /compact with preservation instructions or restart
• One task at a time. Commit between tasks.
• For user-facing changes → check against docs/user-journey.md

SESSION END (the closed loop)
─────────────────────────────
1. LLM runs Doc Sync Protocol (§C3) — updates all relevant docs
2. Human reviews doc changes
3. Commit code + docs with conventional commit message
4. If mid-task: LLM writes handoff to tasks/progress.md

WEEKLY MAINTENANCE
──────────────────
1. /refactor on hot directories (includes Phase 0 Logic Audit)
2. /doc-sync to verify all docs match reality
3. /review on the week's diff
4. Prune CLAUDE.md / .windsurfrules

KEY WORKFLOWS
─────────────
/kickoff   — session start: load context, plan, pause for approval
/implement — feature build: plan → execute → self-review → doc sync → commit
/debug     — bug fix: reproduce → logic audit → isolate → fix → doc sync
/refactor  — cleanup: logic audit → inventory → audit → fix → doc sync
/review    — code review: lane compliance, user journey, logic simplicity
/spec      — feature spec: interview → contract-first specification
/cleanup   — hygiene sweep: dead code, imports, consistency
```

---

*This playbook is a living document. When something isn't working, update it. When something new works, add it. The meta-principle is the same one that governs CLAUDE.md: iterate based on what actually happens, not what you think should happen.*
