# Todo

Active work tracker. Three sections: In Progress, Completed This Session, Blocked. Delete or archive old entries when a session ends.

## In Progress

_(Format example — replace with real entries as work starts.)_

- [ ] Example feature: add FOMC event stream preset
    - [ ] Read `server/api/stream_registry.py` and `client/ui/src/components/studio/StreamCanvas.tsx` to understand the 7-section config
    - [ ] Add preset button in `StreamLibrary.tsx`
    - [ ] Verify via `/kickoff` + manual activation flow

## Completed This Session

- [x] 2026-04-18 — UX redesign Phase 1: focus-driven Workbench. Unified Floor + Brain into `WorkbenchPage`; added `FocusProvider` (typed `Focus` union), `WorkbenchRail` with Inspector + Chat tabs, five inspector surfaces (cell / symbol-expiry / stream / block / empty); rewired all clickable surfaces to set focus instead of opening chat; removed `ChatProvider.investigate()` auto-open; new `GET /api/streams/{name}/timeseries` endpoint; hotkeys (`?`, `[`, `]`, `Esc`, `g`-chords); deleted `FloorPage`, `BrainPage`, `SelectionProvider`, `useFocusedCell`, `ChatDrawer`. See `docs/decisions.md` 2026-04-18.

## Phase 2 — Shell + visual language (next)

- [ ] Left sidebar nav (mode + quick-jump panes); top-right `<AccountMenu/>`; bottom `<StatusBar/>` with WS health + tick latency.
- [ ] Density token pass — 12px base, 28px row defaults; tightened glass scale (layered blur + subtle elevation).
- [ ] Reusable `<Tabs/>` and `<Sidebar/>` primitives rolled across Anatomy + Docs (replace bespoke implementations).
- [ ] Re-evaluate `react-grid-layout` for Workbench — likely demote to a 2–3 fixed-slot layout now that the Inspector carries contextual content.
- [ ] Command palette: add action commands (create stream, toggle rail, etc.) — Phase 1 is jump-to-only.

- [x] 2026-04-09 — Migrate harness to Agentic Coding Playbook (Claude Code primary, Windsurf secondary in exact sync). See `docs/decisions.md` entry dated 2026-04-09.

## Blocked

_(Format example — always include the reason.)_

- [ ] Example: switch `POSIT_MODE` to `prod` — **blocked:** universal data adapter not yet built (`client/adapter/` is OFF, see `docs/stack-status.md`).

## Follow-ups (deferred items from the harness migration)

- [ ] Install prettier + ruff; add post-edit formatter hooks to `.claude/settings.json`.
- [x] Source file decomposition per 300-line convention — `server/api/main.py` (Phase 3), `PipelineChart.tsx` (Phase 4), `DesiredPositionGrid.tsx` (Phase 4), `ApiDocs.tsx` 618→258 (2026-04-17 refactor, extracted sections to `apiDocs/`), `BlockDrawer.tsx` 444→291 (2026-04-17 refactor, hooks to `useBlockDraftSubmit` / `useSnapshotEditor`), `server/core/transforms.py` 831→10-file `transforms/` package (2026-04-17 refactor). Doc-sync completed 2026-04-17.
- [ ] Tune Stop-hook latency after one week of use — if `tsc --noEmit` at every agent turn becomes painful, demote from `Stop` to manual invocation.
