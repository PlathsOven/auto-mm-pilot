import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useFocus } from "../../../providers/FocusProvider";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { fetchStreamTimeseries } from "../../../services/streamTimeseriesApi";
import { setStreamActive } from "../../../services/streamApi";
import type { StreamTimeseriesResponse, StreamKeyTimeseries } from "../../../types";
import { POLL_INTERVAL_TIMESERIES_MS } from "../../../constants";
import { BLOCK_COLORS, TOOLTIP_STYLE } from "../../PipelineChart/chartOptions";
import {
  formatTooltipDate,
  makeTimeAxisFormatter,
  parseIsoUtc,
  sci,
} from "../../PipelineChart/formatters";

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
  const { payload } = useWebSocket();
  const [data, setData] = useState<StreamTimeseriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglePending, setTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Source of truth for the active flag is the WS payload — it's refreshed
  // every tick and already drives the streams list. Default to true so the
  // button renders as "Deactivate" while the first tick is in flight.
  const active = useMemo(() => {
    const match = payload?.streams.find((s) => s.name === name);
    return match ? match.active : true;
  }, [payload, name]);

  const handleToggleActive = useCallback(async () => {
    setTogglePending(true);
    setToggleError(null);
    try {
      await setStreamActive(name, !active);
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglePending(false);
    }
  }, [name, active]);

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
    <div className="flex h-full flex-col gap-2 p-3">
      <header className="flex items-start justify-between gap-2 border-b border-black/[0.06] pb-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Stream {data && (
              <span
                className={`ml-1 rounded px-1 py-0.5 text-[8px] font-bold ${
                  data.status === "READY" ? "bg-mm-accent/10 text-mm-accent" : "bg-mm-warn/15 text-mm-warn"
                }`}
              >
                {data.status}
              </span>
            )}
            {!active && (
              <span className="ml-1 rounded bg-mm-text-dim/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-mm-text-dim">
                Inactive
              </span>
            )}
          </span>
          <span className="text-[13px] font-semibold text-mm-text">{name}</span>
          {data && (
            <span className="text-[9px] text-mm-text-subtle">
              {data.row_count} row{data.row_count === 1 ? "" : "s"} · {data.series.length} key{data.series.length === 1 ? "" : "s"} · {data.key_cols.join(", ") || "—"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={togglePending}
            className={`whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-wait disabled:opacity-50 ${
              active
                ? "border border-mm-error/30 text-mm-error hover:bg-mm-error/10"
                : "border border-mm-accent/30 text-mm-accent hover:bg-mm-accent/10"
            }`}
            title={active ? "Deactivate stream (keeps config, pauses pipeline contribution)" : "Reactivate stream"}
          >
            {active ? "Deactivate" : "Reactivate"}
          </button>
          <button
            type="button"
            onClick={clearFocus}
            className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            title="Clear focus (Esc)"
          >
            ✕
          </button>
        </div>
      </header>

      {toggleError && <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">{toggleError}</p>}
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
          <p className="text-[10px] text-mm-text-subtle">
            Tip: cells in the position grid use the cached pipeline output, which can outlive a registry reset —
            so values appear there even when the registry is empty.
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

      {data && (
        <KeyLegend series={visibleSeries} />
      )}
    </div>
  );
}

function buildChartOption(series: StreamKeyTimeseries[]): EChartsOption {
  // Time axis (not category) so tick spacing is chronological — a 20-minute
  // gap between pushes renders as a real 20-minute gap, matching the
  // Pipeline chart. Safe here because this chart doesn't stack, so the
  // ECharts-stack-on-time lesson in tasks/lessons.md doesn't apply.
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
    const label = formatKey(s.key);
    // showSymbol: true is load-bearing when the series has a single point —
    // a one-point line has nothing to connect and would render as nothing
    // otherwise (the Inspector's first render right after stream activation
    // lands here, before the WS ticker's heartbeat has appended anything).
    seriesSpecs.push({
      name: `${label} raw`,
      type: "line",
      data,
      showSymbol: true,
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
    grid: { left: 50, right: 16, top: 12, bottom: 24 },
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
