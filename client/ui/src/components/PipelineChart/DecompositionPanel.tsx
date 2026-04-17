import { useMemo } from "react";
import type {
  CurrentAggregatedDecomposition,
  CurrentBlockDecomposition,
} from "../../types";
import {
  BLOCK_COLORS,
  MODE_LABELS,
  sci,
  type DecompositionMode,
} from "./chartOptions";

interface CardSpec {
  key: DecompositionMode;
  label: string;
  value: number;
  fmt: (v: number) => string;
}

/**
 * Current-snapshot decomposition for the focused dimension.
 *
 * Lives at the top of the Brain page above the time-series chart. Two
 * horizontal regions:
 *
 *  1. **Cards row** — four clickable metric cards (Desired Pos raw/smoothed,
 *     Fair Value, Variance). Each card doubles as a decomposition mode toggle
 *     for the bars below — clicking "Variance" recomputes every bar to show
 *     each block's variance contribution. The active card gains a left
 *     accent border and a subtle ring.
 *
 *  2. **Bars block** — every block in the pipeline rendered as a horizontal
 *     bar, sorted by absolute value, colored from the shared `BLOCK_COLORS`
 *     palette so the colour link to the chart's stacked-area below is
 *     preserved. Clicking a bar toggle-selects the block (which dims all
 *     other series in the chart).
 *
 * No pie chart — the bars carry both magnitude (width) and ranking (sort
 * order), and the cards carry the totals; the pie was visual noise.
 */
export function DecompositionPanel({
  blocks,
  aggregated,
  aggregateMarketValue,
  mode,
  onModeChange,
  selectedBlocks,
  onBlockClick,
}: {
  blocks: CurrentBlockDecomposition[];
  aggregated: CurrentAggregatedDecomposition | null;
  aggregateMarketValue?: { totalVol: number } | null;
  mode: DecompositionMode;
  onModeChange: (m: DecompositionMode) => void;
  selectedBlocks: Set<string>;
  onBlockClick: (blockName: string) => void;
}) {
  const totalFair = aggregated?.totalFair ?? 0;
  const totalMarketFair = aggregated?.totalMarketFair ?? 0;
  const totalVar = aggregated?.smoothedVar ?? aggregated?.var ?? 0;
  const rawDesPos = aggregated?.rawDesiredPosition ?? aggregated?.smoothedDesiredPosition ?? 0;
  const smoothDesPos = aggregated?.smoothedDesiredPosition ?? 0;

  // Resolve the target scalar for the active mode (used to project block fair
  // contributions onto the desired-position axis).
  const modeTarget = mode === "desired_position" ? rawDesPos
    : mode === "smoothed_desired_position" ? smoothDesPos
    : 0;

  // Compute block values + sorted order based on active mode.
  const { sorted, maxVal, absTotal } = useMemo(() => {
    const withVal = blocks.map((b) => {
      let value: number;
      if (mode === "fair_value") {
        value = b.fair;
      } else if (mode === "desired_position" || mode === "smoothed_desired_position") {
        value = totalFair !== 0 ? (b.fair / totalFair) * modeTarget : 0;
      } else {
        value = b.var;
      }
      return { ...b, value };
    });
    withVal.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const mx = Math.max(...withVal.map((x) => Math.abs(x.value)), 1e-18);
    const total = withVal.reduce((s, x) => s + Math.abs(x.value), 0);
    return { sorted: withVal, maxVal: mx, absTotal: total };
  }, [blocks, mode, totalFair, modeTarget]);

  const cards: CardSpec[] = [
    { key: "desired_position", label: "Desired Pos (Raw)", value: rawDesPos, fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { key: "smoothed_desired_position", label: "Desired Pos (Smooth)", value: smoothDesPos, fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { key: "fair_value", label: "Fair Value", value: totalFair, fmt: sci },
    { key: "variance", label: "Variance", value: totalVar, fmt: sci },
  ];

  const marketFairCard = {
    label: "Market Fair",
    value: totalMarketFair,
    fmt: sci,
    userVol: aggregateMarketValue?.totalVol,
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Cards — clickable metric tiles double as mode toggles */}
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => {
          const active = mode === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onModeChange(c.key)}
              className={`glass-card group flex flex-col gap-1 px-3 py-2 text-left transition-all duration-150 ${
                active
                  ? "border-l-2 border-l-mm-accent ring-1 ring-mm-accent/25"
                  : "hover:bg-white/55"
              }`}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
                {c.label}
              </span>
              <span
                className={`font-mono tabular-nums text-[13px] font-semibold ${
                  active ? "text-mm-accent" : "text-mm-text"
                }`}
              >
                {c.fmt(c.value)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Market Fair — read-only summary card with user's aggregate vol indicator */}
      <div className="glass-card flex items-center justify-between px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            {marketFairCard.label}
          </span>
          <span className="font-mono tabular-nums text-[13px] font-semibold text-mm-text">
            {marketFairCard.fmt(marketFairCard.value)}
          </span>
        </div>
        {marketFairCard.userVol !== undefined && (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Agg Vol
            </span>
            <span className="rounded bg-mm-accent/10 px-1.5 py-0.5 font-mono tabular-nums text-[11px] font-semibold text-mm-accent">
              {marketFairCard.userVol.toFixed(4)}
            </span>
          </div>
        )}
      </div>

      {/* Bars — block decomposition for the active mode */}
      <div className="flex flex-col gap-2 border-t border-black/[0.06] pt-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Decomposition
          </span>
          <span className="text-[9px] text-mm-text-dim/60">
            — {MODE_LABELS[mode]}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          {sorted.map((b, i) => {
            const pct = maxVal > 0 ? Math.abs(b.value) / maxVal : 0;
            const color = BLOCK_COLORS[i % BLOCK_COLORS.length];
            const pctOfTotal = absTotal > 0 ? (Math.abs(b.value) / absTotal) * 100 : 0;
            const hasSelection = selectedBlocks.size > 0;
            const dimmed = hasSelection && !selectedBlocks.has(b.blockName);
            return (
              <div
                key={b.blockName}
                className={`-mx-1 cursor-pointer rounded px-1 transition-opacity ${
                  dimmed ? "opacity-30" : ""
                } ${hasSelection && !dimmed ? "channel-highlight" : ""}`}
                onClick={() => onBlockClick(b.blockName)}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="truncate font-medium text-mm-text">
                    {b.blockName}
                  </span>
                  <span className="ml-2 shrink-0 font-mono tabular-nums text-mm-text-dim">
                    {sci(b.value)}{" "}
                    <span className="text-mm-text-dim/50">({pctOfTotal.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-black/[0.06]">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(pct * 100, 2)}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
