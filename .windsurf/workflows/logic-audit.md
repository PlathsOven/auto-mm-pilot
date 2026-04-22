---
description: Structural audit — check for accidental complexity before refactoring or rewriting a subsystem
---

## /logic-audit — Logical Simplicity Audit

A 6-step structural review asking "is this the simplest shape that satisfies the requirement?" before any refactor, rewrite, or third debugging attempt. Catches **accidental complexity** — layers, indirection, and state that exist because of how the code was written, not because the problem demanded them.

**When to run:**
- Before a `/refactor` session (Phase 0)
- After 2 failed fix attempts in `/debug`, before a third
- When a reviewer says "this feels too complicated"
- When you cannot build a mental model of an area in 5 minutes
- Before touching `sdk/posit_sdk/` — the SDK is customer-facing; even small changes leak complexity into every downstream integration. Apply the SDK lens in §3.

### 1. Draw the Data Flow

From the entry point (user action, request, WS tick), trace every transformation until the data reaches its destination (UI render, DB write, outbound response). Draw it as a linear pipeline:

```
input → [step 1: what] → [step 2: what] → ... → output
```

For each step, note:
- **What shape** the data has (Pydantic model? DataFrame? dict? TS interface?)
- **Which file** owns that step
- **What function** performs the transformation

If you cannot draw this flow from memory after reading the code, that itself is a finding — the code is too entangled.

### 2. Count the Abstractions

List every abstraction layer the data crosses: classes, interfaces, wrappers, adapters, managers, factories, decorators, middleware, context providers, event buses, DI containers.

For each layer, ask:
- **What does it add?** (type safety? retry? caching? logging? separation of concerns?)
- **Would the code break without it?** (if inlined, would anything fail, or would the code just be shorter?)
- **Does it exist for a real constraint, or because it felt "professional"?**

Three layers for a request handler is normal; seven is a smell.

### 3. Check for Accidental Complexity

Common sources:
- [ ] **State that could be derived** — a field cached on an object that could be computed from other fields on demand
- [ ] **Parallel data structures** — the same information stored in two shapes that must be kept in sync (common anti-pattern vs. a single Polars DataFrame)
- [ ] **Wrapping for wrapping's sake** — a function that takes a DataFrame, calls one Polars expression, and returns a DataFrame. Inline it.
- [ ] **Generic parameters that are never varied** — a `T` or `TypeVar` that has exactly one actual type at every call site
- [ ] **Configuration knobs with one setting** — an option that's always `True`, a strategy param always set to `"default"`
- [ ] **Intermediate DTOs** — a separate type that exists only to hand off data between two adjacent functions
- [ ] **Event-based coupling where direct calls would work** — a pub/sub bus with exactly one publisher and one subscriber
- [ ] **Manager/Service/Handler chains** — a `FooManager` that calls `FooService` that calls `FooHandler`. Collapse if no layer branches.

**SDK lens** (when auditing `sdk/posit_sdk/` or any customer-facing surface — the question shifts from "minimal internally?" to "minimal for the external user writing their first feeder?"):
- [ ] **Call-sequence bloat** — hello world requires more than one atomic setup call plus the steady-state loop. If setup is always 3+ sequential calls, collapse them into one (`bootstrap_streams` is the canonical pattern).
- [ ] **Validation delayed until I/O** — an input that could be rejected at construction time (Pydantic validator, `__post_init__`) but instead raises only after a network round-trip. Errors should fire where the bad value was created, not where it was transmitted.
- [ ] **Error types that don't map to a fix** — an exception class the user can raise but cannot act on without reading the source. Every error should carry a message that names the fix, and every error type should appear in `docs/sdk-quickstart.md`'s error cheatsheet.
- [ ] **Silent-miss surfaces** — a "valid" input path that produces plausible-looking zeros downstream instead of an error (the `market_value` footgun is canonical). Must warn once per occurrence; never fail silently.
- [ ] **Asymmetric transports** — WS and REST accept different inputs or produce different outputs for the same logical call. Unify the surface or make the divergence loud (one WARN per state transition).
- [ ] **Public symbol sprawl** — every entry in `__all__` is a backward-compat liability. Any export that isn't load-bearing for the quickstart or a documented advanced flow is accidental complexity.

### 4. Propose the Simplest Alternative

Sketch the **smallest correct implementation** for the area. Don't worry about the reshape path yet — just describe the target:
- How many files?
- How many functions?
- What are the types at the boundaries?
- What is the data flow in plain English?

Must satisfy every **real** requirement (user-visible behavior, security, performance). Drop anything that exists for hypothetical future requirements.

### 5. Identify the Root Design Decision

The current shape usually follows from one or two early decisions. Find them. Typical root decisions:
- "We'll use inheritance for X" → leads to deep class hierarchies that could be composition
- "We'll store state in a class attribute" → leads to mutation bugs that could be pure functions
- "We'll make this configurable" → leads to branches that are never exercised
- "We'll add a middleware layer" → leads to implicit control flow that could be explicit

Name the decision. Name when it was made (commit, PR, or "inherited from vibe-code era"). Ask whether the reasoning still holds today.

### 6. Present Findings

Output a report structured as:

```
## Logic Audit: <area>

### Data flow
<linear pipeline diagram>

### Abstraction count
<N layers; list each with "adds: X" or "adds: nothing">

### Accidental complexity findings
- <finding 1> (severity: high | medium | low)
- <finding 2>
- ...

### Simplest alternative
<file count, function count, type shape, data flow>

### Root design decision
<the one or two calls that shape everything downstream>

### Recommendation
<hold the current shape | incremental simplification | full rewrite>
```

**STOP. Do NOT refactor.** Wait for human decision on which path to take. Logic audits are diagnostic; the fix is a separate action.
