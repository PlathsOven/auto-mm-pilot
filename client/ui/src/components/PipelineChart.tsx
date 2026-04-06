import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type {
  TimeSeriesDimension,
  PipelineTimeSeriesResponse,
  CurrentBlockDecomposition,
} from "../types";
import { fetchDimensions, fetchTimeSeries } from "../services/pipelineApi";

// ---------------------------------------------------------------------------
// Color palette — distinct, saturated colors for block decomposition
// ---------------------------------------------------------------------------
const BLOCK_COLORS = [
  "#00cc96", // green
  "#636efa", // indigo
  "#ef553b", // red
  "#ab63fa", // purple
  "#ffa15a", // orange
  "#19d3f3", // cyan
  "#ff6692", // pink
  "#b6e880", // lime
  "#ff97ff", // magenta
  "#fecb52", // yellow
];

const POSITION_COLOR = "#636efa";
const SMOOTHED_COLOR = "rgba(99,110,250,1)";
const RAW_COLOR = "rgba(99,110,250,0.3)";
const FAIR_COLOR = "#00cc96";
const VARIANCE_COLOR = "#ef553b";
const MARKET_FAIR_COLOR = "rgba(255,255,255,0.5)";

type DecompositionMode = "variance" | "fair_value" | "desired_position" | "smoothed_desired_position";

const MODE_LABELS: Record<DecompositionMode, string> = {
  desired_position: "Desired Pos (Raw)",
  smoothed_desired_position: "Desired Pos (Smooth)",
  fair_value: "Fair Value",
  variance: "Variance",
};

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(20,20,30,0.95)",
  borderColor: "rgba(255,255,255,0.1)",
  textStyle: { color: "#ccc", fontSize: 10 },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatExpiry(iso: string): string {
  try {
    const d = new Date(iso);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase();
    const yr = String(d.getUTCFullYear()).slice(2);
    return `${day}${mon}${yr}`;
  } catch {
    return iso;
  }
}

function sci(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 0.01 && abs < 1e6) return v.toFixed(6);
  return v.toExponential(3);
}

// ---------------------------------------------------------------------------
// Decomposition sidebar
// ---------------------------------------------------------------------------

