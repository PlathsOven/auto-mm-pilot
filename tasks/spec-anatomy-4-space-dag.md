# Spec: Anatomy DAG — 4-space rewrite

Authored 2026-04-21 on branch `PlathsOven/pipeline-spaces` (new branch may be cut for this feature — decide at implement time).

## Overview

Rewrite the Anatomy canvas's DAG so it accurately represents the current
4-space pipeline (risk / raw / calc / target) for a single (symbol, expiry)
slice. The current DAG is a hand-wired sketch of the pre-rewrite pipeline
with `calc_to_target` bolted on; it misrepresents `variance`'s position,
omits `risk_space_aggregation` + `market_value_inference` entirely, hides
the 3-wire fair/var/market flow, and shows `decay_profile` as a standalone
step it isn't. This pass fixes all of the above, moves to a nodes =
transformations / edges = values ontology, visually encodes the 3 data
lanes (raw / calc / target) as coloured bands with `unit_conversion` and
`calc_to_target` straddling lane boundaries, and draws fair / var /
market as **three distinct parallel tracks** with per-track edges, per-
track handle positions, and per-track colours. Each edge label carries
its value's granularity suffix (`(block)` → `(block, t)` → `(space, t)`
→ `(t)`) so the graph doubles as a shape-of-data legend. Two structural
crossings are made visible in the geometry itself: `market_value_inference`
sits off the main horizontal line taking only `market + fair` in and
emitting only filled market (fair and var bypass it RSA → Aggregation
direct), and `calc_to_target` / `position_sizing` taper their handle
counts (3 → 2, then 2 → 1) so the `edge = fair − market` and
`pos = edge·b/var` merges read from the node shape alone.

## Ontology (load-bearing)

**Nodes are transformations. Edges are values.**

This is the rule every subsequent decision derives from. A transform that
reshapes data gets a node; a value that travels between transforms is an
edge label. `variance` and `decay_profile` are step-level *parameters*
that are (conceptually) per-stream, not pipeline-level, so they are
**not rendered on the global DAG at all** — they belong on per-stream
surfaces (future work) and are configurable today via the Transforms
API. The (4th) risk space is a property of blocks (their `space_id`
grouping), not a data lane — it surfaces visually through
`risk_space_aggregation`'s "mean across blocks per space" behaviour,
not as a separate band.

## Requirements

### User stories

- As a **desk head or operator**, when I open Anatomy, I want the DAG to
  match the pipeline code I can read in `server/core/pipeline.py` — so I
  can trust the graph as the mental model for what a tick actually does.
- As a **desk head**, I want the three data lanes (raw / calc / target)
  visually distinct, so I can immediately see where unit conversions happen
  and what each node's inputs are in.
- As a **desk head**, I want the three data tracks (fair / var / market)
  rendered as parallel coloured wires with their granularity annotated
  on every edge label, so I can read at a glance what each value carries
  and when the cardinality changes.
- As a **desk head**, when I click `risk_space_aggregation` or
  `market_value_inference`, I want the existing NodeDetailPanel pattern —
  same transform-swap UX as every other step.

### Acceptance criteria

- [ ] DAG nodes: `unit_conversion`, `temporal_fair_value` (displayed as
  "Temporal Distribution"), `risk_space_aggregation`,
  `market_value_inference`, `aggregation`, `calc_to_target`, `smoothing`,
  `position_sizing`. The first seven other than MVI sit on a single
  horizontal main line; MVI is placed below the main line in the gap
  between RSA and Aggregation.
- [ ] `variance` and `decay_profile` are **not rendered on the DAG at
  all** — neither as nodes nor as sub-chips. Rationale: both are
  conceptually per-stream parameters, not pipeline-level, so surfacing
  them on the global canvas would be misleading. They remain
  configurable via `/api/transforms`.
- [ ] Three horizontal lane bands cover the canvas background: **raw**
  (leftmost), **calc** (middle, widest), **target** (rightmost). Each band
  carries a faint label text at the top-left of its region.
- [ ] `unit_conversion` sits on the raw / calc boundary; `calc_to_target`
  sits on the calc / target boundary. Both are rendered so the split is
  visually unambiguous — either the node card spans both lanes, or a lane
  indicator chip in the node header names both spaces (e.g. "raw → calc").
