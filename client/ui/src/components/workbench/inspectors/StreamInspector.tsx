import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useFocus } from "../../../providers/FocusProvider";
import { fetchStreamTimeseries } from "../../../services/streamTimeseriesApi";
import type { StreamTimeseriesResponse, StreamKeyTimeseries } from "../../../types";
import { POLL_INTERVAL_TIMESERIES_MS } from "../../../constants";
import { BLOCK_COLORS, MARKET_FAIR_COLOR, sci, TOOLTIP_STYLE } from "../../PipelineChart/chartOptions";

interface StreamInspectorProps {
  name: string;
}

const MAX_SERIES_RENDERED = 6;

/**
 * Inspector view for a focused data stream.
 *
 * Polls `/api/streams/{name}/timeseries` and renders one line per unique
 * key-column combination (typically per symbol/expiry pair). Raw values are
 * solid; market values are dashed in the same colour so the user can compare
 * at a glance.
 */
export function StreamInspector({ name }: StreamInspectorProps) {
  const { clearFocus } = useFocus();
  const [data, setData] = useState<StreamTimeseriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();

    const load = () => {
      fetchStreamTimeseries(name, controller.signal)
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
  }, [name]);

  const visibleSeries = useMemo(() => {
    if (!data) return [];
    return data.series.slice(0, MAX_SERIES_RENDERED);
  }, [data]);

  const chartOption = useMemo<EChartsOption | null>(() => {
    if (visibleSeries.length === 0) return null;
    return buildChartOption(visibleSeries);
  }, [visibleSeries]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-2 border-b border-black/[0.06] pb-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">Stream</span>
          <span className="text-[14px] font-semibold text-mm-text">{name}</span>
          {data && (
            <span className="text-[9px] text-mm-text-subtle">
              {data.series.length} key{data.series.length === 1 ? "" : "s"} · {data.key_cols.join(", ") || "—"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={clearFocus}
          className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          title="Clear focus (Esc)"
        >
          ✕
        </button>
      </header>

      {error && <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">{error}</p>}

      {chartOption ? (
        <div className="min-h-[240px] flex-1">
          <ReactECharts
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ width: "100%", height: "100%" }}
            opts={{ renderer: "canvas" }}
          />
        </div>
      ) : (
        <p className="text-[11px] text-mm-text-dim">
          {loading ? "Loading stream history…" : "No snapshot rows yet for this stream."}
        </p>
      )}

      {data && data.series.length > MAX_SERIES_RENDERED && (
        <p className="text-[10px] text-mm-text-subtle">
          Showing {MAX_SERIES_RENDERED} of {data.series.length} keys (highest cardinality first).
        </p>
      )}

      {data && (
        <KeyLegend series={visibleSeries} />
      )}
    </div>
  );
}

function buildChartOption(series: StreamKeyTimeseries[]): EChartsOption {
  // Use the same x-axis (union of all timestamps) so multiple keys align.
  const allTimestamps = new Set<string>();
  for (const s of series) for (const p of s.points) allTimestamps.add(p.timestamp);
  const timestamps = Array.from(allTimestamps).sort();
  const tsIndex = new Map(timestamps.map((t, i) => [t, i]));

  const seriesSpecs: EChartsOption["series"] = [];
  series.forEach((s, i) => {
    const color = BLOCK_COLORS[i % BLOCK_COLORS.length];
    const rawArr: (number | null)[] = new Array(timestamps.length).fill(null);
    const mktArr: (number | null)[] = new Array(timestamps.length).fill(null);
    for (const p of s.points) {
      const idx = tsIndex.get(p.timestamp);
      if (idx == null) continue;
      rawArr[idx] = p.raw_value;
      if (p.market_value != null) mktArr[idx] = p.market_value;
    }
    const label = formatKey(s.key);
    seriesSpecs.push({
      name: `${label} raw`,
      type: "line",
      data: rawArr,
      showSymbol: false,
      lineStyle: { width: 1.5, color },
      itemStyle: { color },
      connectNulls: true,
    });
    if (mktArr.some((v) => v != null)) {
      seriesSpecs.push({
        name: `${label} mkt`,
        type: "line",
        data: mktArr,
        showSymbol: false,
        lineStyle: { width: 1, color: MARKET_FAIR_COLOR, type: "dashed" },
        itemStyle: { color: MARKET_FAIR_COLOR },
        connectNulls: true,
      });
    }
  });

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      ...TOOLTIP_STYLE,
      confine: true,
      valueFormatter: (v) => (typeof v === "number" ? sci(v) : String(v ?? "—")),
    },
    grid: { left: 50, right: 16, top: 12, bottom: 24 },
    xAxis: {
      type: "category",
      data: timestamps,
      axisLabel: {
        color: "#6e6e82",
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
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#6e6e82", fontSize: 9, formatter: (v: number) => sci(v) },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
      axisLine: { show: false },
    },
    series: seriesSpecs,
  };
}

function KeyLegend({ series }: { series: StreamKeyTimeseries[] }) {
  if (series.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {series.map((s, i) => (
        <span
          key={JSON.stringify(s.key)}
          className="flex items-center gap-1 rounded border border-black/[0.06] bg-white/40 px-1.5 py-0.5 text-[9px]"
        >
          <span
            className="inline-block h-[2px] w-3 rounded-full"
            style={{ backgroundColor: BLOCK_COLORS[i % BLOCK_COLORS.length] }}
          />
          <span className="text-mm-text">{formatKey(s.key)}</span>
        </span>
      ))}
    </div>
  );
}

function formatKey(key: Record<string, string>): string {
  const parts = Object.values(key).filter(Boolean);
  return parts.length ? parts.join(" · ") : "all";
}