function DecompositionSidebar({
  blocks,
  aggregated,
  mode,
  onModeChange,
}: {
  blocks: CurrentBlockDecomposition[];
  aggregated: Record<string, number>;
  mode: DecompositionMode;
  onModeChange: (m: DecompositionMode) => void;
}) {
  const totalFair = aggregated.total_fair ?? 0;
  const totalVar = aggregated.smoothed_var ?? aggregated.var ?? 0;
  const rawDesPos = aggregated.raw_desired_position ?? aggregated.smoothed_desired_position ?? 0;
  const smoothDesPos = aggregated.smoothed_desired_position ?? 0;

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
      name: b.block_name,
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
    { key: "desired_position", label: "Desired Pos (Raw)", value: rawDesPos, color: POSITION_COLOR, fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { key: "smoothed_desired_position", label: "Desired Pos (Smooth)", value: smoothDesPos, color: POSITION_COLOR, fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { key: "fair_value", label: "Fair Value", value: totalFair, color: FAIR_COLOR, fmt: sci },
    { key: "variance", label: "Variance", value: totalVar, color: VARIANCE_COLOR, fmt: sci },
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
                : "border-mm-border/30 bg-mm-bg/50 hover:bg-mm-bg/80 hover:border-mm-border/60"
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
          return (
            <div key={b.block_name} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="truncate font-medium text-mm-text">
                  {b.block_name}
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

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PipelineChart() {
  const [dimensions, setDimensions] = useState<TimeSeriesDimension[]>([]);
  const [selected, setSelected] = useState<TimeSeriesDimension | null>(null);
  const [data, setData] = useState<PipelineTimeSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decompositionMode, setDecompositionMode] = useState<DecompositionMode>("variance");
  const [sidebarWidth, setSidebarWidth] = useState(176); // default w-44 = 11rem = 176px
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Fetch available dimensions on mount + poll every 5s
  useEffect(() => {
    const controller = new AbortController();

    const doFetch = () => {
      fetchDimensions(controller.signal)
        .then((dims) => {
          if (controller.signal.aborted) return;
          setDimensions(dims);
          setSelected((prev) => {
            if (!prev && dims.length > 0) return dims[0];
            if (prev && !dims.some((d) => d.symbol === prev.symbol && d.expiry === prev.expiry)) {
              return dims.length > 0 ? dims[0] : null;
            }
            return prev;
          });
          if (dims.length === 0) setLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    };

    doFetch();
    const interval = setInterval(doFetch, 5000);

    return () => { controller.abort(); clearInterval(interval); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch time series on selection change + poll every 5s to track ticks.
  // AbortController cancels in-flight requests when the instrument changes
  // so switching is instant instead of waiting for the old response.
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();

    const doFetch = () => {
      fetchTimeSeries(selected.symbol, selected.expiry, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setData(res);
          setLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    };

    setLoading(true);
    setError(null);
    doFetch();
    const interval = setInterval(doFetch, 5000);

    return () => { controller.abort(); clearInterval(interval); };
  }, [selected]);

  // Sidebar resize drag handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const next = Math.max(120, Math.min(400, dragRef.current.startW + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const handleDimChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const [sym, exp] = e.target.value.split("|");
      setSelected({ symbol: sym, expiry: exp });
    },
    [],
  );

  // Build ECharts options
  const chartOption = useMemo<EChartsOption | null>(() => {
    if (!data) return null;

    const { blocks, aggregated } = data;
    const timestamps = aggregated.timestamps;

    // --- Chart 1: Desired Position (top) ---
    const positionSeries: EChartsOption["series"] = [
      {
        name: "Raw",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: aggregated.raw_desired_position,
        showSymbol: false,
        lineStyle: { width: 1, color: RAW_COLOR },
        itemStyle: { color: RAW_COLOR },
        z: 1,
      },
      {
        name: "Smoothed",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: aggregated.smoothed_desired_position,
        showSymbol: false,
        lineStyle: { width: 2, color: SMOOTHED_COLOR },
        itemStyle: { color: SMOOTHED_COLOR },
        z: 2,
      },
    ];

    // --- Chart 2: Fair Value by Block (middle, stacked area) ---
    const fairSeries: EChartsOption["series"] = blocks.map((b, i) => ({
      name: `${b.block_name} (fair)`,
      type: "line" as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: b.fair,
      showSymbol: false,
      stack: "fair",
      areaStyle: { opacity: 0.5 },
      lineStyle: { width: 0.5, color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
      itemStyle: { color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
      emphasis: { focus: "series" as const },
    }));

    // Total Fair outline (bold line showing actual aggregated value)
    fairSeries.push({
      name: "Total Fair",
      type: "line" as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: aggregated.total_fair,
      showSymbol: false,
      lineStyle: { width: 2, color: FAIR_COLOR },
      itemStyle: { color: FAIR_COLOR },
      z: 10,
    });

    // Market fair overlay (dashed line, not stacked)
    fairSeries.push({
      name: "Market Fair",
      type: "line" as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: aggregated.total_market_fair,
      showSymbol: false,
      lineStyle: { width: 2, type: "dashed" as const, color: MARKET_FAIR_COLOR },
      itemStyle: { color: MARKET_FAIR_COLOR },
      z: 10,
    });

    // --- Chart 3: Variance by Block (bottom, stacked area) ---
    const varSeries: EChartsOption["series"] = blocks.map((b, i) => ({
      name: `${b.block_name} (var)`,
      type: "line" as const,
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: b.var,
      showSymbol: false,
      stack: "var",
      areaStyle: { opacity: 0.5 },
      lineStyle: { width: 0.5, color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
      itemStyle: { color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
      emphasis: { focus: "series" as const },
    }));

    // Total Variance outline (bold line showing actual aggregated value)
    varSeries.push({
      name: "Total Variance",
      type: "line" as const,
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: aggregated.var,
      showSymbol: false,
      lineStyle: { width: 2, color: VARIANCE_COLOR },
      itemStyle: { color: VARIANCE_COLOR },
      z: 10,
    });

    const option: EChartsOption = {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", crossStyle: { color: "#666" } },
        ...TOOLTIP_STYLE,
        confine: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const ts = params[0].axisValue ?? "";
          let tsLabel = ts;
          try {
            const d = new Date(ts);
            tsLabel = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
          } catch { /* keep raw */ }

          // Group items by chart (axisIndex)
          const groups: Record<number, typeof params> = {};
          for (const p of params) {
            const idx = p.axisIndex ?? 0;
            (groups[idx] ??= []).push(p);
          }

          let html = `<div style="font-size:10px;margin-bottom:4px;color:#8a8f9a">${tsLabel}</div>`;

          for (const axisIdx of Object.keys(groups).map(Number).sort()) {
            const items = groups[axisIdx];
            // Compute block total for % (exclude aggregate lines)
            const isFair = axisIdx === 1;
            const isVar = axisIdx === 2;
            const suffix = isFair ? " (fair)" : isVar ? " (var)" : "";
            const blockItems = suffix
              ? items.filter((p: any) => (p.seriesName ?? "").endsWith(suffix))
              : [];
            const blockAbsSum = blockItems.reduce(
              (s: number, p: any) => s + Math.abs(p.value ?? 0), 0,
            );

            for (const p of items) {
              const v = p.value ?? 0;
              const name: string = p.seriesName ?? "";
              const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span>`;
              const isBlock = suffix && name.endsWith(suffix);
              const pctStr = isBlock && blockAbsSum > 0
                ? ` <span style="color:#8a8f9a">(${((Math.abs(v) / blockAbsSum) * 100).toFixed(1)}%)</span>`
                : "";
              html += `<div>${dot}${name}: <b>${sci(v)}</b>${pctStr}</div>`;
            }
          }
          return html;
        },
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 0,
        top: 30,
        bottom: 40,
        textStyle: { color: "#8a8f9a", fontSize: 9 },
        pageTextStyle: { color: "#8a8f9a" },
        itemWidth: 10,
        itemHeight: 8,
        itemGap: 4,
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1, 2],
          filterMode: "filter",
        },
        {
          type: "slider",
          xAxisIndex: [0, 1, 2],
          bottom: 24,
          height: 14,
          borderColor: "transparent",
          backgroundColor: "rgba(255,255,255,0.03)",
          fillerColor: "rgba(99,110,250,0.15)",
          handleStyle: { color: "#636efa" },
          textStyle: { color: "#8a8f9a", fontSize: 9 },
        },
      ],
      grid: [
        { left: 60, right: 130, top: 30, height: "22%" },
        { left: 60, right: 130, top: "36%", height: "22%" },
        { left: 60, right: 130, top: "66%", height: "22%" },
      ],
      xAxis: [
        {
          type: "category",
          data: timestamps,
          gridIndex: 0,
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
          splitLine: { show: false },
        },
        {
          type: "category",
          data: timestamps,
          gridIndex: 1,
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
          splitLine: { show: false },
        },
        {
          type: "category",
          data: timestamps,
          gridIndex: 2,
          axisLabel: {
            color: "#8a8f9a",
            fontSize: 9,
            formatter: (v: string) => {
              try {
                const d = new Date(v);
                return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
              } catch {
                return v;
              }
            },
          },
          axisTick: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
          axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          name: "Position ($)",
          nameTextStyle: { color: "#8a8f9a", fontSize: 9, padding: [0, 0, 0, -10] },
          axisLabel: { color: "#8a8f9a", fontSize: 9, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)) },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
          axisLine: { show: false },
        },
        {
          type: "value",
          gridIndex: 1,
          name: "Fair Value",
          nameTextStyle: { color: "#8a8f9a", fontSize: 9, padding: [0, 0, 0, -10] },
          axisLabel: { color: "#8a8f9a", fontSize: 9, formatter: (v: number) => sci(v) },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
          axisLine: { show: false },
        },
        {
          type: "value",
          gridIndex: 2,
          name: "Variance",
          nameTextStyle: { color: "#8a8f9a", fontSize: 9, padding: [0, 0, 0, -10] },
          axisLabel: { color: "#8a8f9a", fontSize: 9, formatter: (v: number) => sci(v) },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
          axisLine: { show: false },
        },
      ],
      series: [
        ...(positionSeries as object[]),
        ...(fairSeries as object[]),
        ...(varSeries as object[]),
      ],
    };

    return option;
  }, [data]);

  // Empty / loading states
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-mm-error">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Selector bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-mm-border/40 bg-mm-bg/60 px-3 py-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Instrument
        </label>
        <select
          className="rounded border border-mm-border/60 bg-mm-surface px-2 py-0.5 text-[11px] text-mm-text focus:border-mm-accent focus:outline-none"
          value={selected ? `${selected.symbol}|${selected.expiry}` : ""}
          onChange={handleDimChange}
        >
          {dimensions.map((d) => (
            <option key={`${d.symbol}|${d.expiry}`} value={`${d.symbol}|${d.expiry}`}>
              {d.symbol} — {formatExpiry(d.expiry)}
            </option>
          ))}
        </select>
        {loading && (
          <span className="text-[10px] text-mm-text-dim animate-pulse">Loading…</span>
        )}
      </div>

      {/* Main content: decomposition sidebar (left) + charts */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Decomposition sidebar — left (aligned with "now") */}
        {data && (
          <>
            <div
              className="shrink-0 border-r border-mm-border/40 bg-mm-bg/40"
              style={{ width: sidebarWidth }}
            >
              <DecompositionSidebar
                blocks={data.current_decomposition.blocks}
                aggregated={data.current_decomposition.aggregated}
                mode={decompositionMode}
                onModeChange={setDecompositionMode}
              />
            </div>
            {/* Drag handle */}
            <div
              onMouseDown={onDragStart}
              className="group relative w-1 shrink-0 cursor-col-resize select-none"
            >
              <div className="absolute inset-y-0 -left-0.5 w-2 transition-colors group-hover:bg-mm-accent/20 group-active:bg-mm-accent/30" />
            </div>
          </>
        )}

        {/* Charts */}
        <div className="min-w-0 flex-1">
          {chartOption ? (
            <ReactECharts
              option={chartOption}
              notMerge
              lazyUpdate
              style={{ width: "100%", height: "100%" }}
              opts={{ renderer: "canvas" }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-mm-text-dim">
              {loading
                ? <span className="animate-pulse">Loading pipeline data…</span>
                : dimensions.length === 0
                  ? "No pipeline data available"
                  : "Select an instrument"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
