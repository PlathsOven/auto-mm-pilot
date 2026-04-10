# Spec: Block Canvas — Interactive Time-Axis Block Editor

## Overview

Replace the ECharts time-series Pipeline Analysis panel with an interactive SVG canvas where blocks are positioned on a shared time axis. Two stacked lanes (fair value, variance) show each block's exact server-computed shape. Manual blocks can be dragged horizontally to change their start time, resized via right-edge drag to change their decay rate, edited via the existing AddBlockDrawer, and deleted. Stream-driven blocks are locked and read-only. Every canvas interaction that changes a block triggers an API round-trip; both lanes and the Block Inspector table update from the server response.

## Requirements

### User stories

- As the **trader**, I want to see every block's contribution to fair value and variance on a time axis, so I can understand how each data source and opinion shapes my desired position over time.
- As the **trader**, I want to drag a manual block to a new start time on the canvas, so I can reposition an opinion or one-off data point without opening a form.
- As the **trader**, I want to resize a manual block's right edge to change how quickly it decays, so I can control its temporal influence directly.
- As the **trader**, I want to delete a manual block from the canvas, so I can remove a stale opinion without navigating away.
- As the **trader**, I want to click a manual block and edit its full parameters in a drawer, so I can fine-tune things that aren't exposed as drag interactions (aggregation logic, var_fair_ratio, etc.).

### Acceptance criteria

