/**
 * Shared time-series view for a registered stream.
 *
 * Extracted from StreamInspector so OpinionInspector can embed the same
 * chart + key-list without re-implementing the polling + colour-stability +
 * hide-toggle logic. Pure data viz — no header, no clear-focus control, no
 * active toggle. Callers wrap it with whatever chrome they need.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { fetchStreamTimeseries } from "../../../services/streamTimeseriesApi";
import type { StreamTimeseriesResponse, StreamKeyTimeseries } from "../../../types";
import { POLL_INTERVAL_TIMESERIES_MS } from "../../../constants";
import { BLOCK_COLORS, TOOLTIP_STYLE } from "../../PipelineChart/chartOptions";
import {
  formatTooltipDate,
  makeTimeAxisFormatter,
  parseIsoUtc,
  sci,
} from "../../PipelineChart/formatters";

// Fixed chart height so the legend list below can take whatever room it
// needs without compressing the chart to unreadable thickness.
const CHART_HEIGHT_PX = 320;

interface Props {
  streamName: string;
}

export function StreamTimeseriesView({ streamName }: Props) {
  const [data, setData] = useState<StreamTimeseriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Hidden key set is client-only, keyed by JSON-stringified key spec so it
  // survives the next poll's response identity churn but resets on stream
  // change (component remount via focus switch).
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();

    const load = () => {
      fetchStreamTimeseries(streamName, controller.signal)
        .then((res) => {
          if (aborted) return;
          setData(res);
          setError(null);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (aborted) return;
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    };

    setData(null);
    setLoading(true);
    setError(null);
    load();
    const interval = setInterval(load, POLL_INTERVAL_TIMESERIES_MS);
    return () => {
      aborted = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [streamName]);

  // Stable colour per key, assigned in the order the server returned keys
  // on the first non-empty response. Keeps a given series the same colour
  // across poll refreshes and across hide/show toggles.
  const colorByKey = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    data.series.forEach((s, i) => {
      map.set(keyId(s.key), BLOCK_COLORS[i % BLOCK_COLORS.length]);
    });
    return map;
  }, [data]);

  const visibleSeries = useMemo(() => {
    if (!data) return [];
    return data.series.filter((s) => !hiddenKeys.has(keyId(s.key)));
  }, [data, hiddenKeys]);

  const chartOption = useMemo<EChartsOption | null>(() => {
    if (visibleSeries.length === 0) return null;
    return buildChartOption(visibleSeries, colorByKey);
  }, [visibleSeries, colorByKey]);

  const toggleKey = useCallback((id: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (error) {
    return (
      <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">
        {error}
      </p>
    );
  }

  if (data && data.series.length > 0) {
    return (
      <>
        <div className="shrink-0" style={{ height: CHART_HEIGHT_PX }}>
          {chartOption ? (
            <ReactECharts
              option={chartOption}
              notMerge
              lazyUpdate
              style={{ width: "100%", height: "100%" }}
              opts={{ renderer: "canvas" }}
            />
          ) : (
            <p className="flex h-full items-center justify-center text-[11px] text-mm-text-dim">
              All series hidden — toggle one below to show.
            </p>
          )}
        </div>
        <KeyList
          series={data.series}
          colorByKey={colorByKey}
          hiddenKeys={hiddenKeys}
          onToggle={toggleKey}
        />
      </>
    );
  }

  if (loading) {
    return <p className="text-[11px] text-mm-text-dim">Loading stream history…</p>;
  }

  if (data) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-black/[0.06] bg-white/40 p-3 text-[11px] text-mm-text-dim">
        <p className="font-semibold text-mm-text">No snapshot rows in the registry.</p>
        <p>
          The stream is registered (<span className="font-mono text-mm-text">{data.status}</span>) but its
          <span className="font-mono text-mm-text"> snapshot_rows</span> array is empty. Push rows via the SDK
          (<span className="font-mono text-mm-text">POST /api/snapshots</span>) or, for manual blocks, edit
          them via the Block Inspector when you focus a block.
        </p>
        <p className="text-[10px] text-mm-text-subtle">
          Tip: cells in the position grid use the cached pipeline output, which can outlive a registry reset —
          so values appear there even when the registry is empty.
        </p>
      </div>
    );
  }

  return <p className="text-[11px] text-mm-text-dim">No data.</p>;
}

function KeyList({
  series,
  colorByKey,
  hiddenKeys,
  onToggle,
}: {
  series: StreamKeyTimeseries[];
  colorByKey: Map<string, string>;
  hiddenKeys: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (series.length === 0) return null;
  return (
    <ul className="flex shrink-0 flex-col gap-0.5">
      <li className="flex items-center justify-between px-1 pb-1 text-[9px] uppercase tracking-wider text-mm-text-dim">
        <span>Keys ({series.length})</span>
        <span className="text-mm-text-subtle">click to toggle</span>
      </li>
      {series.map((s) => {
        const id = keyId(s.key);
        const hidden = hiddenKeys.has(id);
        const color = colorByKey.get(id) ?? BLOCK_COLORS[0];
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onToggle(id)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-[10px] transition-colors ${
                hidden
                  ? "border-transparent bg-transparent text-mm-text-subtle hover:bg-black/[0.03]"
                  : "border-black/[0.06] bg-white/45 text-mm-text hover:bg-white/70"
              }`}
              aria-pressed={!hidden}
            >
              <span
                className="inline-block h-[3px] w-4 shrink-0 rounded-full"
                style={{ backgroundColor: hidden ? "rgba(0,0,0,0.18)" : color }}
              />
              <span className={`flex-1 truncate font-mono ${hidden ? "line-through" : ""}`}>
                {formatKey(s.key)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function keyId(key: Record<string, string>): string {
  return JSON.stringify(key);
}

function buildChartOption(
  series: StreamKeyTimeseries[],
  colorByKey: Map<string, string>,
): EChartsOption {
  // Time axis (not category) so tick spacing is chronological — a 20-minute
  // gap between pushes renders as a real 20-minute gap, matching the
  // Pipeline chart. Safe here because this chart doesn't stack, so the
  // ECharts-stack-on-time lesson in tasks/lessons.md doesn't apply.
  const allTimestamps: string[] = [];
  const seriesSpecs: EChartsOption["series"] = [];
  series.forEach((s) => {
    const color = colorByKey.get(keyId(s.key)) ?? BLOCK_COLORS[0];
    const data: [number, number][] = [];
    for (const p of s.points) {
      const d = parseIsoUtc(p.timestamp);
      if (!d) continue;
      data.push([d.getTime(), p.raw_value]);
      allTimestamps.push(p.timestamp);
    }
    // Markers only on sparse series — a one-point series has nothing to
    // connect and would render invisibly with showSymbol:false, but with
    // heartbeat-dense data (one point every 2s) dots overwhelm the line.
    // `<=2` keeps the symbol for the single-point "just activated" state
    // and drops it the moment the heartbeat has produced a real line.
    const sparse = data.length <= 2;
    seriesSpecs.push({
      name: formatKey(s.key),
      type: "line",
      data,
      showSymbol: sparse,
      symbolSize: 4,
      lineStyle: { width: 1.5, color },
      itemStyle: { color },
      connectNulls: true,
    });
  });
  const axisFormatter = makeTimeAxisFormatter(allTimestamps.sort());

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      ...TOOLTIP_STYLE,
      confine: true,
      formatter: (paramsRaw) => {
        const params = Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw];
        if (params.length === 0) return "";
        const first = params[0].value;
        const header = Array.isArray(first) && typeof first[0] === "number"
          ? formatTooltipDate(new Date(first[0]))
          : String(params[0].name ?? "");
        const rows = params
          .map((p) => {
            const raw = Array.isArray(p.value) ? p.value[1] : p.value;
            const v = typeof raw === "number" ? sci(raw) : String(raw ?? "—");
            return `<div style="display:flex;justify-content:space-between;gap:16px;"><span>${p.marker} ${p.seriesName}</span><span style="font-family:monospace;">${v}</span></div>`;
          })
          .join("");
        return `<div style="font-weight:600;margin-bottom:4px;">${header}</div>${rows}`;
      },
    },
    dataZoom: [
      { type: "inside", filterMode: "filter" },
      {
        type: "slider",
        bottom: 6,
        height: 12,
        borderColor: "transparent",
        backgroundColor: "rgba(0,0,0,0.03)",
        fillerColor: "rgba(79,91,213,0.10)",
        handleStyle: { color: "#4f5bd5", borderColor: "rgba(255,255,255,0.6)" },
        textStyle: { color: "#6e6e82", fontSize: 9 },
      },
    ],
    grid: { left: 56, right: 16, top: 12, bottom: 48 },
    xAxis: {
      type: "time",
      axisLabel: {
        color: "#6e6e82",
        fontSize: 9,
        hideOverlap: true,
        lineHeight: 11,
        formatter: axisFormatter,
      },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      // `scale: true` disables ECharts' default "include zero" behaviour,
      // so tight clusters (e.g. rolling realized-vol in [0.40, 0.45]) fill
      // the plot area instead of squashing against one edge. Matches the
      // Pipeline chart's y-axis.
      scale: true,
      axisLabel: { color: "#6e6e82", fontSize: 10, formatter: (v: number) => sci(v) },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
      axisLine: { show: false },
    },
    series: seriesSpecs,
  };
}

function formatKey(key: Record<string, string>): string {
  const parts = Object.values(key).filter(Boolean);
  return parts.length ? parts.join(" · ") : "all";
}
