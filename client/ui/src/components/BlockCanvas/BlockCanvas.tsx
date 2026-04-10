import { useState, useCallback, useRef, useMemo } from "react";
import { formatExpiry } from "../../utils";
import { sci } from "../../constants";
import { useSelection } from "../../providers/SelectionProvider";
import { updateBlock, deleteBlock } from "../../services/blockApi";
import { useBlockCanvas, type CanvasBlock } from "./useBlockCanvas";
import { BlockShape } from "./BlockShape";
import { TimeAxis } from "./TimeAxis";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const HEADER_HEIGHT = 36;
const LANE_GAP = 24;
const AXIS_HEIGHT = 24;
const LANE_LABEL_WIDTH = 48;
const MIN_LANE_HEIGHT = 80;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  onEditBlock: (streamName: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockCanvas({ onEditBlock }: Props) {
  const { selectedDimension, selectBlock } = useSelection();
  const {
    dimensions,
    selected,
    setSelected,
    blocks,
    timestamps,
    summary,
    loading,
    error,
    serverNow,
    refresh,
  } = useBlockCanvas(selectedDimension);

  // Zoom / pan state as visible index range
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 0]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState] = useState<{
    blockName: string;
    offsetPx: number;
  } | null>(null);

  // Sync visible range when timestamps change
  const prevTsLenRef = useRef(0);
  if (timestamps.length !== prevTsLenRef.current) {
    prevTsLenRef.current = timestamps.length;
    if (timestamps.length > 0) {
      // Only reset if we had no timestamps before
      if (visibleRange[0] === 0 && visibleRange[1] === 0) {
        setVisibleRange([0, timestamps.length - 1]);
      } else {
        // Keep current range but clamp to new bounds
        setVisibleRange([
          Math.min(visibleRange[0], timestamps.length - 1),
          Math.min(visibleRange[1], timestamps.length - 1),
        ]);
      }
    }
  }

  // Dimension selector change
  const handleDimChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const [sym, exp] = e.target.value.split("|");
      const dim = dimensions.find(
        (d) => d.symbol === sym && d.expiry === exp,
      );
      if (dim) setSelected(dim);
    },
    [dimensions, setSelected],
  );

  // Wheel → zoom the time axis
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const maxIdx = timestamps.length - 1;
      if (maxIdx <= 0) return;
      const [start, end] = visibleRange;
      const range = end - start;
      // Zoom factor based on scroll delta
      const zoomDelta = Math.sign(e.deltaY) * Math.max(1, Math.floor(range * 0.1));
      const newStart = Math.max(0, start + zoomDelta);
      const newEnd = Math.min(maxIdx, end - zoomDelta);
      if (newEnd - newStart >= 2) {
        setVisibleRange([newStart, newEnd]);
      }
    },
    [timestamps.length, visibleRange],
  );

  // Pan via drag on empty canvas space
  const panRef = useRef<{ startX: number; startRange: [number, number] } | null>(null);

  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
      // Only start pan if clicking on the SVG background (not a block)
      if ((e.target as HTMLElement).closest(".block-shape")) return;
      panRef.current = { startX: e.clientX, startRange: [...visibleRange] as [number, number] };

      const onMove = (ev: MouseEvent) => {
        if (!panRef.current || !containerRef.current) return;
        const containerWidth = containerRef.current.clientWidth - LANE_LABEL_WIDTH;
        const deltaPx = ev.clientX - panRef.current.startX;
        const visibleCount = panRef.current.startRange[1] - panRef.current.startRange[0];
        const pxPerPoint = containerWidth / visibleCount;
        const deltaPoints = Math.round(-deltaPx / pxPerPoint);
        const maxIdx = timestamps.length - 1;
        let newStart = panRef.current.startRange[0] + deltaPoints;
        let newEnd = panRef.current.startRange[1] + deltaPoints;
        if (newStart < 0) { newEnd -= newStart; newStart = 0; }
        if (newEnd > maxIdx) { newStart -= (newEnd - maxIdx); newEnd = maxIdx; }
        newStart = Math.max(0, newStart);
        setVisibleRange([newStart, newEnd]);
      };

      const onUp = () => {
        panRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [visibleRange, timestamps.length],
  );

  // Block drag end → API call
  const handleDragEnd = useCallback(
    async (blockName: string, deltaMinutes: number) => {
      const block = blocks.find((b) => b.meta.block_name === blockName);
      if (!block || !block.meta.start_timestamp) return;

      const oldTs = new Date(block.meta.start_timestamp).getTime();
      const newTs = new Date(oldTs + deltaMinutes * 60000).toISOString();

      try {
        await updateBlock(block.meta.stream_name, {
          snapshot_rows: [
            {
              timestamp: newTs,
              raw_value: block.meta.raw_value,
              symbol: block.meta.symbol,
              expiry: block.meta.expiry,
            },
          ],
        });
        refresh();
      } catch (err) {
        console.error("Failed to reposition block:", err);
      }
    },
    [blocks, refresh],
  );

  // Block resize end → API call
  const handleResizeEnd = useCallback(
    async (blockName: string, newDurationMinutes: number) => {
      const block = blocks.find((b) => b.meta.block_name === blockName);
      if (!block) return;

      const newRate = 1 / newDurationMinutes;
      const decayEndMult =
        block.meta.decay_rate_prop_per_min === 0 &&
        block.meta.decay_end_size_mult === 1
          ? 0
          : block.meta.decay_end_size_mult;

      try {
        await updateBlock(block.meta.stream_name, {
          block: {
            annualized: block.meta.annualized,
            size_type: block.meta.size_type,
            aggregation_logic: block.meta.aggregation_logic,
            temporal_position: block.meta.temporal_position,
            decay_end_size_mult: decayEndMult,
            decay_rate_prop_per_min: newRate,
            decay_profile: "linear",
            var_fair_ratio: block.meta.var_fair_ratio,
          },
        });
        refresh();
      } catch (err) {
        console.error("Failed to resize block:", err);
      }
    },
    [blocks, refresh],
  );

  // Block delete → API call
  const handleDelete = useCallback(
    async (blockName: string) => {
      const block = blocks.find((b) => b.meta.block_name === blockName);
      if (!block) return;
      try {
        await deleteBlock(block.meta.stream_name);
        refresh();
      } catch (err) {
        console.error("Failed to delete block:", err);
      }
    },
    [blocks, refresh],
  );

  // Block click → open edit drawer
  const handleBlockClick = useCallback(
    (blockName: string) => {
      const block = blocks.find((b) => b.meta.block_name === blockName);
      if (!block) return;
      if (selected) {
        selectBlock(blockName, selected.symbol, selected.expiry);
      }
      onEditBlock(block.meta.stream_name);
    },
    [blocks, selected, selectBlock, onEditBlock],
  );

  // Compute Y scales for fair and var lanes
  const { fairScale, varScale } = useMemo(() => {
    let maxFair = 0;
    let maxVar = 0;
    for (const b of blocks) {
      if (!b.series) continue;
      const [rs, re] = visibleRange;
      for (let i = rs; i <= re && i < b.series.fair.length; i++) {
        const fv = Math.abs((b.fairBaseline[i] ?? 0) + (b.series.fair[i] ?? 0));
        const vv = Math.abs((b.varBaseline[i] ?? 0) + (b.series.var[i] ?? 0));
        if (fv > maxFair) maxFair = fv;
        if (vv > maxVar) maxVar = vv;
      }
    }
    // Add 10% padding
    return {
      fairScale: maxFair > 0 ? maxFair * 1.1 : 1,
      varScale: maxVar > 0 ? maxVar * 1.1 : 1,
    };
  }, [blocks, visibleRange]);

  // Error state
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-mm-error">
        {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div
        className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] bg-black/[0.04] px-3"
        style={{ height: HEADER_HEIGHT }}
      >
        {/* Instrument selector */}
        <label className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Instrument
        </label>
        <select
          className="rounded-md border border-black/[0.06] bg-mm-surface-solid px-2 py-0.5 text-[11px] text-mm-text focus:border-mm-accent/40 focus:outline-none"
          value={selected ? `${selected.symbol}|${selected.expiry}` : ""}
          onChange={handleDimChange}
        >
          {dimensions.map((d) => (
            <option
              key={`${d.symbol}|${d.expiry}`}
              value={`${d.symbol}|${d.expiry}`}
            >
              {d.symbol} — {formatExpiry(d.expiry)}
            </option>
          ))}
        </select>

        {/* Aggregated summary strip */}
        <div className="ml-auto flex items-center gap-4 text-[10px]">
          <span className="text-mm-text-dim">
            Fair{" "}
            <span className="font-mono font-semibold text-mm-text">
              {sci(summary.totalFair)}
            </span>
          </span>
          <span className="text-mm-text-dim">
            Var{" "}
            <span className="font-mono font-semibold text-mm-text">
              {sci(summary.totalVar)}
            </span>
          </span>
          <span className="text-mm-text-dim">
            Edge{" "}
            <span className="font-mono font-semibold text-mm-text">
              {sci(summary.edge)}
            </span>
          </span>
          <span className="text-mm-text-dim">
            Pos{" "}
            <span className="font-mono font-semibold text-mm-text">
              {summary.desiredPosition.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
            </span>
          </span>
        </div>

        {loading && (
          <span className="text-[10px] text-mm-text-dim animate-pulse">
            Loading...
          </span>
        )}
      </div>

      {/* SVG Canvas */}
      <div
        className="min-h-0 flex-1"
        onWheel={handleWheel}
        onMouseDown={handlePanStart}
        style={{ cursor: panRef.current ? "grabbing" : "default" }}
      >
        <CanvasSVG
          blocks={blocks}
          timestamps={timestamps}
          visibleRange={
            timestamps.length > 0
              ? visibleRange
              : [0, 0]
          }
          serverNow={serverNow}
          fairScale={fairScale}
          varScale={varScale}
          dragState={dragState}
          onBlockClick={handleBlockClick}
          onDragEnd={handleDragEnd}
          onResizeEnd={handleResizeEnd}
          onDelete={handleDelete}
          containerRef={containerRef}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner SVG renderer (separated to keep BlockCanvas under 300 lines)
// ---------------------------------------------------------------------------

function CanvasSVG({
  blocks,
  timestamps,
  visibleRange,
  serverNow,
  fairScale,
  varScale,
  dragState,
  onBlockClick,
  onDragEnd,
  onResizeEnd,
  onDelete,
  containerRef,
}: {
  blocks: CanvasBlock[];
  timestamps: string[];
  visibleRange: [number, number];
  serverNow: string | null;
  fairScale: number;
  varScale: number;
  dragState: { blockName: string; offsetPx: number } | null;
  onBlockClick: (blockName: string) => void;
  onDragEnd: (blockName: string, deltaMinutes: number) => void;
  onResizeEnd: (blockName: string, newDurationMinutes: number) => void;
  onDelete: (blockName: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Compute layout from container size
  const rect = containerRef.current?.getBoundingClientRect();
  const totalWidth = rect?.width ?? 800;
  const totalHeight = rect?.height ?? 400;

  const chartWidth = totalWidth - LANE_LABEL_WIDTH;
  const laneHeight = Math.max(
    MIN_LANE_HEIGHT,
    (totalHeight - AXIS_HEIGHT - LANE_GAP) / 2,
  );

  const fairZeroY = laneHeight;
  const varZeroY = laneHeight + LANE_GAP + laneHeight;

  const fairPxPerUnit = laneHeight / fairScale;
  const varPxPerUnit = laneHeight / varScale;

  const svgHeight = laneHeight * 2 + LANE_GAP + AXIS_HEIGHT;

  if (blocks.length === 0 && timestamps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-mm-text-dim">
        No blocks for this instrument
      </div>
    );
  }

  return (
    <svg
      width={totalWidth}
      height={svgHeight}
      style={{ display: "block" }}
    >
      {/* Lane labels */}
      <text
        x={4}
        y={laneHeight / 2}
        fontSize={9}
        fontWeight={600}
        fill="#6e6e82"
        dominantBaseline="central"
      >
        Fair
      </text>
      <text
        x={4}
        y={laneHeight + LANE_GAP + laneHeight / 2}
        fontSize={9}
        fontWeight={600}
        fill="#6e6e82"
        dominantBaseline="central"
      >
        Var
      </text>

      {/* Zero lines */}
      <line
        x1={LANE_LABEL_WIDTH}
        y1={fairZeroY}
        x2={totalWidth}
        y2={fairZeroY}
        stroke="rgba(0,0,0,0.08)"
        strokeWidth={1}
      />
      <line
        x1={LANE_LABEL_WIDTH}
        y1={varZeroY}
        x2={totalWidth}
        y2={varZeroY}
        stroke="rgba(0,0,0,0.08)"
        strokeWidth={1}
      />

      {/* Lane separator */}
      <line
        x1={LANE_LABEL_WIDTH}
        y1={laneHeight + LANE_GAP / 2}
        x2={totalWidth}
        y2={laneHeight + LANE_GAP / 2}
        stroke="rgba(0,0,0,0.06)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />

      {/* Fair value lane — blocks */}
      {blocks.map((b) => (
        <BlockShape
          key={`fair-${b.meta.block_name}`}
          blockName={b.meta.block_name}
          values={b.series?.fair ?? []}
          baseline={b.fairBaseline}
          timestamps={timestamps}
          visibleRange={visibleRange}
          paddingLeft={LANE_LABEL_WIDTH}
          width={chartWidth}
          zeroY={fairZeroY}
          pixelsPerUnit={fairPxPerUnit}
          color={b.color}
          isManual={b.meta.source === "manual"}
          draggable={b.draggable}
          resizable={b.resizable}
          deletable={b.deletable}
          isShifting={b.meta.temporal_position === "shifting"}
          onClick={onBlockClick}
          onDragEnd={onDragEnd}
          onResizeEnd={onResizeEnd}
          onDelete={onDelete}
          dragOffsetPx={
            dragState?.blockName === b.meta.block_name
              ? dragState.offsetPx
              : 0
          }
          isDragging={dragState?.blockName === b.meta.block_name}
        />
      ))}

      {/* Variance lane — blocks */}
      {blocks.map((b) => (
        <BlockShape
          key={`var-${b.meta.block_name}`}
          blockName={b.meta.block_name}
          values={b.series?.var ?? []}
          baseline={b.varBaseline}
          timestamps={timestamps}
          visibleRange={visibleRange}
          paddingLeft={LANE_LABEL_WIDTH}
          width={chartWidth}
          zeroY={varZeroY}
          pixelsPerUnit={varPxPerUnit}
          color={b.color}
          isManual={b.meta.source === "manual"}
          draggable={false}
          resizable={false}
          deletable={false}
          isShifting={b.meta.temporal_position === "shifting"}
          onClick={onBlockClick}
          onDragEnd={onDragEnd}
          onResizeEnd={onResizeEnd}
          onDelete={onDelete}
          dragOffsetPx={
            dragState?.blockName === b.meta.block_name
              ? dragState.offsetPx
              : 0
          }
          isDragging={dragState?.blockName === b.meta.block_name}
        />
      ))}

      {/* Time axis (shared between both lanes) */}
      <TimeAxis
        timestamps={timestamps}
        paddingLeft={LANE_LABEL_WIDTH}
        width={chartWidth}
        y={svgHeight - AXIS_HEIGHT}
        gridHeight={laneHeight * 2 + LANE_GAP}
        gridTop={0}
        serverNow={serverNow}
        visibleRange={visibleRange}
      />
    </svg>
  );
}
