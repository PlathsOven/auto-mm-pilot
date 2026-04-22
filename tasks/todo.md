# Todo

Active work tracker. Three sections: In Progress, Completed This Session, Blocked. Delete or archive old entries when a session ends.

## In Progress

- [ ] **SDK integrator-audit follow-through (2026-04-22).** Audit source in `.context/attachments/pasted_text_2026-04-22_10-14-33.txt`; Tier 1 done in this branch.
    - **Tier 2** (new first-class features, separate PRs):
        - [ ] §2.1 server-side refuse-first-row-without-market-value — `allow_zero_edge` flag on ingest, Pydantic'd, SDK-plumbed. Touches `server/api/routers/snapshots.py` + `server/api/stream_registry.py` + SDK `ingest_snapshot` / `push_snapshot`.
        - [ ] §4.1 `PositClient.push_fanned_snapshot(stream, rows, fan_over, universe)` — explodes a scalar-shaped source across a caller-supplied (symbol, expiry) universe.
        - [ ] §7.1 `GET /api/diagnostics/zero-positions` server endpoint + SDK `client.diagnose_zero_positions()` — per (symbol, expiry) raw/market/edge/variance + closed-enum reason-for-zero.
    - **Tier 3** (structural changes, individual specs each):
        - [ ] §9.1 `PositionPayload.transport` (literal `ws|poll`) — server + SDK.
        - [ ] §7.2 `client.events()` — async iterator of structured `IntegratorEvent` objects.
        - [ ] §6.1 REST `ingest_snapshot` returns server-assigned monotonic `seq`; kill the `seq=-1` fabrication.
        - [ ] §9.2 `PositionPayload.seq` + `GET /api/positions/since?seq=` replay endpoint.
        - [ ] §3.2 Server-side `key_cols` superset/subset migration without wiping rows.
        - [ ] §4.2 `client.row_class_for(stream_name)` — per-stream typed `SnapshotRow` codegen.
    - **Tier 4** (out-of-codebase): §1.1 PyPI publish with SemVer + compat matrix.

## Completed This Session

- [x] 2026-04-22 — SDK integrator-audit Tier 1 (no-new-endpoint cleanup). Flipped `connect_ws` default to `False`; added `FutureWarning` on `create_stream`/`configure_stream`; added `configure_stream_for_variance` / `configure_stream_for_linear` factories; `BlockConfig.decay_end_size_mult` sentinel resolution; per-field docstrings on every `BlockConfig` field; `PositZeroEdgeWarning` typed-warning surfacing on `positions()`; fixed `:8000` → `:8001` docstrings; quickstart gains dual-auth, canonical-timestamp, canonical-market-value, deprecation note. See `docs/decisions.md` 2026-04-22 entry.

- [x] 2026-04-21 — Motion + branded splash pass. Added framer-motion (~55KB gz). New primitives: `PositLogo.tsx`, `PositSplash.tsx`, `useAppReady.ts`. Pre-hydration splash in `index.html` + React-owned splash gated on first WS tick (min 400ms display). Overlays animated: `BlockDrawer`, `CommandPalette`, `HotkeyCheatsheet`, `NotificationsCenter`, `ChatDock`, `OnboardingFlow`. Auth↔app fade + mode cross-fade in `App.tsx`. Login panel toggle (login/signup) now transitions between states; confirm-password row expands. LeftNav brand + label transitions, `whileTap` scale on NavButton, smoother sidebar width easing. `prefers-reduced-motion` honored via `index.css` + framer's reducer. See `docs/decisions.md` 2026-04-21 (Motion language + branded splash entry) and `UI_SPEC.md` §5.

- [x] 2026-04-18 — UX redesign Phase 1: focus-driven Workbench. Unified Floor + Brain into `WorkbenchPage`; added `FocusProvider` (typed `Focus` union), `WorkbenchRail` with Inspector + Chat tabs, five inspector surfaces (cell / symbol-expiry / stream / block / empty); rewired all clickable surfaces to set focus instead of opening chat; removed `ChatProvider.investigate()` auto-open; new `GET /api/streams/{name}/timeseries` endpoint; hotkeys (`?`, `[`, `]`, `Esc`, `g`-chords); deleted `FloorPage`, `BrainPage`, `SelectionProvider`, `useFocusedCell`, `ChatDrawer`. See `docs/decisions.md` 2026-04-18.

- [x] 2026-04-18 — UX redesign Phase 2: AppShell + visual language. New `<AppShell/>` (LeftNav + main slot + StatusBar) replaces `<GlobalContextBar/>`. Reusable `<Tabs/>` + `<Sidebar/>` primitives; Tabs adopted by WorkbenchRail / DesiredPositionGrid view modes / LlmChat mode select. Refined glass tokens (saturate + inset highlight + `shadow-elev-*` scale), 11px base font, tighter cell padding. Optional grain overlay behind `VITE_UI_GRAIN=1`. Deleted `GlobalContextBar.tsx`, `LayoutProvider.tsx`, `PanelWindow.tsx`, `react-grid-layout` dep. See `docs/decisions.md` 2026-04-18 (Phase 2 entry).

## Phase 3 candidates

- [ ] Refactor `WorkbenchRail` + Anatomy `StreamSidebar` onto the shared `<Sidebar/>` primitive.
- [ ] Promote `Cmd-K` palette beyond jump-to: action commands (create stream, toggle rail, set mode parameters).
- [ ] Wire the `Posit Control` toggle through to the server so the automation flag is honoured (today it's UI-only).
- [ ] Code-split the JS bundle — single chunk is at ~608KB gzipped (vite warning).
- [ ] Vectorise `fv_standard` + `fv_flat_forward` in `server/core/transforms/fair_value.py` — two ~90 LOC transforms share ~80% of a per-block × per-risk-dim time-grid filter loop. Deferred from the 2026-04-21 refactor sweep because the start_ann / end_ann math is row-scalar and doesn't fold naturally into a cross-join; needs a dedicated pass with a parquet-baseline parity check per the ULP-drift lesson in `tasks/lessons.md`.

- [x] 2026-04-09 — Migrate harness to Agentic Coding Playbook (Claude Code primary, Windsurf secondary in exact sync). See `docs/decisions.md` entry dated 2026-04-09.

## Blocked

_(Format example — always include the reason.)_

- [ ] Example: switch `POSIT_MODE` to `prod` — **blocked:** universal data adapter not yet built (`client/adapter/` is OFF, see `docs/stack-status.md`).

## Follow-ups (deferred items from the harness migration)

- [ ] Install prettier + ruff; add post-edit formatter hooks to `.claude/settings.json`.
- [x] Source file decomposition per 300-line convention — `server/api/main.py` (Phase 3), `PipelineChart.tsx` (Phase 4), `DesiredPositionGrid.tsx` (Phase 4), `ApiDocs.tsx` 618→258 (2026-04-17 refactor, extracted sections to `apiDocs/`), `BlockDrawer.tsx` 444→291 (2026-04-17 refactor, hooks to `useBlockDraftSubmit` / `useSnapshotEditor`), `server/core/transforms.py` 831→10-file `transforms/` package (2026-04-17 refactor). Doc-sync completed 2026-04-17.
- [ ] Tune Stop-hook latency after one week of use — if `tsc --noEmit` at every agent turn becomes painful, demote from `Stop` to manual invocation.
