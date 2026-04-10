# Spec: Phase 4 — Client Decomposition

> **Status:** APPROVED, ready to execute.
> **Parent spec:** `tasks/spec-refactor-convergence.md` (Phases 1-3 already
> landed).
> **Prerequisite commits:** Phase 1 (`64a8f16`), Phase 2 (`4c41ee8`), and
> Phase 3 (committed separately per
> `tasks/spec-phase3-server-decomposition.md`) — all on `generalisation`.
> **Branch:** stay on `generalisation`. After this phase, open a single PR
> `generalisation` → `main`.

---

## 0. Overview

Break up the client mega-components that hide state complexity, extract
reusable hooks, hoist magic numbers to a central `constants.ts` module, fix
three targeted bugs (abort-signal race, edit-on-timeframe-switch,
AnatomyCanvas over-subscription), and clean up the two remaining
`eslint-disable` comments.

**Non-goal:** feature work. The operator and trader should see identical
behavior before and after — just with fewer glitches and a calmer render
profile.

---

## 1. Decisions Already Made (do NOT re-ask)

1. `server/core/` is **HUMAN ONLY**. Never write to it.
2. `# HUMAN WRITES LOGIC HERE` stubs are sacred.
3. Branch: `generalisation`. One commit for this phase.
4. No barrel files. Named exports only.
5. No new test framework.
6. `ApiDocs.tsx` (727 LOC) is out of scope — pure presentation, not a bug
   source.
7. The 47 ms `GLOBAL_CONTEXT_TICK_MS` constant — verified as `47` on
   `GlobalContextBar.tsx:18`.

---

## 2. Acceptance Criteria

All of the following must hold after Phase 4:

- [ ] `npm --prefix client/ui run typecheck` passes clean.
- [ ] `python -m compileall server/ -q` passes clean.
- [ ] `./start.sh` → all panels render → pipeline chart populates across all
      4 decomposition modes → manual block create/delete → investigation SSE
      streams.
- [ ] `client/ui/src/components/PipelineChart.tsx` is **< 300 LOC**.
- [ ] `client/ui/src/components/DesiredPositionGrid.tsx` is **< 300 LOC**.
- [ ] `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx` is
      **< 350 LOC**.
- [ ] No magic numbers remain inline in provider/component files — all
      hoisted to `constants.ts` or `server/api/config.py`.
- [ ] React DevTools profiler: none of the following re-render on the 47 ms
      `GlobalContextBar` tick: `DesiredPositionGrid`, `UpdatesFeed`,
      `AnatomyCanvas`, `PipelineChart`, `LlmChat`, `LiveEquationStrip`.
- [ ] `WebSocketProvider` and `TransformsProvider` context values remain
      memoized (Phase 1 fix preserved).
- [ ] No `eslint-disable-next-line react-hooks/exhaustive-deps` comments
      remain in the codebase (the two existing ones are fixed, not carried).
- [ ] `tasks/todo.md` updated — completed decomposition follow-ups marked
      done.
- [ ] `git diff main...HEAD -- server/core/` is empty.

---

## 3. Out of Scope

- **Anything under `server/core/`.**
- **`ApiDocs.tsx` decomposition** (727 LOC, pure presentation).
- **Server-side changes** (Phase 3 handles those).
- **New tests or test framework.**
- **Lint / format tooling.**
- **Feature work of any kind.**

---

## 4. Step-by-Step Execution

### 4.1 Create `client/ui/src/constants.ts`

New file with all hoisted magic numbers:

```ts
/** UI constants. Any magic number that appears inline in a component belongs here. */

export const POLL_INTERVAL_TRANSFORMS_MS = 10_000;
export const POLL_INTERVAL_BLOCKS_MS = 5_000;
export const POLL_INTERVAL_TIMESERIES_MS = 5_000;
export const POLL_INTERVAL_SELECTION_MS = 5_000;

export const HOVER_DELAY_MS = 350;

export const SIDEBAR_DEFAULT_WIDTH_PX = 176;
export const SIDEBAR_MIN_WIDTH_PX = 120;
export const SIDEBAR_MAX_WIDTH_PX = 400;

export const UPDATE_HISTORY_MAX_LENGTH = 100;
export const GLOBAL_CONTEXT_TICK_MS = 47;
```

Then grep for each value and replace with a named import:

