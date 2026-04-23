# Todo

Active work tracker. Three sections: In Progress, Completed This Session, Blocked. Delete or archive old entries when a session ends.

## In Progress

- [ ] **SDK integrator-audit Tier 4** (out-of-codebase): §1.1 PyPI publish with SemVer + compat matrix. Needs: decision on public vs. private index, versioning commitment (v0.1 → v0.2 removal of `create_stream`/`configure_stream`), compat-matrix format.

## Completed This Session

- [x] 2026-04-23 — Affordance honesty pass. Global `@layer base` rules in `index.css` give every clickable element `cursor: pointer`, every input `cursor: text`, every disabled control `cursor: not-allowed` (zero-specificity `:where` so utilities still win); a matching `:focus-visible` outline gives keyboard users an indigo ring. New `client/ui/src/components/ui/Tooltip.tsx` — framer-motion popover, 400ms hover / instant focus, Esc-dismiss, portal-rendered, cloneElement-based. Applied to every icon-only control in the AppShell chrome (LeftNav collapse + mode buttons when collapsed, StatusBar WS pill / tick / bankroll / Posit-Control / notifications / palette / cheatsheet / UTC, UserMenu avatar in compact mode), Anatomy (StreamNode active toggle + delete), Workbench (InspectorColumn drag + collapse, ChatDock resize + maximize + close, DesiredPositionGrid column + row headers with tabIndex + Enter/Space keyboard parity, HotkeyCheatsheet close). Typecheck + build clean.

- [x] 2026-04-23 — Cinematic auth page. New `client/ui/src/pages/LoginBackdrop.tsx` owns a full-bleed ambient stage (layered radial gradients matching the splash palette, two drifting blurred indigo/violet orbs, a slowly rotating concentric-rings motif echoing the brand mark, soft vignette). `LoginPage.tsx` reworked around it: hero lockup (breathing `PositLogo` @ 34px + "The framework for positional trading" tagline) above a dialled-up glass card (48px blur, saturate 1.6, inset top-edge highlight, deeper shadow). Inputs are frosted with an indigo focus-ring glow; submit button is a three-stop indigo→violet gradient with a top-edge specular shine. Entrance sequences backdrop → hero → card with layered delays. All motion routed through framer-motion so `prefers-reduced-motion` collapses it. Typecheck + build clean.

- [x] 2026-04-22 — SDK leanness pass: runtime primitives for long-running feeders. New `sdk/posit_sdk/runtime.py` with `forward_websocket` (reconnecting WS source), `repeat` (periodic timer), `run_forever` (supervisor). `PositClient.from_env()` classmethod + `PositClient.run(*tasks)` method. Exported from package root. Rewrote `/Users/seangong/Documents/Projects/deribit-pricer/tools/posit_feed.py` onto the new surface — 184 → 145 LOC, `main()` collapsed from ~18 lines of env/reconnect/supervisor plumbing to 8 declarative lines. `docs/sdk-quickstart.md` gains a "Long-running feeders" section and updates the checklist. 9 new runtime tests, 97 SDK tests total green.

- [x] 2026-04-22 — SDK integrator-audit Tier 1 (no-new-endpoint cleanup). Flipped `connect_ws` default to `False`; added `FutureWarning` on `create_stream`/`configure_stream`; added `configure_stream_for_variance` / `configure_stream_for_linear` factories; `BlockConfig.decay_end_size_mult` sentinel resolution; per-field docstrings on every `BlockConfig` field; `PositZeroEdgeWarning` typed-warning surfacing on `positions()`; fixed `:8000` → `:8001` docstrings; quickstart gains dual-auth, canonical-timestamp, canonical-market-value, deprecation note. See `docs/decisions.md` 2026-04-22 entry.

- [x] 2026-04-22 — Tier 2: server-side zero-edge guard (§2.1), push_fanned_snapshot helper (§4.1), diagnose_zero_positions() endpoint + wrapper (§7.1). One commit each.

- [x] 2026-04-22 — Tier 3: PositionPayload.transport freshness field (§9.1), client.events() structured stream (§7.2), server-assigned server_seq unifies REST + WS (§6.1), PositionPayload.seq + /api/positions/since replay (§9.2), superset/subset key_cols migration (§3.2), per-stream typed SnapshotRow via row_class_for (§4.2). One commit each.

- [x] 2026-04-21 — Motion + branded splash pass. Added framer-motion (~55KB gz). New primitives: `PositLogo.tsx`, `PositSplash.tsx`, `useAppReady.ts`. Pre-hydration splash in `index.html` + React-owned splash gated on first WS tick (min 400ms display). Overlays animated: `BlockDrawer`, `CommandPalette`, `HotkeyCheatsheet`, `NotificationsCenter`, `ChatDock`, `OnboardingFlow`. Auth↔app fade + mode cross-fade in `App.tsx`. Login panel toggle (login/signup) now transitions between states; confirm-password row expands. LeftNav brand + label transitions, `whileTap` scale on NavButton, smoother sidebar width easing. `prefers-reduced-motion` honored via `index.css` + framer's reducer. See `docs/decisions.md` 2026-04-21 (Motion language + branded splash entry) and `UI_SPEC.md` §5.

- [x] 2026-04-18 — UX redesign Phase 1: focus-driven Workbench. Unified Floor + Brain into `WorkbenchPage`; added `FocusProvider` (typed `Focus` union), `WorkbenchRail` with Inspector + Chat tabs, five inspector surfaces (cell / symbol-expiry / stream / block / empty); rewired all clickable surfaces to set focus instead of opening chat; removed `ChatProvider.investigate()` auto-open; new `GET /api/streams/{name}/timeseries` endpoint; hotkeys (`?`, `[`, `]`, `Esc`, `g`-chords); deleted `FloorPage`, `BrainPage`, `SelectionProvider`, `useFocusedCell`, `ChatDrawer`. See `docs/decisions.md` 2026-04-18.

- [x] 2026-04-18 — UX redesign Phase 2: AppShell + visual language. New `<AppShell/>` (LeftNav + main slot + StatusBar) replaces `<GlobalContextBar/>`. Reusable `<Tabs/>` + `<Sidebar/>` primitives; Tabs adopted by WorkbenchRail / DesiredPositionGrid view modes / LlmChat mode select. Refined glass tokens (saturate + inset highlight + `shadow-elev-*` scale), 11px base font, tighter cell padding. Optional grain overlay behind `VITE_UI_GRAIN=1`. Deleted `GlobalContextBar.tsx`, `LayoutProvider.tsx`, `PanelWindow.tsx`, `react-grid-layout` dep. See `docs/decisions.md` 2026-04-18 (Phase 2 entry).

## Phase 3 candidates

- [ ] Refactor `WorkbenchRail` + Anatomy `NodeDetailPanel` onto the shared `<Sidebar/>` primitive.
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
