import { useCallback, useEffect, useMemo, useState } from "react";
import { PipelineChart } from "../PipelineChart";
import { Tabs, type TabItem } from "../ui/Tabs";
import { MetricDropdown, SmoothingToggle } from "../ui/MetricControls";
import { useFocus } from "../../providers/FocusProvider";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { usePipelineTimeSeries } from "../../hooks/usePipelineTimeSeries";
import {
  formatExpiry,
  metricOf,
  viewModeOf,
  safeGetItem,
  safeSetItem,
  SMOOTHABLE_METRICS,
  type Metric,
  type Smoothing,
} from "../../utils";
import type { ViewMode } from "../../types";
import {
  POSITION_LOOKBACK_OPTIONS,
  DEFAULT_POSITION_LOOKBACK_LABEL,
  POSITION_LOOKBACK_KEY,
  PIPELINE_LINK_KEY,
  PIPELINE_DECOMPOSE_KEY,
  DECOMPOSABLE_METRICS,
  VIEW_MODE_META,
} from "../../constants";

interface PipelineChartPanelProps {
  /** The position grid's current view mode — pipeline mirrors it when
   *  "Linked" is on (default). */
  gridViewMode: ViewMode;
  /** Setter so the pipeline can push its (metric, smoothing) choice back
   *  to the grid when linked is on. Composes both fields into a single
   *  `ViewMode`. */
  onGridViewModeChange: (mode: ViewMode) => void;
}

/**
 * Pipeline chart panel — same dropdown + Instant/Smoothed controls as the
 * Overview grid, visually identical via the shared `MetricDropdown` +
 * `SmoothingToggle` primitives. "Link grid" (default on, persisted)
 * mirrors both metric and smoothing from the grid bidirectionally.
 */