| File | Current (line) | Replacement |
|---|---|---|
| `TransformsProvider.tsx` | `POLL_INTERVAL_MS = 10000` (line 14) | Import `POLL_INTERVAL_TRANSFORMS_MS`, delete local |
| `SelectionProvider.tsx` | `POLL_MS = 5_000` (line 40) | Import `POLL_INTERVAL_SELECTION_MS`, delete local |
| `WebSocketProvider.tsx` | `.slice(0, 100)` (line 48) | Import `UPDATE_HISTORY_MAX_LENGTH`, use in slice |
| `GlobalContextBar.tsx` | `47` in setInterval (line 18) | Import `GLOBAL_CONTEXT_TICK_MS` |
| `DesiredPositionGrid.tsx` | `HOVER_DELAY_MS = 350` (line 26) | Import from `constants.ts`, delete local |
| `PipelineChart.tsx` | `176` (line 288), `120`/`400` (line 385), `5000` (lines 322, 361) | Import sidebar widths + poll intervals |

### 4.2 Decompose `PipelineChart.tsx` (780 → < 300 LOC)

Target structure after split:

```
client/ui/src/components/PipelineChart.tsx                  <- container, <300 LOC
client/ui/src/components/PipelineChart/DecompositionSidebar.tsx
client/ui/src/components/PipelineChart/chartOptions.ts      <- pure ECharts config builder
client/ui/src/hooks/usePipelineTimeSeries.ts                <- data fetching + caching
```

**Extraction map (line numbers from post-Phase-2 state):**

| Lines | Content | Destination |
|---|---|---|
| 16–27 | `BLOCK_COLORS` array | `chartOptions.ts` (exported) |
| 29–36 | Color constants (`SMOOTHED_COLOR` etc.) | `chartOptions.ts` |
| 38–45 | `DecompositionMode` type + `MODE_LABELS` | `chartOptions.ts` (exported) |
| 47–51 | `TOOLTIP_STYLE` | `chartOptions.ts` |
| 59–64 | `sci()` helper | `chartOptions.ts` (exported, used by sidebar too) |
| 70–248 | `DecompositionSidebar` component | `PipelineChart/DecompositionSidebar.tsx` |
| 250–275 | `tsCache` + LRU cache helpers | `hooks/usePipelineTimeSeries.ts` (module-level) |
| 281–376 | State + 3 useEffects (fetch dims, fetch TS, auto-switch) | `hooks/usePipelineTimeSeries.ts` |
| 378–403 | Sidebar drag + dimension change handlers | Stay in `PipelineChart.tsx` |
| 405–681 | ECharts `option` builder | `chartOptions.ts` as pure function `buildPipelineChartOptions(...)` |
| 682–779 | Render JSX | Stay in `PipelineChart.tsx` |

**Critical fix during split:** Line 325 has
`// eslint-disable-line react-hooks/exhaustive-deps`. When moving the
dimensions-fetch effect into `usePipelineTimeSeries.ts`, fix the root cause
by including the missing deps (or memoizing `doFetch` with `useCallback`).
Do NOT carry the disable comment over.

**The `usePipelineTimeSeries` hook should expose:**

```ts
export function usePipelineTimeSeries(selectedDimension: SelectedDimension | null) {
  // ...state, effects, cache...
  return {
    dimensions,
    selected, setSelected,
    data,
    error,
    loading,
  };
}
```

### 4.3 Decompose `DesiredPositionGrid.tsx` (425 → < 300 LOC)

Target structure:

```
client/ui/src/components/DesiredPositionGrid.tsx             <- renderer, <300 LOC
client/ui/src/hooks/usePositionEdit.ts                       <- edit state machine
client/ui/src/hooks/usePositionHover.ts                      <- hover timer state
```

**`usePositionEdit.ts`** extracts (from DesiredPositionGrid.tsx):
- `PendingEdit` interface (line 18)
- `pendingEdit` + `overrides` state (lines 36–37)
- `inputRef` + `prevEditKeyRef` refs (lines 40–41)
- Auto-focus effect (lines 45–51)
- `handleDoubleClick` (line 82)
- `confirmOverride` (line 91)
- `cancelEdit` (line 103)
- `removeOverride` (line 105)
- `getDisplayValue` (line 74)

Exposes:

```ts
export function usePositionEdit() {
  return {
    pendingEdit, overrides, inputRef,
    startEdit, confirmEdit, cancelEdit, removeOverride,
    getDisplayValue,
  };
}
```

**`usePositionHover.ts`** extracts:
- `hoverCell` state (line 39)
- `hoverTimeoutRef` (line 43)
- `handleMouseEnter` (line 113) — imports `HOVER_DELAY_MS` from `constants.ts`
- `handleMouseLeave` (line 120)
- Cleanup effect (lines 66–70)

Exposes:

```ts
export function usePositionHover() {
  return { hoverCell, onMouseEnter, onMouseLeave };
}
```

**Bug fix during split:** Currently switching `timeframe` while an edit is
pending does not cancel the edit. When moving edit state into
`usePositionEdit.ts`, make the parent call `cancelEdit()` on timeframe
change:

```tsx
// In DesiredPositionGrid.tsx, after both hooks:
const { cancelEdit, ... } = usePositionEdit();
useEffect(() => cancelEdit(), [timeframe]);
```

