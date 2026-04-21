import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { fetchStreamTimeseries } from "../../services/streamTimeseriesApi";
import type { StreamTimeseriesResponse, StreamKeyTimeseries } from "../../types";
import { POLL_INTERVAL_TIMESERIES_MS } from "../../constants";
import { BLOCK_COLORS, TOOLTIP_STYLE } from "../PipelineChart/chartOptions";
import {
  formatTooltipDate,
  makeTimeAxisFormatter,
  parseIsoUtc,
  sci,
} from "../PipelineChart/formatters";

interface StreamTimeseriesPanelProps {
  /** Focused stream name; null renders the empty state. */
  name: string | null;
}

const MAX_SERIES_RENDERED = 6;

/**
 * Canvas-panel view of a data stream's raw-value time series.
 *
 * Extracted from the right-rail StreamInspector so the chart can use the
 * wider horizontal space of the canvas's bottom panel. Polls
 * ``/api/streams/{name}/timeseries``; header carries the Deactivate /
 * Reactivate button. Right-rail Inspector no longer renders the chart when a
 * stream is focused — the tabbed `BlockStreamPanel` below the grid does.
 */
export function StreamTimeseriesPanel({ name }: StreamTimeseriesPanelProps) {
  const [data, setData] = useState<StreamTimeseriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!name) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
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

  if (!name) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-[11px] text-mm-text-dim">
        Focus a data stream in the Streams panel to see its raw values.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <header className="flex shrink-0 items-baseline gap-2">
        <span className="text-[13px] font-semibold text-mm-text">{name}</span>
        {data && (
          <span className="text-[10px] text-mm-text-dim">
            {data.row_count} row{data.row_count === 1 ? "" : "s"} · {data.series.length} key{data.series.length === 1 ? "" : "s"} · {data.key_cols.join(", ") || "—"}
          </span>
        )}
      </header>

      {error && <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">{error}</p>}

      {chartOption ? (
        <div className="min-h-0 flex-1">
          <ReactECharts
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ width: "100%", height: "100%" }}
            opts={{ renderer: "canvas" }}
          />
        </div>
      ) : loading ? (
        <p className="text-[11px] text-mm-text-dim">Loading stream history…</p>
      ) : data ? (
        <div className="flex flex-col gap-2 rounded-md border border-black/[0.06] bg-white/40 p-3 text-[11px] text-mm-text-dim">
          <p className="font-semibold text-mm-text">No snapshot rows in the registry.</p>
          <p>
            The stream is registered (<span className="font-mono text-mm-text">{data.status}</span>) but its
            <span className="font-mono text-mm-text"> snapshot_rows</span> array is empty. Push rows via the SDK
            (<span className="font-mono text-mm-text">POST /api/snapshots</span>) or, for manual blocks, edit
            them via the Block Inspector when you focus a block.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-mm-text-dim">No data.</p>
      )}

      {data && data.series.length > MAX_SERIES_RENDERED && (
        <p className="text-[10px] text-mm-text-subtle">
          Showing {MAX_SERIES_RENDERED} of {data.series.length} keys (highest cardinality first).
        </p>
      )}

      {data && <KeyLegend series={visibleSeries} />}
    </div>
  );
}

function buildChartOption(series: StreamKeyTimeseries[]): EChartsOption {
  const allTimestamps: string[] = [];
  const seriesSpecs: EChartsOption["series"] = [];
  series.forEach((s, i) => {
    const color = BLOCK_COLORS[i % BLOCK_COLORS.length];
    const data: [number, number][] = [];
    for (const p of s.points) {
      const d = parseIsoUtc(p.timestamp);
      if (!d) continue;
      data.push([d.getTime(), p.raw_value]);
      allTimestamps.push(p.timestamp);
    }
    const sparse = data.length <= 2;
    seriesSpecs.push({
      name: `${formatKey(s.key)} raw`,
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
      name: "Raw",
      scale: true,
      nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
      axisLabel: { color: "#6e6e82", fontSize: 10, formatter: (v: number) => sci(v) },
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