- [ ] The three values (fair / var / market) render as **three parallel
  per-track edges** between each pair of main-line nodes, each with its
  own handle position and its own stroke colour (fair = indigo,
  var = orange, market = emerald). Every edge label carries its value's
  current granularity suffix:
  - streams → `unit_conversion`: one edge per stream labelled `(block)`
  - `unit_conversion` → `temporal_fair_value`: `fair(block)`, `var(block)`, `market(block)`
  - `temporal_fair_value` → `risk_space_aggregation`: `fair(block, t)`, `var(block, t)`, `market(block, t)`
  - `risk_space_aggregation` → `aggregation` (direct): `fair(space, t)`, `var(space, t)`
  - `risk_space_aggregation` → `market_value_inference`: `fair(space, t)`, `market(space, t)?`
  - `market_value_inference` → `aggregation`: `market(space, t)` (filled)
  - `aggregation` → `calc_to_target`: `fair(t)`, `var(t)`, `market(t)`
  - `calc_to_target` → `smoothing`: `edge(t)`, `var(t)` (fair + market merged into edge)
  - `smoothing` → `position_sizing`: `smoothed_edge(t)`, `smoothed_var(t)`
  - `position_sizing` → output: `position(t)` (edge + var merged into position)
- [ ] `market_value_inference` takes only `fair(space, t)` and
  `market(space, t)?` as inputs and emits only `market(space, t)` as
  output. Fair and var bypass MVI entirely — they go RSA → Aggregation
  direct. MVI is positioned below the main horizontal line so the
  "detour" through MVI is visible as a geometric dip in the market track
  only.
- [ ] `calc_to_target`'s handle count drops from 3 (fair / var / market
  in) to 2 (edge / var out), with `edge` positioned slightly above `var`
  so the 3 → 2 taper visibly signals the `edge = fair − market` merge.
  `position_sizing` then drops 2 → 1 for the `pos = edge · b / var`
  merge.
- [ ] Clicking `risk_space_aggregation` or `market_value_inference` opens
  `NodeDetailPanel` identically to every other existing node — no new
  panel variants, no code-paths branched for these nodes.
- [ ] Live WS status drives edge animation (existing behaviour preserved).
- [ ] Layout is hand-positioned via updated coordinates in
  `anatomyGraph.ts`. Column pitch is 520 px (≥ 280 px free space between
  cards) so three parallel per-track edges and their single-value
  labels sit between nodes without colliding.
- [ ] `/api/transforms` continues to expose `variance`, `variance_params`,
  `decay_profile`, `decay_profile_params` — both transforms remain
  configurable via the Transforms API even though the Anatomy DAG does
  not render them. No new endpoint surface; no changes to the
  transforms router.
- [ ] `npm --prefix client/ui run typecheck` clean.
- [ ] `npm --prefix client/ui run build` succeeds.

### Performance

Cold path — Anatomy is a mode the user opens occasionally, not part of the
per-tick hot loop. Graph rebuild runs on `useMemo`; node count stays under
20 for realistic stream counts (≤10 streams + 8 transform nodes + lane
backgrounds + output). No latency budget beyond "renders without frame
drop on open".

### Security

No new endpoints, no new auth surface. `/api/transforms` already gates
through `current_user`. No new logged fields.

---

## Technical Approach

Stay on the existing React Flow stack. The canvas keeps the horizontal
left-to-right flow with hand-positioned nodes; the change is:

1. **Node set**: drop `variance` and `decay_profile` from the DAG
   entirely (neither nodes nor sub-chips); add `risk_space_aggregation`
   and `market_value_inference`; keep everything else. MVI sits off the
   main line.
2. **Coordinate rework**: column pitch is 520 px (≥ 280 px gap between
   240-wide cards) on the main line so three parallel per-track edges
   fit between nodes. MVI is positioned below the main line at
   `Y_MVI = 440` (main line is at `Y_MAIN = 240`), horizontally inside
   the 520-px gap between RSA and aggregation, so the detour through
   MVI is visible as a geometric dip in the market track only.
3. **Lane bands**: three full-height, tinted rectangles rendered as
   non-interactive `laneBand` nodes emitted first in the nodes array
   (React Flow render-order puts them beneath transform cards), with
   `zIndex: -1` and `pointer-events-none` as belt-and-braces. Lane
   height is extended to 560 so the band cleanly covers MVI beneath
   the main line.
4. **Boundary nodes**: `unit_conversion` and `calc_to_target` each
   render a two-tone header chip ("raw → calc", "calc → target") in
   the existing `TransformNode`. The card sits at boundary X, and the
   visual "straddle" is conveyed by the chip.