### 4.4 Fix `AnatomyCanvas.tsx` over-subscription (453 → < 350 LOC)

**File:** `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx`

**Problem 1 (line 88):** `const { payload } = useWebSocket()` but only
uses `payload?.positions.length` (line 149). Every tick re-renders the
entire React Flow tree.

**Fix:** Create a narrow selector hook in `WebSocketProvider.tsx`:

```ts
export function useWebSocketPositionCount(): number {
  const { payload } = useWebSocket();
  return payload?.positions.length ?? 0;
}
```

Replace line 88's destructure with `const positionCount = useWebSocketPositionCount()`.
Update line 149 to use `positionCount > 0` instead of
`(payload?.positions.length ?? 0) > 0`.

**Problem 2 (line 91):** `localSteps` state shadows provider state. The
effect syncs provider → local, creating a race if the user edits while a
poll is mid-flight.

**Fix:** Remove `localSteps`. Edit provider steps directly. Add `setSteps`
to `TransformsProvider`:

```ts
// In TransformsProvider.tsx, inside the provider component — steps state already exists:
const [steps, setSteps] = useState<Record<string, TransformStep> | null>(null);
// Expose setSteps in the context value:
const value = useMemo(
  () => ({ steps, setSteps, bankroll, loading, error, refresh }),
  [steps, bankroll, loading, error, refresh],
);
```

Update `TransformsContextValue` interface to include
`setSteps: React.Dispatch<React.SetStateAction<Record<string, TransformStep> | null>>`.

In `AnatomyCanvas.tsx`, replace `setLocalSteps(...)` with
`setSteps(...)` from the provider, then `await refresh()` to reconcile.

**Problem 3:** If `AnatomyCanvas.tsx` still exceeds ~350 LOC after fixes,
extract the React Flow node/edge builders. Use judgement — do not split if
the result is more confusing. The hard ceiling is comprehension, not LOC.

**Important:** The outer `AnatomyCanvas` wrapper (lines 76–82) is a
`<ReactFlowProvider>` — do NOT delete it. React Flow requires it.

### 4.5 Fix `useStreamContributions.ts` abort-signal race

**File:** `client/ui/src/hooks/useStreamContributions.ts`, lines 94–108

Currently `cache.set(...)` runs before the abort check. If the component
unmounts mid-fetch, the resolved promise still writes cached state.

**Fix:** Add abort guard before `cache.set` and `setState`:

```ts
fetchTimeSeries(cell.symbol, cell.expiry, controller.signal)
  .then((res) => {
    if (controller.signal.aborted) return;
    if (lastKeyRef.current !== key) return; // existing stale guard
    const contributions = buildContributions(res.currentDecomposition.blocks);
    cache.set(key, { fetchedAt: Date.now(), contributions });
    setState({ loading: false, contributions, error: null });
  })
  .catch((err: unknown) => {
    if (controller.signal.aborted) return;
    if (lastKeyRef.current !== key) return;
    setState({
      loading: false,
      contributions: null,
      error: err instanceof Error ? err.message : String(err),
    });
  });
```

### 4.6 Fix `StreamTable.tsx` exhaustive-deps disable

**File:** `client/ui/src/components/studio/StreamTable.tsx`, line 208

Remove the `eslint-disable-next-line react-hooks/exhaustive-deps` comment.
Include the missing dependencies (`openCanvas`, `handleDelete`) in the
`useMemo` deps array. If this causes the columns to rebuild too often, wrap
the callees in `useCallback` higher up the component tree.

**Expected approach:** The callbacks are likely stable already if defined
with `useCallback` — just adding them to deps should be safe. Verify by
checking whether `openCanvas` and `handleDelete` have stable references.

### 4.7 Clean up `tasks/todo.md`

The "Follow-ups" section includes:

> - [ ] Source file decomposition per 300-line convention. Candidates:
>   `server/api/main.py` (934), `client/ui/src/components/PipelineChart.tsx`
>   (779), ...

After Phase 4 lands, mark each decomposition candidate that was actually
addressed as done:
- `server/api/main.py` → done (Phase 3)
- `PipelineChart.tsx` → done
- `DesiredPositionGrid.tsx` → done

Leave `ApiDocs.tsx` (727) and `transforms.py` (726, HUMAN ONLY) as open.

Do **not** delete the formatter/prettier/ruff follow-up or the Stop-hook
latency note — those are untouched by this refactor.

---

## 5. Files Created

