import { useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  /** Block name (unique identifier) */
  blockName: string;
  /** Time-series values for this lane (fair[] or var[]) */
  values: number[];
  /** Per-timestamp stacking baseline */
  baseline: number[];
  /** Timestamps array (same length as values) */
  timestamps: string[];
  /** Visible index range [start, end] inclusive */
  visibleRange: [number, number];
  /** Pixels from left edge to first point */
  paddingLeft: number;
  /** Pixel width of the time-series area */
  width: number;
  /** Y pixel position of the lane's zero line */
  zeroY: number;
  /** Pixels per unit value (scale factor) */
  pixelsPerUnit: number;
  /** Fill color */
  color: string;
  /** Whether the block is from a manual source */
  isManual: boolean;
  /** Whether the block can be dragged horizontally */
  draggable: boolean;
  /** Whether the right edge can be resized */
  resizable: boolean;
  /** Whether the block shows a delete affordance */
  deletable: boolean;
  /** Whether the block has temporal_position="shifting" */
  isShifting: boolean;
  /** Callback when block is clicked (opens edit drawer) */
  onClick: (blockName: string) => void;
  /** Callback when drag completes (new start timestamp) */
  onDragEnd: (blockName: string, deltaMinutes: number) => void;
  /** Callback when resize completes (new duration in minutes) */
  onResizeEnd: (blockName: string, newDurationMinutes: number) => void;
  /** Callback for delete */
  onDelete: (blockName: string) => void;
  /** Current drag pixel offset (optimistic preview) */
  dragOffsetPx: number;
  /** Whether this block is currently being dragged */
  isDragging: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HANDLE_RADIUS = 4;
const DELETE_BUTTON_SIZE = 14;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockShape({
  blockName,
  values,
  baseline,
  timestamps,
  visibleRange,
  paddingLeft,
  width,
  zeroY,
  pixelsPerUnit,
  color,
  isManual,
  draggable,
  resizable,
  deletable,
  isShifting,
  onClick,
  onDragEnd,
  onResizeEnd,
  onDelete,
  dragOffsetPx,
  isDragging,
}: Props) {
  const dragStartRef = useRef<{ x: number; startIdx: number } | null>(null);
  const resizeStartRef = useRef<{ x: number } | null>(null);

  const [rangeStart, rangeEnd] = visibleRange;
  const visibleVals = values.slice(rangeStart, rangeEnd + 1);
  const visibleBaseline = baseline.slice(rangeStart, rangeEnd + 1);
  const visibleCount = visibleVals.length;

  if (visibleCount === 0) return null;

  const pixelsPerPoint =
    visibleCount > 1 ? width / (visibleCount - 1) : width;

  // Build SVG path: area from baseline to baseline+value
  const topPoints: string[] = [];
  const bottomPoints: string[] = [];

  for (let i = 0; i < visibleCount; i++) {
    const x = paddingLeft + i * pixelsPerPoint + dragOffsetPx;
    const val = visibleVals[i] ?? 0;
    const base = visibleBaseline[i] ?? 0;
    const topY = zeroY - (base + val) * pixelsPerUnit;
    const bottomY = zeroY - base * pixelsPerUnit;
    topPoints.push(`${x},${topY}`);
    bottomPoints.push(`${x},${bottomY}`);
  }

  // Close the path: top left→right, then bottom right→left
  const pathD = `M ${topPoints.join(" L ")} L ${bottomPoints.reverse().join(" L ")} Z`;

  // Opacity: stream blocks are muted, dragging blocks are ghosted
  const fillOpacity = !isManual ? 0.15 : isDragging ? 0.4 : 0.35;
  const strokeOpacity = !isManual ? 0.3 : 1;

  // Right edge position (for resize handle)
  const lastX =
    paddingLeft + (visibleCount - 1) * pixelsPerPoint + dragOffsetPx;
  const lastTopY =
    zeroY -
    ((visibleBaseline[visibleBaseline.length - 1] ?? 0) +
      (visibleVals[visibleCount - 1] ?? 0)) *
      pixelsPerUnit;
  const lastBottomY =
    zeroY -
    (visibleBaseline[visibleBaseline.length - 1] ?? 0) * pixelsPerUnit;
  const handleY = (lastTopY + lastBottomY) / 2;

  // First point (for delete button)
  const firstX = paddingLeft + dragOffsetPx;
  const firstTopY =
    zeroY -
    ((visibleBaseline[0] ?? 0) + (visibleVals[0] ?? 0)) * pixelsPerUnit;

  // Block area click handler
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't trigger click at end of drag
      if (dragStartRef.current || resizeStartRef.current) return;
      e.stopPropagation();
      if (isManual) onClick(blockName);
    },
    [blockName, onClick, isManual],
  );

  // Drag start (for reposition)
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!draggable) return;
      e.stopPropagation();
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, startIdx: rangeStart };

      const onMove = () => {
        // Drag movement handled by parent via onDragEnd
      };

      const onUp = (ev: MouseEvent) => {
        if (!dragStartRef.current) return;
        const deltaPx = ev.clientX - dragStartRef.current.x;
        const deltaPoints = deltaPx / pixelsPerPoint;
        // Convert points to minutes using timestamps
        if (
          timestamps.length >= 2 &&
          rangeStart < timestamps.length &&
          rangeStart + 1 < timestamps.length
        ) {
          const t0 = new Date(timestamps[rangeStart]).getTime();
          const t1 = new Date(timestamps[rangeStart + 1]).getTime();
          const msPerPoint = t1 - t0;
          const deltaMinutes = (deltaPoints * msPerPoint) / 60000;
          if (Math.abs(deltaMinutes) > 0.5) {
            onDragEnd(blockName, deltaMinutes);
          }
        }
        dragStartRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [draggable, blockName, onDragEnd, pixelsPerPoint, timestamps, rangeStart],
  );

  // Resize start (right edge)
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!resizable) return;
      e.stopPropagation();
      e.preventDefault();
      resizeStartRef.current = { x: e.clientX };

      const onMove = () => {
        // Resize preview handled by parent
      };

      const onUp = (ev: MouseEvent) => {
        if (!resizeStartRef.current) return;
        const deltaPx = ev.clientX - resizeStartRef.current.x;
        const deltaPoints = deltaPx / pixelsPerPoint;
        // Compute new total duration in minutes
        if (timestamps.length >= 2) {
          const t0 = new Date(timestamps[rangeStart]).getTime();
          const t1 = new Date(timestamps[rangeStart + 1]).getTime();
          const msPerPoint = t1 - t0;
          const currentDurationPoints = visibleCount;
          const newDurationPoints = Math.max(1, currentDurationPoints + deltaPoints);
          const newDurationMinutes =
            (newDurationPoints * msPerPoint) / 60000;
          onResizeEnd(blockName, Math.max(1, newDurationMinutes));
        }
        resizeStartRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [
      resizable,
      blockName,
      onResizeEnd,
      pixelsPerPoint,
      timestamps,
      rangeStart,
      visibleCount,
    ],
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(blockName);
    },
    [blockName, onDelete],
  );

  return (
    <g className="block-shape" data-block={blockName}>
      {/* Filled area */}
      <path
        d={pathD}
        fill={color}
        fillOpacity={fillOpacity}
        stroke={color}
        strokeWidth={isManual ? 1.5 : 0.5}
        strokeOpacity={strokeOpacity}
        style={{ cursor: draggable ? "grab" : isManual ? "pointer" : "default" }}
        onClick={handleClick}
        onMouseDown={draggable ? handleDragStart : undefined}
      />

      {/* Block label */}
      <text
        x={firstX + 4}
        y={firstTopY - 4}
        fontSize={8}
        fontWeight={500}
        fill={color}
        opacity={0.8}
        pointerEvents="none"
      >
        {blockName}
        {isShifting ? " (shifting)" : ""}
      </text>

      {/* Resize handle — right edge (manual blocks only) */}
      {resizable && (
        <circle
          cx={lastX}
          cy={handleY}
          r={HANDLE_RADIUS}
          fill={color}
          stroke="white"
          strokeWidth={1.5}
          style={{ cursor: "ew-resize" }}
          onMouseDown={handleResizeStart}
        />
      )}

      {/* Delete button (manual blocks only) */}
      {deletable && (
        <g
          style={{ cursor: "pointer" }}
          onClick={handleDeleteClick}
          opacity={0.6}
        >
          <rect
            x={firstX + 4}
            y={firstTopY - DELETE_BUTTON_SIZE - 16}
            width={DELETE_BUTTON_SIZE}
            height={DELETE_BUTTON_SIZE}
            rx={3}
            fill="white"
            stroke="rgba(0,0,0,0.15)"
            strokeWidth={0.5}
          />
          <text
            x={firstX + 4 + DELETE_BUTTON_SIZE / 2}
            y={firstTopY - DELETE_BUTTON_SIZE / 2 - 9}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fill="#d4405c"
            fontWeight={600}
          >
            x
          </text>
        </g>
      )}
    </g>
  );
}