export function PipelineChartPanel({ gridViewMode, onGridViewModeChange }: PipelineChartPanelProps) {
  const { focus } = useFocus();
  const { payload } = useWebSocket();

  const [linked, setLinked] = useState<boolean>(
    () => safeGetItem(PIPELINE_LINK_KEY) !== "false",
  );
  const [decompose, setDecompose] = useState<boolean>(
    () => safeGetItem(PIPELINE_DECOMPOSE_KEY) === "true",
  );
  const gridMetric = metricOf(gridViewMode).metric;
  const gridSmoothing = metricOf(gridViewMode).smoothing;

  const [localMetric, setLocalMetric] = useState<Metric>(gridMetric);
  const [localSmoothing, setLocalSmoothing] = useState<Smoothing>(gridSmoothing);
  const [lookbackLabel, setLookbackLabel] = useState<string>(() => {
    const saved = safeGetItem(POSITION_LOOKBACK_KEY);
    if (saved && POSITION_LOOKBACK_OPTIONS.some((o) => o.label === saved)) return saved;
    return DEFAULT_POSITION_LOOKBACK_LABEL;
  });

  const effectiveMetric: Metric = linked ? gridMetric : localMetric;
  const effectiveSmoothing: Smoothing = linked ? gridSmoothing : localSmoothing;
  const smoothable = (SMOOTHABLE_METRICS as readonly Metric[]).includes(effectiveMetric);
  const effectiveViewMode = viewModeOf(effectiveMetric, effectiveSmoothing);
  const meta = VIEW_MODE_META[effectiveViewMode];

  const persistLookback = useCallback((next: string) => {
    setLookbackLabel(next);
    safeSetItem(POSITION_LOOKBACK_KEY, next);
  }, []);

  const lookbackTabs = useMemo<TabItem<string>[]>(
    () => POSITION_LOOKBACK_OPTIONS.map((o) => ({ value: o.label, label: o.label })),
    [],
  );

  const persistLinked = useCallback((next: boolean) => {
    setLinked(next);
    safeSetItem(PIPELINE_LINK_KEY, String(next));
  }, []);

  const persistDecompose = useCallback((next: boolean) => {
    setDecompose(next);
    safeSetItem(PIPELINE_DECOMPOSE_KEY, String(next));
  }, []);

  // Resolve a (symbol, expiry) to channel from the current focus. Block
  // focus carries its full composite key, so we can route the chart to
  // the block's dimension.
  const focusDimension = useMemo(() => {
    if (!focus || !payload) return null;
    if (focus.kind === "cell") return { symbol: focus.symbol, expiry: focus.expiry };
    if (focus.kind === "symbol") {
      const m = payload.positions.find((p) => p.symbol === focus.symbol);
      return m ? { symbol: m.symbol, expiry: m.expiry } : null;
    }
    if (focus.kind === "expiry") {
      const m = payload.positions.find((p) => p.expiry === focus.expiry);
      return m ? { symbol: m.symbol, expiry: m.expiry } : null;
    }
    if (focus.kind === "block") return { symbol: focus.key.symbol, expiry: focus.key.expiry };
    return null;
  }, [focus, payload]);

  const lookbackSeconds = useMemo<number | null>(() => {
    const opt = POSITION_LOOKBACK_OPTIONS.find((o) => o.label === lookbackLabel);
    return opt?.seconds ?? null;
  }, [lookbackLabel]);

  const { dimensions, selected, setSelected, data, error, loading } = usePipelineTimeSeries(
    focusDimension,
    lookbackSeconds,
  );

  // Decomposition only works when (a) the metric has a calc-space form,
  // (b) the smoothing toggle is Instant (per-space smoothing isn't computed
  // server-side), and (c) the payload carries perSpace data — the history
  // path emits an empty dict since the ring buffer holds no per-space trace.
  const decomposable = useMemo(() => {
    if (!DECOMPOSABLE_METRICS.includes(effectiveMetric)) return false;
    if (effectiveSmoothing !== "instant") return false;
    if (!data || !data.aggregated.perSpace) return false;
    return Object.keys(data.aggregated.perSpace).length > 0;
  }, [effectiveMetric, effectiveSmoothing, data]);
  const effectiveDecompose = decompose && decomposable;

  // Keep local state in sync while linked so unlinking doesn't jump.
  useEffect(() => {
    if (linked) {
      setLocalMetric(gridMetric);
      setLocalSmoothing(gridSmoothing);
    }
  }, [linked, gridMetric, gridSmoothing]);

  const handleDimChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const [sym, exp] = e.target.value.split("|");
      setSelected({ symbol: sym, expiry: exp });
    },
    [setSelected],
  );

  const setMetric = useCallback(
    (next: Metric) => {
      setLocalMetric(next);
      if (linked) onGridViewModeChange(viewModeOf(next, effectiveSmoothing));
    },
    [linked, effectiveSmoothing, onGridViewModeChange],
  );

  const setSmoothing = useCallback(
    (next: Smoothing) => {
      setLocalSmoothing(next);
      if (linked && (SMOOTHABLE_METRICS as readonly Metric[]).includes(effectiveMetric)) {
        onGridViewModeChange(viewModeOf(effectiveMetric, next));
      }
    },
    [linked, effectiveMetric, onGridViewModeChange],
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] px-3 pb-2 pt-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">Pipeline</h2>
          {meta.unit && (
            <span className="text-[10px] text-mm-text-dim">({meta.unit})</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${
              linked
                ? "border-mm-accent/30 bg-mm-accent-soft text-mm-accent"
                : "border-black/[0.08] text-mm-text-dim hover:bg-black/[0.04]"
            }`}
            title="When on, pipeline controls mirror the position grid"
          >
            <input
              type="checkbox"
              checked={linked}
              onChange={(e) => persistLinked(e.target.checked)}
              className="accent-mm-accent"
            />
            <span>Link grid</span>
          </label>
          <Tabs
            items={lookbackTabs}
            value={lookbackLabel}
            onChange={persistLookback}
            variant="pill"
            size="sm"
          />
          <select
            className="rounded-md border border-black/[0.08] bg-white/70 px-2 py-0.5 text-[10px] text-mm-text focus:border-mm-accent/40 focus:outline-none"
            value={selected ? `${selected.symbol}|${selected.expiry}` : ""}
            onChange={handleDimChange}
            title="Dimension to chart (auto-channels from focus)"
          >
            {dimensions.map((d) => (
              <option key={`${d.symbol}|${d.expiry}`} value={`${d.symbol}|${d.expiry}`}>
                {d.symbol} — {formatExpiry(d.expiry)}
              </option>
            ))}
          </select>
          <MetricDropdown value={effectiveMetric} onChange={setMetric} />
          <SmoothingToggle
            value={effectiveSmoothing}
            onChange={setSmoothing}
            disabled={!smoothable}
          />
          <label
            className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${
              !decomposable
                ? "cursor-not-allowed border-black/[0.06] text-mm-text-subtle opacity-60"
                : effectiveDecompose
                  ? "border-mm-accent/30 bg-mm-accent-soft text-mm-accent"
                  : "border-black/[0.08] text-mm-text-dim hover:bg-black/[0.04]"
            }`}
            title={
              !DECOMPOSABLE_METRICS.includes(effectiveMetric)
                ? "Decompose is available for Fair / Variance / Market (Calc) only"
                : effectiveSmoothing !== "instant"
                  ? "Decompose requires Instant smoothing (per-space smoothing isn't computed)"
                  : !decomposable
                    ? "Per-space decomposition not available for this window"
                    : "Stack per-risk-space calc-space contributions"
            }
          >
            <input
              type="checkbox"
              checked={effectiveDecompose}
              disabled={!decomposable}
              onChange={(e) => persistDecompose(e.target.checked)}
              className="accent-mm-accent"
            />
            <span>Decompose</span>
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <PipelineChart
          data={data}
          loading={loading}
          error={error}
          metric={effectiveMetric}
          smoothing={effectiveSmoothing}
          decompose={effectiveDecompose}
        />
      </div>
    </div>
  );
}