- [ ] **Two-lane canvas**: Fair value lane (top) and variance lane (bottom) share a single time axis. Blocks appear as filled area shapes in both lanes simultaneously.
- [ ] **Exact shapes**: Block shapes are drawn from the server's per-block `fair[]` and `var[]` time-series arrays (from `/api/pipeline/timeseries`), not client-side approximation.
- [ ] **Stacking**: Offset blocks within the same `space_id` stack cumulatively (each block's baseline = top of previous block). Average blocks share the same baseline. Stacking order is consistent (sorted by `block_name`).
- [ ] **Instrument selector**: Symbol/expiry dropdown filters which blocks are visible. Expiries are ISO timestamps throughout.
- [ ] **Manual block drag**: Horizontal drag on a manual block shows an optimistic preview (time-shifted shape). On release, `PATCH /api/blocks/{stream_name}` fires with updated snapshot timestamp. Server recalculates; canvas re-renders with exact new shapes.
- [ ] **Manual block resize**: Right-edge drag handle on manual blocks. Wider = slower decay (lower `decay_rate_prop_per_min`). On release, `PATCH` fires with updated decay parameters.
- [ ] **Manual block edit**: Click a manual block → AddBlockDrawer opens pre-filled with that block's current values.
- [ ] **Manual block delete**: Delete affordance on manual blocks → `DELETE /api/blocks/{stream_name}` → block removed, canvas re-renders.
- [ ] **Manual block create**: "Add block" button opens AddBlockDrawer (existing flow).
- [ ] **Stream blocks locked**: Stream-driven blocks are visually distinct (muted appearance) and have no drag handles, resize handles, or delete affordance.
- [ ] **Shifting blocks pinned**: Blocks with `temporal_position="shifting"` are pinned to the "now" marker on the time axis and cannot be dragged. They move with the clock.
- [ ] **"Now" marker**: Vertical line on the time axis showing current server time.
- [ ] **Zoom/pan**: Mouse wheel zooms the time axis; click-drag on empty canvas space pans.
- [ ] **Aggregated summary**: Header strip shows total fair, total variance, edge, and desired position for the selected instrument.
- [ ] **Block Inspector table stays**: EditableBlockTable remains below the canvas. Both views reflect the same data and update together.
- [ ] **Color-coded blocks**: Each block has a distinct color (using existing `BLOCK_COLORS` palette). Same color in both lanes and in the table.

### Performance

- Canvas re-renders on each 5s poll cycle (same as current PipelineChart). No WS dependency.
- SVG rendering of ~20 blocks × ~200 time points per block should be well under 16ms frame budget.
- Drag preview must feel immediate (< 50ms per frame during drag) — optimistic time-shift, no API call until release.

### Security

- No new auth surfaces. Uses existing `/api/blocks` and `/api/pipeline/timeseries` endpoints.
- New `DELETE /api/blocks/{stream_name}` endpoint — only allows deleting manual blocks (server enforces).
- No new WS channels.

## Technical Approach

The canvas is a custom SVG component (not React Flow — the time-axis positioning, decay shapes, and stacking visualization are fundamentally a timeline editor, not a node graph). Data comes from two merged sources:

1. **`fetchBlocks()`** → `BlockRow[]` — block metadata: source (stream/manual), parameters, editability.
2. **`fetchTimeSeries(symbol, expiry)`** → `PipelineTimeSeriesResponse` — per-block `{ timestamps[], fair[], var[] }` for exact shapes, plus aggregated totals.

These are merged by matching `BlockRow.block_name` to `BlockTimeSeries.blockName`. The canvas renders each block as a filled SVG `<path>` drawn from the server's time-series arrays. Stacking is computed client-side from the server's per-block values: for offset blocks, each block's area baseline = cumulative sum of preceding blocks' values at each timestamp.

**Drag interaction**: During drag, the block's shape is shifted by the pixel→time delta (optimistic preview). On `mouseup`, `updateBlock()` fires with new snapshot timestamps. The next poll picks up the server's recalculated shapes.

**Resize interaction**: The right edge of manual blocks is a drag handle. During resize, the block's shape is redrawn with the new width. On release, the new `decay_rate_prop_per_min = 1 / newDurationMinutes` is sent via `updateBlock()`. `decay_end_size_mult` is preserved; if the block was previously non-decaying (rate=0 or mult=1), resize sets `decay_end_size_mult = 0` as the starting point.

### Data shape changes

**`server/api/models.py`:**
- No new models. `DELETE` returns 204 No Content.

**`server/api/routers/blocks.py`:**
- New endpoint: `DELETE /api/blocks/{stream_name}` — validates block is manual-sourced, calls `registry.delete()`, re-runs pipeline, returns 204.

**`client/ui/src/types.ts`:**
- No changes needed. Existing `BlockRow`, `BlockTimeSeries`, `PipelineTimeSeriesResponse` cover all data shapes.

**`client/ui/src/services/blockApi.ts`:**
- Add `deleteBlock(streamName: string): Promise<void>`.

### Files to create

- `client/ui/src/components/BlockCanvas/BlockCanvas.tsx` — Main component: SVG canvas with two lanes, header bar (instrument selector + summary + add button), zoom/pan state, block interactions (drag, resize, delete, click-to-edit). Wraps the sub-components.
- `client/ui/src/components/BlockCanvas/BlockShape.tsx` — SVG `<path>` renderer for a single block. Takes time-series arrays + time→pixel scale + stacking baseline. Renders filled area shape. Conditionally renders drag handle (left edge) and resize handle (right edge) for manual blocks. Renders delete button. Handles mousedown for drag/resize.
- `client/ui/src/components/BlockCanvas/TimeAxis.tsx` — SVG time axis ruler: tick marks, time labels, "now" marker, gridlines. Shared between both lanes.
- `client/ui/src/components/BlockCanvas/useBlockCanvas.ts` — Hook that merges `fetchBlocks()` + `fetchTimeSeries()`, computes stacking layout (cumulative baselines for offset blocks), provides time↔pixel mapping functions, and exposes the merged block list with both metadata and shape data.

### Files to modify

- `client/ui/src/components/PipelineChart.tsx` — Rewrite: render `<BlockCanvas />` instead of ECharts. Remove all ECharts imports.
- `client/ui/src/pages/BrainPage.tsx` — Remove fixed `h-[520px]` constraint and the ECharts resize-dispatch hack. Let the canvas flex to fill available space.
- `client/ui/src/services/blockApi.ts` — Add `deleteBlock()` function.
- `server/api/routers/blocks.py` — Add `DELETE /api/blocks/{stream_name}` endpoint.
- `docs/architecture.md` — Update Key Files table: add BlockCanvas entries, update PipelineChart description.

### Files to remove

- `client/ui/src/components/PipelineChart/chartOptions.ts` — ECharts option builder, no longer needed.
- `client/ui/src/components/PipelineChart/DecompositionSidebar.tsx` — Replaced by canvas header summary.

### Files to keep (still needed)

- `client/ui/src/hooks/usePipelineTimeSeries.ts` — Still provides per-block time-series data. May be consumed by `useBlockCanvas` or used directly.
- `client/ui/src/services/pipelineApi.ts` — Still needed for `fetchTimeSeries()` and `fetchDimensions()`.

## Stacking Logic (detail)

Within a shared `space_id`, blocks are sorted by `block_name` for stable ordering.

**Offset blocks** (`aggregation_logic = "offset"`): Cumulative stacking. At each timestamp `t`:
- Block 0 renders from y=0 to y=block0.fair[t]
- Block 1 renders from y=block0.fair[t] to y=block0.fair[t]+block1.fair[t]
- ...and so on

Same logic applies in the variance lane using `var[t]`.

**Average blocks** (`aggregation_logic = "average"`): Shared baseline. All average blocks in the same space render from y=0 with semi-transparent fill, overlapping. This visually communicates that they blend rather than stack.

**Cross-space**: Different `space_id` groups are rendered independently (each starts from y=0). A subtle visual separator (dashed line or color band) distinguishes spaces.

## Drag Interaction (detail)

### Horizontal drag (reposition — manual static blocks only)

1. `mousedown` on block area → enter drag mode. Record initial mouse X and block's current `start_timestamp`.
2. `mousemove` → compute time delta from pixel delta. Shift the block's SVG path by the delta (optimistic preview). Ghost appearance (reduced opacity on original position).
3. `mouseup` → compute new `start_timestamp`. Call `updateBlock(streamName, { snapshot_rows: [{ timestamp: newISO, raw_value: block.raw_value, symbol: block.symbol, expiry: block.expiry }] })`.
4. On API success → next poll picks up recalculated shapes. On API error → revert to original position, show error toast.

**Constraints:**
- Shifting blocks (`temporal_position = "shifting"`) are not draggable — they're pinned to "now".
- Stream blocks are not draggable regardless of temporal_position.
- Only horizontal movement; vertical position is determined by stacking order.

### Right-edge drag (resize — manual blocks only)

1. `mousedown` on right-edge handle → enter resize mode. Record initial mouse X and block's current `decay_rate_prop_per_min`.
2. `mousemove` → compute new width in time. Redraw block shape with new right edge (optimistic preview using linear interpolation between start and end values).
3. `mouseup` → compute new `decay_rate_prop_per_min = 1 / newDurationMinutes`. Call `updateBlock(streamName, { block: { ...currentBlockConfig, decay_rate_prop_per_min: newRate } })`.
4. On API success → next poll picks up recalculated shapes. On error → revert.

**Edge cases:**
- Minimum width = 1 minute (max decay_rate = 1.0).
- If block was non-decaying (rate=0, mult=1): first resize sets `decay_end_size_mult = 0` and computes rate from the new width.
- Dragging right edge past expiry date → clamp to expiry (block becomes non-decaying, rate set to 0).

## Test Cases

- **Happy path**: Load canvas with mock data → see blocks in both lanes with correct shapes and stacking.
- **Drag manual block**: Drag a static manual block 2 hours to the right → API call fires → block re-renders at new position → table shows updated `start_timestamp`.
- **Resize manual block**: Drag right edge inward → block becomes narrower → decay_rate increases → shapes update after API round-trip.
- **Delete manual block**: Click delete → block removed from canvas and table.
- **Create manual block**: Click "Add block" → AddBlockDrawer opens → fill form → submit → new block appears on canvas.
- **Edit manual block**: Click manual block → AddBlockDrawer opens pre-filled → change a parameter → submit → canvas updates.
- **Stream block locked**: Attempt to drag a stream block → nothing happens. No drag/resize/delete affordances visible.
- **Shifting block locked**: Shifting blocks pinned to "now" marker → no drag. Marker moves with clock.
- **Empty state**: Select instrument with no blocks → canvas shows "No blocks for this instrument" + "Add block" CTA.
- **Instrument switch**: Change symbol/expiry dropdown → canvas re-renders with new instrument's blocks.
- **Zoom/pan**: Mouse wheel zooms time axis → blocks scale. Drag empty space → canvas pans.
- **Stacking fidelity**: Two offset blocks in same space → second block's baseline starts at top of first. Two average blocks → overlapping semi-transparent areas.

## Out of Scope

- **Position lane**: Only fair value and variance lanes for now. Desired position is shown as a number in the summary header, not as a canvas lane. Can add a third lane in a future pass.
- **Block-to-block connections/edges**: Blocks don't visually connect to each other on the canvas. The stacking shows their relationship.
- **Real-time WS-driven canvas updates**: Canvas polls at 5s intervals via HTTP. Switching to WS push is a future optimization.
- **Multi-user conflict resolution**: Last write wins (same as existing block API). No optimistic locking.
- **Undo/redo**: No canvas history. If a drag was wrong, drag it back or edit via drawer.
- **Canvas layout persistence**: Block visual positions are derived from data (start_timestamp, stacking order). Nothing to persist beyond what the server already stores.
- **Aggregated line overlays**: The current chart shows total fair / total variance as bold overlay lines. Deferred — the stacked areas already communicate the total visually.
- **Market fair dashed overlay**: The current chart shows market fair as a dashed line. Deferred to a future pass.

## Manual Brain Boundary

Block shapes are computed by `server/core/transforms.py` (temporal fair value, variance transforms) and `server/core/pipeline.py` (pipeline orchestration). These are HUMAN ONLY. The canvas reads the output via `/api/pipeline/timeseries` — it does not replicate or approximate the math. The only server-side change in this spec is the new `DELETE` endpoint in `server/api/routers/blocks.py`, which is in the LLM-writable `server/api/` lane.
