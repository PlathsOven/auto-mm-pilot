import { useCallback, useEffect, useMemo, useState } from "react";
import { PipelineChart } from "../PipelineChart";
import { PipelineContributionsChart } from "./PipelineContributionsChart";
import { Tabs, type TabItem } from "../ui/Tabs";
import {
  ContributionMetricDropdown,
  MetricDropdown,
  SmoothingToggle,
} from "../ui/MetricControls";
import { useFocus } from "../../providers/FocusProvider";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { usePipelineTimeSeries } from "../../hooks/usePipelineTimeSeries";
import { usePipelineContributions } from "../../hooks/usePipelineContributions";
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
  CONTRIBUTION_METRICS,
  CONTRIBUTION_METRIC_KEY,
  POSITION_LOOKBACK_OPTIONS,
  DEFAULT_POSITION_LOOKBACK_LABEL,
  POSITION_LOOKBACK_KEY,
  PIPELINE_LINK_KEY,
  PIPELINE_TAB_KEY,
  VIEW_MODE_META,
  type ContributionMetric,
  type PipelineTab,
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

const PIPELINE_TABS: readonly TabItem<PipelineTab>[] = [
  { value: "metric", label: "Metric", title: "Single-metric time series" },
  {
    value: "contributions",
    label: "Contributions",
    title: "Per-space stacked calc-space contributions over now − lookback → expiry",
  },
];

/**
 * Pipeline chart panel — tabbed: Metric (single-metric time series,
 * mirrors the Overview grid cell semantics) and Contributions (per-space
 * calc-space stack covering now − lookback → expiry, so the trader can
 * see which spaces drive Fair / Variance / Market across revealed history
 * and forward projection in one view).
 *
 * Lookback and the (symbol, expiry) dropdown are shared controls — both
 * tabs pin to the same workbench focus. Metric-specific controls
 * (metric dropdown, smoothing, "Link grid") only render on the Metric
 * tab.
 */
export function PipelineChartPanel({ gridViewMode, onGridViewModeChange }: PipelineChartPanelProps) {
  const { focus } = useFocus();
  const { payload } = useWebSocket();

  const [activeTab, setActiveTab] = useState<PipelineTab>(() => {
    const saved = safeGetItem(PIPELINE_TAB_KEY);
    return saved === "contributions" ? "contributions" : "metric";
  });
  const persistTab = useCallback((next: PipelineTab) => {
    setActiveTab(next);
    safeSetItem(PIPELINE_TAB_KEY, next);
  }, []);

  const [contributionMetric, setContributionMetric] = useState<ContributionMetric>(() => {
    const saved = safeGetItem(CONTRIBUTION_METRIC_KEY);
    return (CONTRIBUTION_METRICS as readonly string[]).includes(saved ?? "")
      ? (saved as ContributionMetric)
      : "fair";
  });
  const persistContributionMetric = useCallback((next: ContributionMetric) => {
    setContributionMetric(next);
    safeSetItem(CONTRIBUTION_METRIC_KEY, next);
  }, []);

  const [linked, setLinked] = useState<boolean>(
    () => safeGetItem(PIPELINE_LINK_KEY) !== "false",
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

  const {
    dimensions,
    selected,
    setSelected,
    data: timeSeriesData,
    error: timeSeriesError,
    loading: timeSeriesLoading,
  } = usePipelineTimeSeries(focusDimension, lookbackSeconds);

  // Contributions tab pins to the same (symbol, expiry) selection the
  // Metric tab drives — workbench focus is shared across both tabs. The
  // endpoint returns every metric's per-space arrays in one shot, so
  // flipping the Fair / Variance / Market dropdown inside the tab is a
  // client-side render switch, not a re-fetch.
  const contributionsActive = activeTab === "contributions";
  const {
    data: contribData,
    error: contribError,
    loading: contribLoading,
  } = usePipelineContributions(
    contributionsActive ? selected : null,
    lookbackSeconds,
  );

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
          {activeTab === "metric" && meta.unit && (
            <span className="text-[10px] text-mm-text-dim">({meta.unit})</span>
          )}
          {contributionsActive && (
            <span className="text-[10px] text-mm-text-dim">(calc · variance units)</span>
          )}
          <Tabs
            items={PIPELINE_TABS}
            value={activeTab}
            onChange={persistTab}
            variant="pill"
            size="sm"
            className="ml-1"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === "metric" && (
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
          )}
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
          {activeTab === "metric" ? (
            <>
              <MetricDropdown value={effectiveMetric} onChange={setMetric} />
              <SmoothingToggle
                value={effectiveSmoothing}
                onChange={setSmoothing}
                disabled={!smoothable}
              />
            </>
          ) : (
            <ContributionMetricDropdown
              value={contributionMetric}
              onChange={persistContributionMetric}
            />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "metric" ? (
          <PipelineChart
            data={timeSeriesData}
            loading={timeSeriesLoading}
            error={timeSeriesError}
            metric={effectiveMetric}
          />
        ) : (
          <PipelineContributionsChart
            data={contribData}
            loading={contribLoading}
            error={contribError}
            metric={contributionMetric}
          />
        )}
      </div>
    </div>
  );
}
