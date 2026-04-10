---
description: Interview the user and write a complete feature spec to tasks/spec-<name>.md before any code is written
---

## /spec — Feature Specification Writer

For any feature that is bigger than a one-file change, write a spec before writing code. A good spec stops entire classes of rework: ambiguous requirements, missed edge cases, silent scope creep, and "the user actually wanted something different" surprises.

The spec lives at `tasks/spec-<feature-name>.md` and is the source of truth until the feature ships. `/implement` may reference it; `/review` will check the final code against it.

---

### 1. Interview the User

Ask one round of focused questions. Do not assume — the whole point of the spec phase is to surface assumptions before they harden into code. Cover:

**User stories**
- Who is the user for this feature? (Primary trader? Operator? Both?)
- What job are they trying to do?
- What would they do today without this feature? (The current workaround tells you what the feature is replacing.)

**Acceptance criteria**
- What observable behavior proves the feature works?
- What latency / throughput budget does it need to hit?
- What is the success metric after it ships?

**Edge cases**
- What happens on WS disconnect mid-feature?
- What happens on empty state (no streams configured, no data yet)?
- What happens when two users hit it at once?
- What happens on malformed input from an external source?

**Performance**
- Is this in the hot path (per-tick) or the cold path (per-request)?
- What is the expected row count / payload size?
- Is there a latency target? A memory budget?

**Security**
- Does this touch auth / API keys / user identity?
- Does it expose new endpoints or WS channels?
- Does it log anything that shouldn't be logged?

**Integration points**
- Which lanes does it cross? (client/ui, client/adapter, server/api, server/core)
- Does it require a schema change in `server/api/models.py` or `client/ui/src/types.ts`?
- Does it introduce a new external dependency?

**Out of scope**
- What have we explicitly decided NOT to build in this pass?
- What is the "phase 2" that will tempt someone to pre-build?

Ask all questions up front in one batch. Then wait for answers before writing anything.

### 2. Write the Spec

Create `tasks/spec-<feature-name>.md` with this structure:

```markdown
# Spec: <feature name>

## Overview
<2–3 sentences: what and why>

## Requirements
### User stories
- As a <persona>, I want <action>, so that <outcome>

### Acceptance criteria
- [ ] <observable behavior 1>
- [ ] <observable behavior 2>

### Performance
- <latency / throughput / size target>

### Security
- <auth / exposure / logging constraints>

## Technical Approach
<1–2 paragraphs: the chosen implementation path. Name the data flow. Reference the MVP pipeline step if applicable.>

### Data shape changes
- `server/api/models.py`: <new / changed models>
- `client/ui/src/types.ts`: <new / changed interfaces>
- These must stay in sync — Pydantic is upstream.

### Files to create
- `<path>` — <purpose>

### Files to modify
- `<path>` — <what changes>

## Test Cases
- <happy path scenario>
- <edge case: empty state>
- <edge case: disconnect>
- <edge case: malformed input>
- <edge case: auth failure, if applicable>

## Out of Scope
- <thing 1 and why>
- <thing 2 and why>

## Manual Brain Boundary
<If this feature touches behavior in server/core/, describe the interface boundary. The spec stops at the boundary; the human owns the implementation on the other side.>
```

### 3. Present & Confirm

Show the spec to the user. Ask:
- Are the acceptance criteria complete?
- Did I miss an edge case?
- Is anything in "Out of Scope" actually in scope?

Iterate until the user approves. Only after approval should `/implement` be invoked against the spec.

### Manual Brain reminder

If the feature requires writing logic inside `server/core/`, the spec must stop at the interface boundary and declare that the implementation on the other side is a human task. Do not write Python code inside `server/core/` even as part of spec scaffolding. Empty `# HUMAN WRITES LOGIC HERE` stubs are the only allowed form.