5. **Per-track handles + parallel edges**: each main transform node
   exposes named handles for the tracks it consumes and produces —
   `fair` (top), `var` (middle), `market` (bottom) before CTT; `edge`
   (slightly above var) and `var` after CTT; single default handle at
   UC's input and PS's output. MVI's spec is the narrowed
   `in: ["fair", "market"], out: ["market"]`. `TRACK_TOP_PCT` pins
   the vertical handle positions; `TRACK_COLORS` drives edge stroke
   and handle dot colour so fair / var / market / edge read distinctly.
   Edges reference `sourceHandle` / `targetHandle` so each track
   renders as its own wire with its own single-value label.
6. **MVI routing**: RSA drives fair, var, market outputs. `fair` has
   two consumers: one edge to `aggregation`'s fair input (main line)
   and one edge to MVI's fair input (inference). `var` has one
   consumer: `aggregation`'s var input (main line). `market` has one
   consumer: MVI's market input. MVI's single `market` output carries
   the filled value up to `aggregation`'s market input. The visual
   result: fair + var stay on the horizontal main line; only the
   market track dips down through MVI and returns.
7. **Granularity labels**: every edge label is of the form
   `value(granularity)`. Granularity transitions are driven by the
   pipeline structure: `(block)` pre-temporal-distribution →
   `(block, t)` post-distribution → `(space, t)` post-RSA/MVI →
   `(t)` post-space-aggregation and onward.
8. **Merge visualisation**: `calc_to_target` declares 3 inputs (fair /
   var / market) + 2 outputs (edge / var); `position_sizing` declares
   2 inputs + default (1) output. The handle-count taper makes the
   `edge = fair − market` and `pos = edge · b / var` non-linear
   combinations visible in the graph geometry; the formulas also
   appear in the node narrative.
9. **`useTransformEditors.ts`**: unchanged — the hook iterates by key
   and handles `risk_space_aggregation` + `market_value_inference`
   through the existing generic path.

Data flow entry:
- Server `/api/transforms` already returns the two new steps (wired in
  the previous pipeline-4-space PR). The Anatomy graph reads from the
  same TransformsProvider cache it uses today.

### Data shape changes

- `server/api/models.py`: **no changes**. The transforms endpoint already
  emits every registered step including the two new ones.
- `client/ui/src/types.ts`: **no changes**. `TransformStep` is keyed by
  step name — adding new step names at the DAG layer is pure UI config.

### Files to create

None. Everything fits inside the existing `studio/anatomy/` module.

### Files to modify

- `client/ui/src/components/studio/anatomy/anatomyGraph.ts` — Rewrite
  `PIPELINE_ORDER` to the 8 displayed steps (drop variance + decay).
  Rewrite `X` at 520 px pitch + `Y_MAIN` + `Y_MVI`; place MVI in the
  gap between RSA and aggregation below the main line. Rewrite
  `STEP_NODE_POSITIONS`. Add `TrackKey`, `TRACK_TOP_PCT`,
  `TRACK_COLORS`, and `NODE_TRACKS` (per-node `in`/`out` handle list).
  Rewrite `PIPELINE_EDGES` as per-track edges carrying
  `sourceHandle` / `targetHandle` with granularity-suffixed labels.
  Add `LANE_BANDS` (extend `LANE_HEIGHT` to 560), `LANE_BOUNDARIES`.
  Rename `temporal_fair_value`'s display label to "Temporal
  Distribution" (step key unchanged).
- `client/ui/src/components/studio/anatomy/buildAnatomyGraph.ts` —
  Update `STEP_LABELS` (Temporal Distribution; drop variance + decay).
  Emit lane-band nodes first. Populate `data.laneBoundary`,
  `data.inTracks`, `data.outTracks`. Pipe edge stroke colour from the
  source track.
- `client/ui/src/components/studio/anatomy/nodes/TransformNode.tsx` —
  Accept optional `laneBoundary`, `inTracks`, `outTracks` in `data`.
  Render multiple Handles per side at `TRACK_TOP_PCT` positions with
  track colour; fall back to a single default handle when the track
  list is empty.
- `client/ui/src/components/studio/anatomy/nodes/LaneBandNode.tsx` —
  **New.** Non-interactive background rectangle with `label`, `width`,
  `height`, `tint` from `data`. `pointer-events-none` so clicks never
  get swallowed from the transform cards above.
- `client/ui/src/components/studio/anatomy/AnatomyCanvas.tsx` —
  Register the `laneBand` node type. In `onNodeClick`, ignore clicks
  on lane-band nodes.
