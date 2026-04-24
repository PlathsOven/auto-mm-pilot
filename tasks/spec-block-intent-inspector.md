# Spec: Block-intent Inspector surface ("why does this block exist?")

**Status:** Draft — ready for `/implement`. Authored 2026-04-23.

**Context:** Follow-up to `tasks/spec-llm-orchestration.md` M3. The `GET /api/streams/{name}/intent` endpoint is live and returns the persisted `StoredBlockIntent` (trader's original phrasing + Stage 1–4 trace). This spec wires a client-side surface that reads the endpoint and renders the intent in the Inspector when the trader focuses on a stream or a block produced by a Build-orchestrator commit.

## Overview

When the trader focuses on a stream node (StreamInspector) or a specific block row (BlockInspector), the Inspector fetches `/api/streams/{name}/intent`. On 200 it renders a read-only "Why this block exists" panel showing the trader's verbatim phrasing + the preset name (or the custom-derivation reasoning) + the timestamp of the commit. On 404 the section is hidden entirely — pre-M3 blocks and blocks created outside the orchestrator (manual "+ Manual block" drawer) don't have an intent row, and showing a "nothing here" placeholder would just be noise.

## Requirements

### User stories
- As a trader who committed an opinion two weeks ago, I want to reopen the stream / block and see my own words so I can tell at a glance whether this block still represents the view I hold today.
- As a trader reviewing a desk-mate's position, I want to see the natural-language rationale behind each Build-orchestrator block so I know what they intended before diving into parameters.

### Acceptance criteria
- [ ] When the Workbench focus is `{ kind: "stream", name }` and the stream has a stored intent, the StreamInspector renders a "Why this block exists" section showing:
  - the trader's `original_phrasing` (verbatim, quoted)
  - the preset name (Mode A) OR the custom-derivation reasoning (Mode B), labelled accordingly
  - the commit timestamp (ISO date, relative "2 days ago" optional)
  - if Mode B + `critique.concerns` is non-empty: the concerns list in a subtle warning treatment (amber, same palette as the ProposalPreviewDrawer)
- [ ] When the focus is `{ kind: "block", ... }` and the `streamName` resolves to a stream with a stored intent, the BlockInspector renders the same section.
- [ ] On 404 (no intent row for the stream), the section is hidden entirely — no placeholder card, no "no intent recorded" text.
- [ ] The section never opens a drawer, never navigates, never triggers a server mutation. Read-only.
- [ ] Fetch is deduplicated per focus change — refocusing the same stream doesn't re-fetch.
- [ ] Fetch failures other than 404 (500, network) are logged to console and surface a small "couldn't load intent" placeholder (different from 404 — the server is broken, not the data missing).
- [ ] The same section is used by both inspectors — one shared component.

### Performance
- Cold path — fetch runs once on focus change, not per tick.
- Response payload is small (one row of JSON, ~1-3 KB). No caching required in v1; re-fetch on refocus is fine.

### Security
- Endpoint is already auth-gated (`Depends(current_user)`); the intent returned is always the calling user's. No new surface.
- No logging of new PII — we render the same fields that were already written by the commit handler.

## Technical Approach

A new component `client/ui/src/components/proposal/BlockIntentCard.tsx` accepts `{ streamName: string }`, fetches `GET /api/streams/{name}/intent` via a new `fetchStreamIntent()` helper in `client/ui/src/services/buildApi.ts`, and renders the read-only card. Both `StreamInspector` and `BlockInspector` mount `<BlockIntentCard streamName={...}/>` as a section in their existing layouts. The card handles its own loading / 404-hidden / error-placeholder states internally — the inspectors don't need to know when intent data exists.

Uses the existing `apiFetch` JSON helper + a small `useStreamIntent(streamName)` hook in `client/ui/src/hooks/useStreamIntent.ts` that returns `{ status: "loading" | "hidden" | "ready" | "error", intent?: StoredBlockIntent, error?: string }`. `status === "hidden"` fires on 404 and tells the card to render nothing. Dedup via the hook's `useEffect` deps + an internal "last-fetched name" ref.

### Data shape changes
- None on the server. `StoredBlockIntent` / `StreamIntentResponse` already exist in both `server/api/models.py` and `client/ui/src/types.ts` from M3.

### Files to create
- `client/ui/src/services/buildApi.ts` — add `fetchStreamIntent(streamName: string): Promise<StoredBlockIntent | null>` (returns `null` on 404 to distinguish "hidden" from "error").
- `client/ui/src/hooks/useStreamIntent.ts` — hook wrapping the fetch with the 4-state status model.
- `client/ui/src/components/proposal/BlockIntentCard.tsx` — the read-only card component.

### Files to modify
- `client/ui/src/components/workbench/inspectors/StreamInspector.tsx` — render `<BlockIntentCard streamName={focus.name}/>` below the existing content.
- `client/ui/src/components/workbench/inspectors/BlockInspector.tsx` — render `<BlockIntentCard streamName={focus.streamName}/>`.

## Test Cases
- **Stream with intent:** focus a stream that was committed via Build → card renders with phrasing + preset + timestamp.
- **Stream without intent (pre-M3):** focus a stream with no row → card is hidden (no DOM output).
- **Manual-drawer block:** focus a stream created via "+ Manual block" (no orchestrator) → 404 → card hidden.
- **Custom derivation with concerns:** focus a stream whose synthesis.choice is Mode B with non-empty critique.concerns → card shows phrasing + "Custom derivation" heading + the amber concerns list.
- **Focus change dedup:** focus stream A → focus stream A again → no second fetch (hook's dep-based memoisation).
- **Error path:** server 500 → card renders a small "couldn't load intent" placeholder. Network error → same treatment.
- **Rapid focus changes:** focus A → focus B within 50ms → the response from A (if it lost the race) is discarded; the card shows B's data.

## Out of Scope
- **Edit / replay / re-run** flows. Read-only today. If the trader wants to modify an intent they rephrase and commit a new block.
- **Cross-user visibility.** Each user sees only their own intents.
- **Linking from the intent back to the original chat transcript.** Chat history is client-only and not persisted.
- **Stream-list preview.** The stream list doesn't surface "has-intent" badges; only the focused view does.
- **Backfilling intents for older blocks.** Pre-M3 blocks stay without intent rows.
