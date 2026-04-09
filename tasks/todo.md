# Todo

Active work tracker. Three sections: In Progress, Completed This Session, Blocked. Delete or archive old entries when a session ends.

## In Progress

_(Format example — replace with real entries as work starts.)_

- [ ] Example feature: add FOMC event stream preset
    - [ ] Read `server/api/stream_registry.py` and `client/ui/src/components/studio/StreamCanvas.tsx` to understand the 7-section config
    - [ ] Add preset button in `StreamLibrary.tsx`
    - [ ] Verify via `/kickoff` + manual activation flow

## Completed This Session

- [x] 2026-04-09 — Migrate harness to Agentic Coding Playbook (Claude Code primary, Windsurf secondary in exact sync). See `docs/decisions.md` entry dated 2026-04-09.

## Blocked

_(Format example — always include the reason.)_

- [ ] Example: switch `APT_MODE` to `prod` — **blocked:** universal data adapter not yet built (`client/adapter/` is OFF, see `docs/stack-status.md`).

## Follow-ups (deferred items from the harness migration)

- [ ] Install prettier + ruff; add post-edit formatter hooks to `.claude/settings.json`.
- [x] Source file decomposition per 300-line convention — `server/api/main.py` (Phase 3), `PipelineChart.tsx` (Phase 4), `DesiredPositionGrid.tsx` (Phase 4) done. Remaining candidates: `client/ui/src/components/ApiDocs.tsx` (727, pure presentation — deferred), `server/core/transforms.py` (726, HUMAN ONLY — exempt).
- [ ] Tune Stop-hook latency after one week of use — if `tsc --noEmit` at every agent turn becomes painful, demote from `Stop` to manual invocation.