- `client/ui/src/components/studio/anatomy/NodeDetailPanel.tsx` —
  Unchanged. Renders RSA + MVI through the generic `TransformStep`
  path.
- `client/ui/src/components/studio/anatomy/useTransformEditors.ts` —
  Unchanged.
- `docs/architecture.md` Key Files entry for the anatomy module stays
  as-is; no doc churn this pass.

---

## Test Cases

- **Happy path.** Open Anatomy with a populated pipeline. Seven
  transform nodes render on the main horizontal line in pipeline order
  (UC, Temporal Distribution, RSA, Aggregation, CTT, Smoothing, PS);
  MVI sits below the line between RSA and Aggregation. Lane bands are
  visible behind everything. Three coloured tracks (fair / indigo,
  var / orange, market / emerald) run in parallel; every edge carries
  a granularity-suffixed label. CTT's handle count tapers 3 → 2 and
  PS's tapers 2 → 1.
- **MVI routing.** Trace the market track: RSA → MVI → Aggregation
  (two edges, one in each direction). Fair track: RSA → MVI
  (inference input) and RSA → Aggregation direct (main line). Var
  track: RSA → Aggregation direct; does not touch MVI.
- **Click `risk_space_aggregation`.** Panel opens, lists `arithmetic_mean`
  (default) + `confidence_weighted_mean` (registered but NotImplemented).
  Selecting `confidence_weighted_mean` + running the pipeline produces
  the NotImplementedError from the server — an expected path, out of
  scope to handle gracefully in this spec.
- **Click `market_value_inference`.** Panel opens, lists the two
  existing transforms (`time_varying_proportional`,
  `passthrough`). Swap works, pipeline reruns, broadcast updates.
- **Variance and decay_profile are absent from the DAG.** Confirmed by
  grepping the rendered node list. Both remain configurable via
  `/api/transforms`.
- **Empty state.** No streams registered → the streams column renders
  empty, the transform nodes still render, lane bands still render. No
  errors.
- **Live toggle.** WS connected → edges animate. Disconnected → edges
  static. Same as today.
- **Lane bands at different canvas widths.** Resize the canvas; bands
  should resize to follow their node groupings, not stay at a fixed
  absolute width. (Implementation note: derive band widths from the X
  coordinates of the first and last node in each lane.)
- **Typecheck + build.** Both run clean.

---

## Out of Scope

- **Confidence-weighted risk-space aggregation.** The transform is
  registered (NotImplementedError) per the previous spec. Actually
  implementing it is a separate spec.
- **Vertical / multi-track visual for risk-space aggregation.** The user
  explicitly declined (answer 4: "the DAG just shows the pipeline for a
  single symbol/expiry"), so RSA is a single node on the main track. If
  we ever want to show the block-to-space fan-in as visibly multiple
  input wires, that's a separate pass.
- **`applies_to` visualisation.** Declined (answer 4). The DAG is
  single-dim; applies_to fan-out is a stage A detail not represented.
- **Streams column redesign.** The stream-stack visual is unchanged.
- **`PipelineChartPanel`, `NodeDetailPanel` transform-selector UX,
  Studio Anatomy interaction model** — all stay as-is (answer 9).
- **Route the `calc_to_target_params` + `risk_space_aggregation_params`
  sliders through the panel.** The transforms endpoint already exposes
  the params schema; the panel should pick them up via the existing
  generic path. If it doesn't, treat as a bug and fix inline, not a
  new feature.

---

## Open Implementation Questions (decide in-session, not blockers)

- **Lane backgrounds as React Flow Background plugin vs. non-interactive
  background nodes.** Plugin is cleaner for static bands; custom nodes
  give more styling control. Prefer plugin unless z-index or styling
  constraints force otherwise.
- **Sub-chip click propagation.** The sub-chip inside the TFV node needs
  to stop event bubbling so clicking the chip doesn't also open the
  TFV panel. React Flow node click handlers need the guard at the
  sub-chip click level.
- **Boundary-chip vs. card-straddling for `unit_conversion` /
  `calc_to_target`.** Pick chip-in-header during implementation unless
  straddling renders cleanly without layout pain.
- **Label truncation for long 3-value bundles.** If the label would
  overflow the horizontal gap, truncate to 2 values + `…` on the
  rendered edge; keep the full bundle in the React Flow edge tooltip.
  (Soft requirement — revisit after seeing real render.)
