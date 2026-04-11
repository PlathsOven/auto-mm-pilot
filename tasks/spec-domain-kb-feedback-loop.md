# Spec: Domain Knowledge Feedback Loop

## Overview
The APT LLM frequently gets domain-specific facts wrong (e.g., explaining variance as "accounting for nonlinearity" instead of "variance is summative, vol is not"). Corrections the trader makes in conversation are lost between sessions. This feature automatically detects when the trader corrects the LLM, extracts the correction into a persistent knowledge base, and injects that knowledge into all future prompts — so the same mistake is never repeated.

## Requirements

### User stories
- As a trader, I want my corrections to stick, so that the LLM stops repeating the same domain errors across conversations.

### Acceptance criteria
- [ ] After the trader corrects the LLM, the correction appears in `domain_kb.json` within seconds (background task, no user action required).
- [ ] All future LLM responses (all modes: investigate, opinion, configure, general) include the accumulated domain knowledge in their system prompt.
- [ ] The detector is aggressive — errs on the side of capturing possible corrections rather than missing them. False positives are acceptable; missed corrections are not.
- [ ] The specific variance/summative correction is seeded into the KB on deploy (the bug that motivated this feature is fixed immediately, not deferred to the first correction).
- [ ] The "why variance" explanation is also embedded directly in the FRAMEWORK section of `core.py` (belt and suspenders — the most important domain fact shouldn't depend solely on the KB).
- [ ] The detector runs as a background task (`asyncio.create_task`) and does not add latency to the streamed response.
- [ ] The KB is invisible to the trader — no UI, no notification. The observable effect is simply "the LLM gets smarter."

### Performance
- Detector call: ~200 tokens output, runs on a cheap model (Haiku-class). One call per message. No latency impact on the main response since it runs in background.
- KB serialization into prompts: negligible token cost at <50 entries. No performance concern until RAG is needed.
- Single-conversation system — no write locking needed on the JSON file.

### Security
- No new endpoints exposed.
- No auth changes.
- The KB file may contain trader opinions/corrections — stored server-side only, not exposed to the client.
- The detector uses the same OpenRouter API key as the main LLM.

## Technical Approach

After every LLM response is fully streamed, a background task sends the last few conversation messages to a cheap model with a detection prompt. The detector determines whether the trader's latest message corrected a factual error. If yes, it extracts the topic, the misconception, the correct fact, and why it matters, then appends the entry to a JSON file on disk. On every subsequent prompt build, the KB is read from disk and injected as a `## DOMAIN KNOWLEDGE` section visible to all modes.

The variance/summative fact is also hardcoded into the FRAMEWORK section of `core.py` as a direct fix for the original bug — the KB reinforces it and flags the common misconception, but the core prompt doesn't depend on the KB for this specific fact.

### Data shape changes
- No changes to `server/api/models.py` or `client/ui/src/types.ts`. This is entirely server-internal.

### Files to create
- `server/api/llm/domain_kb.json` — persistent KB store, seeded with variance/summative correction.
- `server/api/llm/domain_kb.py` — load/save/serialize KB entries. Reads JSON from disk, formats as prompt section.
- `server/api/llm/correction_detector.py` — detection prompt + async function that checks conversation for corrections, extracts facts, writes to KB.

### Files to modify
- `server/api/llm/prompts/core.py` — add "variance is summative" to the FRAMEWORK section (direct bug fix).
- `server/api/llm/prompts/__init__.py` — append `## DOMAIN KNOWLEDGE` section (from KB) to all prompt builds.
- `server/api/llm/service.py` — expose `client` property so the router can pass it to the detector.
- `server/api/routers/llm.py` — accumulate streamed response, fire detector as `asyncio.create_task` after stream completes.
- `tasks/lessons.md` — record lesson: ground domain knowledge in prompts, don't let the LLM derive explanations from first principles.

## Test Cases
- **Happy path:** Trader says "no, the reason is X." Detector captures it. Next conversation includes the fact in the prompt.
- **No correction:** Trader asks a normal question. Detector returns `is_correction: false`. KB unchanged.
- **Subtle correction:** Trader says "that's not quite right — it's actually because Y." Detector catches it (aggressive mode).
- **Duplicate correction:** Trader corrects the same thing twice. Detector adds a second entry (acceptable — dedup is out of scope, manual prune if needed).
- **Detector LLM fails (OpenRouter down):** Background task catches the exception, logs a warning, does nothing. Main response is unaffected.
- **Malformed detector response (bad JSON):** Background task catches the parse error, logs a warning, does nothing.
- **Empty conversation (first message):** Detector skips — needs at least one prior assistant message to have something to correct.

## Out of Scope
- **RAG retrieval** — inject all KB entries for now. Switch to top-k embedding retrieval when the KB grows past ~50-100 entries. The serialization function is the only place that needs to change.
- **UI for viewing/editing KB** — the KB is invisible infrastructure. Operator edits JSON directly if needed.
- **Trader-triggered "save this" button** — the whole point is zero-friction capture.
- **Write locking / concurrent access** — single conversation system, not needed.
- **Deduplication** — let the KB grow, prune manually if it gets noisy.

## Manual Brain Boundary
This feature does not touch `server/core/`. All changes are in `server/api/llm/` (prompt construction, detection) and `server/api/routers/` (background task wiring).
