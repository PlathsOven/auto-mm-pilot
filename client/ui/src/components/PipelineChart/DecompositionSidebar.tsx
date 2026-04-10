import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { CurrentBlockDecomposition } from "../../types";
import {
  BLOCK_COLORS,
  SIDEBAR_POSITION_COLOR,
  SIDEBAR_FAIR_COLOR,
  SIDEBAR_VARIANCE_COLOR,
  TOOLTIP_STYLE,
  MODE_LABELS,
  sci,
  type DecompositionMode,
} from "./chartOptions";

export function DecompositionSidebar({
  blocks,
  aggregated,
  mode,
  onModeChange,
  selectedBlocks,
  onBlockClick,
}: {
  blocks: CurrentBlockDecomposition[];
  aggregated: Record<string, number>;
  mode: DecompositionMode;
  onModeChange: (m: DecompositionMode) => void;
  selectedBlocks: Set<string>;
  onBlockClick: (blockName: string) => void;
}) {
  const totalFair = aggregated.totalFair ?? 0;
  const totalVar = aggregated.smoothedVar ?? aggregated.var ?? 0;
  const rawDesPos = aggregated.rawDesiredPosition ?? aggregated.smoothedDesiredPosition ?? 0;
  const smoothDesPos = aggregated.smoothedDesiredPosition ?? 0;

  // Resolve the target scalar for the active mode
  const modeTarget = mode === "desired_position" ? rawDesPos
    : mode === "smoothed_desired_position" ? smoothDesPos
    : 0;

  // Compute block values + sorted order based on active mode
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

  // Pie chart data
  const pieOption = useMemo<EChartsOption>(() => {
    const pieData = sorted.map((b, i) => ({
      name: b.blockName,
      value: absTotal > 0 ? Math.abs(b.value) : 0,
      itemStyle: { color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
    }));
    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "item",
        ...TOOLTIP_STYLE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) =>
          `${p.name}: ${(p.percent ?? 0).toFixed(1)}%`,
      },
      series: [
        {
          type: "pie",
          radius: ["35%", "65%"],
          center: ["50%", "50%"],
          data: pieData,
          label: {
            show: true,
            position: "inside",
            fontSize: 8,
            color: "#fff",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (p: any) => (p.percent ?? 0) > 12 ? `${Math.round(p.percent)}%` : "",
          },
          emphasis: {
            itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.4)" },
          },
        },
      ],
    };
  }, [sorted, absTotal]);

  const CARDS: { key: DecompositionMode; label: string; value: number; color: string; fmt: (v: number) => string }[] = [
    { key: "desired_position", label: "Desired Pos (Raw)", value: rawDesPos, color: SIDEBAR_POSITION_COLOR, fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { key: "smoothed_desired_position", label: "Desired Pos (Smooth)", value: smoothDesPos, color: SIDEBAR_POSITION_COLOR, fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { key: "fair_value", label: "Fair Value", value: totalFair, color: SIDEBAR_FAIR_COLOR, fmt: sci },
    { key: "variance", label: "Variance", value: totalVar, color: SIDEBAR_VARIANCE_COLOR, fmt: sci },
  ];

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-2 py-2 text-[10px]">
      {/* Clickable metric cards — each acts as decomposition toggle */}
      {CARDS.map((c) => {
        const active = mode === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onModeChange(c.key)}
            className={`group relative w-full rounded-lg border px-2.5 py-1.5 text-left transition-all duration-150 ${
              active
                ? "border-l-2 bg-mm-surface/80 shadow-[0_0_8px_rgba(99,110,250,0.12)]"
                : "border-black/[0.04] bg-black/[0.03] hover:bg-black/[0.05] hover:border-black/[0.08]"
            }`}
            style={{ borderLeftColor: active ? c.color : undefined }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
                {c.label}
              </span>
              {active && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color }} />
              )}
            </div>
            <div
              className="font-mono text-[13px] font-bold"
              style={{ color: c.color }}
            >
              {c.fmt(c.value)}
            </div>
          </button>
        );
      })}

      {/* Block decomposition bars */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Decomposition
        </span>
        <span className="text-[8px] text-mm-text-dim/60">
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
              className={`flex flex-col gap-0.5 cursor-pointer rounded px-1 -mx-1 transition-opacity ${dimmed ? "opacity-30" : ""} ${hasSelection && !dimmed ? "channel-highlight" : ""}`}
              onClick={() => onBlockClick(b.blockName)}
            >
              <div className="flex items-center justify-between">
                <span className="truncate font-medium text-mm-text">
                  {b.blockName}
                </span>
                <span className="ml-1 shrink-0 font-mono text-mm-text-dim">
                  {sci(b.value)}{" "}
                  <span className="text-mm-text-dim/50">({pctOfTotal.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-mm-bg">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(pct * 100, 2)}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Pie chart */}
      <div className="mx-auto w-full" style={{ height: 120 }}>
        <ReactECharts
          option={pieOption}
          notMerge
          lazyUpdate
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      </div>
    </div>
  );
}
