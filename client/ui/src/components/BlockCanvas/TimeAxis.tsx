import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICK_HEIGHT = 6;
const LABEL_OFFSET = 14;
const NOW_LABEL_OFFSET = -8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTickLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return iso;
  }
}

/** Pick evenly-spaced tick indices so labels don't overlap. */
function pickTickIndices(count: number, maxTicks: number): number[] {
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / maxTicks);
  const indices: number[] = [];
  for (let i = 0; i < count; i += step) indices.push(i);
  return indices;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  timestamps: string[];
  /** Pixels from time-axis left edge to first timestamp */
  paddingLeft: number;
  /** Total pixel width of the time-series area */
  width: number;
  /** Y position to render the axis */
  y: number;
  /** Full SVG height for gridlines */
  gridHeight: number;
  /** Y offset where gridlines start */
  gridTop: number;
  /** ISO timestamp of server "now" (renders a vertical marker) */
  serverNow: string | null;
  /** Current visible range (indices) for zoom/pan */
  visibleRange: [number, number];
}

export function TimeAxis({
  timestamps,
  paddingLeft,
  width,
  y,
  gridHeight,
  gridTop,
  serverNow,
  visibleRange,
}: Props) {
  const [rangeStart, rangeEnd] = visibleRange;
  const visibleTs = timestamps.slice(rangeStart, rangeEnd + 1);
  const visibleCount = visibleTs.length;

  const pixelsPerPoint = visibleCount > 1 ? width / (visibleCount - 1) : width;

  // Tick positions
  const maxTicks = Math.max(4, Math.floor(width / 60));
  const tickIndices = useMemo(
    () => pickTickIndices(visibleCount, maxTicks),
    [visibleCount, maxTicks],
  );

  // "Now" marker position
  const nowX = useMemo(() => {
    if (!serverNow || visibleCount === 0) return null;
    const idx = visibleTs.indexOf(serverNow);
    if (idx < 0) {
      // Find closest timestamp
      const nowMs = new Date(serverNow).getTime();
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < visibleTs.length; i++) {
        const dist = Math.abs(new Date(visibleTs[i]).getTime() - nowMs);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      return paddingLeft + bestIdx * pixelsPerPoint;
    }
    return paddingLeft + idx * pixelsPerPoint;
  }, [serverNow, visibleTs, pixelsPerPoint, paddingLeft, visibleCount]);

  return (
    <g className="time-axis">
      {/* Axis line */}
      <line
        x1={paddingLeft}
        y1={y}
        x2={paddingLeft + width}
        y2={y}
        stroke="rgba(0,0,0,0.1)"
        strokeWidth={1}
      />

      {/* Ticks + labels */}
      {tickIndices.map((i) => {
        const x = paddingLeft + i * pixelsPerPoint;
        return (
          <g key={i}>
            <line
              x1={x}
              y1={y}
              x2={x}
              y2={y + TICK_HEIGHT}
              stroke="rgba(0,0,0,0.15)"
              strokeWidth={1}
            />
            <text
              x={x}
              y={y + LABEL_OFFSET}
              textAnchor="middle"
              fontSize={9}
              fill="#6e6e82"
            >
              {formatTickLabel(visibleTs[i])}
            </text>
            {/* Gridline */}
            <line
              x1={x}
              y1={gridTop}
              x2={x}
              y2={gridTop + gridHeight}
              stroke="rgba(0,0,0,0.04)"
              strokeWidth={1}
            />
          </g>
        );
      })}

      {/* "Now" marker */}
      {nowX !== null && (
        <g>
          <line
            x1={nowX}
            y1={gridTop}
            x2={nowX}
            y2={gridTop + gridHeight}
            stroke="#4f5bd5"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
          <text
            x={nowX}
            y={gridTop + NOW_LABEL_OFFSET}
            textAnchor="middle"
            fontSize={8}
            fontWeight={600}
            fill="#4f5bd5"
          >
            NOW
          </text>
        </g>
      )}
    </g>
  );
}