| New file | Purpose |
|---|---|
| `client/ui/src/constants.ts` | Centralized magic numbers (~15 LOC) |
| `client/ui/src/components/PipelineChart/DecompositionSidebar.tsx` | Extracted sidebar component |
| `client/ui/src/components/PipelineChart/chartOptions.ts` | Pure ECharts config builder + color/type constants |
| `client/ui/src/hooks/usePipelineTimeSeries.ts` | Data fetching + LRU cache for pipeline time series |
| `client/ui/src/hooks/usePositionEdit.ts` | Edit state machine for position grid |
| `client/ui/src/hooks/usePositionHover.ts` | Hover timer state for position grid |

## 6. Files Modified

| File | What changes |
|---|---|
| `client/ui/src/components/PipelineChart.tsx` | Gutted to container (~250 LOC) |
| `client/ui/src/components/DesiredPositionGrid.tsx` | Gutted to renderer (~280 LOC) |
| `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx` | Narrow WS hook, remove localSteps |
| `client/ui/src/components/studio/StreamTable.tsx` | Fix deps, remove eslint-disable |
| `client/ui/src/hooks/useStreamContributions.ts` | Abort-signal guard |
| `client/ui/src/providers/WebSocketProvider.tsx` | Add `useWebSocketPositionCount`, hoist 100 cap |
| `client/ui/src/providers/TransformsProvider.tsx` | Expose `setSteps`, hoist poll constant |
| `client/ui/src/providers/SelectionProvider.tsx` | Hoist poll constant |
| `client/ui/src/components/GlobalContextBar.tsx` | Hoist tick constant |
| `tasks/todo.md` | Mark decomposition follow-ups done |
| `tasks/progress.md` | Phase 4 handoff note |

---

## 7. Verification

```bash
npm --prefix client/ui run typecheck
python -m compileall server/ -q
./start.sh
```

Manual smoke test per acceptance criteria in §2. Pay special attention to:
- PipelineChart: all 4 decomposition modes, sidebar resize, instrument switch
- DesiredPositionGrid: double-click edit, timeframe switch cancels edit,
  hover card after 350 ms
- AnatomyCanvas: edit a transform param → persists; idle profiler → no
  re-renders
- Stream contribution hover cards still load

**Profiler re-verification:** React DevTools → Profiler → record 5 seconds
idle. No component outside `GlobalContextBar` should re-render on the 47 ms
tick.

---

## 8. Commit

```bash
git add client/ui/src/constants.ts \
        client/ui/src/components/PipelineChart.tsx \
        client/ui/src/components/PipelineChart/DecompositionSidebar.tsx \
        client/ui/src/components/PipelineChart/chartOptions.ts \
        client/ui/src/components/DesiredPositionGrid.tsx \
        client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx \
        client/ui/src/components/studio/StreamTable.tsx \
        client/ui/src/hooks/usePipelineTimeSeries.ts \
        client/ui/src/hooks/usePositionEdit.ts \
        client/ui/src/hooks/usePositionHover.ts \
        client/ui/src/hooks/useStreamContributions.ts \
        client/ui/src/providers/WebSocketProvider.tsx \
        client/ui/src/providers/TransformsProvider.tsx \
        client/ui/src/providers/SelectionProvider.tsx \
        client/ui/src/components/GlobalContextBar.tsx \
        tasks/todo.md \
        tasks/progress.md
git commit -m "refactor(phase4): decompose PipelineChart/DesiredPositionGrid, narrow WS subscriptions, hoist constants"
```

Never `git add .`. Never `--no-verify`. Never push unless explicitly asked.

---

## 9. After Phase 4 — PR + Doc Sync

After Phase 4 commits, the full refactor is complete. In a follow-up turn:

1. Invoke `/doc-sync` to update `docs/architecture.md` (Key Files table),
   `docs/conventions.md` (new canonical patterns), `tasks/lessons.md`.
2. Push `generalisation` to origin (with user approval).
3. Open PR `generalisation` → `main`:
   - Title: `refactor: pattern convergence and root-cause cleanup (4 phases)`
   - Body: reference `tasks/spec-refactor-convergence.md`.

---

## 10. Risks & Gotchas

1. **`DecompositionMode` string literals are UI-internal.** Do NOT rename
   them to camelCase — they are opaque UI state tokens, not wire field names.
2. **The 47 ms `GLOBAL_CONTEXT_TICK_MS`** — verified as `47` on
   `GlobalContextBar.tsx:18`. If the real value differs at execution time, use
   the real value.
3. **`AnatomyCanvas` `AnatomyCanvasInner`** — the outer component is a
   `<ReactFlowProvider>` wrapper (lines 76–82). Do not delete it.
4. **`types.ts` is load-bearing** — any typecheck error caused by the
   decomposition is probably a consumer you missed. Grep before moving on.
5. **Do not add tests** — no test framework exists.
6. **`PipelineChart/` directory** — this is a subdirectory alongside the
   existing `PipelineChart.tsx`. When the container file shrinks, some
   bundlers handle this fine; verify the import paths resolve.
