/** UI constants. Any magic number that appears inline in a component belongs here. */

import type { ViewMode, ViewModeMeta } from "./types";
import type { Metric } from "./utils";

export const POLL_INTERVAL_TRANSFORMS_MS = 10_000;
export const POLL_INTERVAL_BLOCKS_MS = 5_000;
export const POLL_INTERVAL_TIMESERIES_MS = 5_000;
export const POLL_INTERVAL_STREAMS_MS = 5_000;

export const HOVER_DELAY_MS = 350;

// WebSocket reconnection backoff when the /ws connection drops.
export const WS_RECONNECT_DELAY_MS = 3_000;

// useHotkeys — how long a chord prefix (`g…`) stays live waiting for the
// second key. 1.2s is comfortable without stealing bare-key shortcuts.
export const CHORD_WINDOW_MS = 1_200;

// useStreamContributions — per-cell block decomposition TTL.
export const CONTRIBUTIONS_CACHE_TTL_MS = 5_000;

// usePipelineTimeSeries — LRU cap on cached time-series responses.
export const PIPELINE_TIMESERIES_CACHE_MAX_ENTRIES = 12;

// DesiredPositionGrid — how long a recently-updated cell stays highlighted.
export const HIGHLIGHT_DURATION_MS = 2_000;

export const SIDEBAR_DEFAULT_WIDTH_PX = 176;
export const SIDEBAR_MIN_WIDTH_PX = 120;
export const SIDEBAR_MAX_WIDTH_PX = 400;

export const UPDATE_HISTORY_MAX_LENGTH = 100;

// Chat textarea auto-grows up to this height (px) before scrolling internally.
export const CHAT_INPUT_MAX_HEIGHT_PX = 160;

// Workbench right inspector column sizing + persistence keys.
export const INSPECTOR_COLUMN_WIDTH_PX = 320;
export const INSPECTOR_COLUMN_MIN_WIDTH_PX = 220;
export const INSPECTOR_COLUMN_MAX_WIDTH_PX = 960;
export const INSPECTOR_COLUMN_OPEN_KEY = "posit-inspector-open";
export const INSPECTOR_COLUMN_WIDTH_KEY = "posit-inspector-width";

// Bottom chat dock — independent of the inspector now.
export const CHAT_DOCK_HEIGHT_PX = 280;
export const CHAT_DOCK_OPEN_KEY = "posit-chatdock-open";

// Left navigation sidebar (mode + account + actions).
export const LEFTNAV_EXPANDED_WIDTH_PX = 196;
export const LEFTNAV_COLLAPSED_WIDTH_PX = 52;
export const LEFTNAV_OPEN_KEY = "posit-leftnav-open";

// Bottom status bar height — fixed so the main scroller sizes correctly.
export const STATUSBAR_HEIGHT_PX = 24;

// Posit Control automation toggle persistence key.
export const POSIT_CONTROL_KEY = "posit-control-enabled";

// Status-bar tick freshness updates (ms). Keep separate from the
// global-context-bar tick — different cadence, different consumer.
export const STATUSBAR_TICK_MS = 250;

// Width of the bankroll-edit popover anchored off the StatusBar pill.
export const BANKROLL_POPOVER_WIDTH_PX = 240;

// Anatomy — how long to keep showing a "loading" screen while the initial
// `/api/transforms` fetch is still racing server startup / snapshot ingestion.
// After this window, if we still have no `steps`, surface the full error panel.
export const ANATOMY_STARTUP_GRACE_MS = 6_000;

// Pipeline chart — Position view lookback window options. Applied only to
// the Position tab; Fair and Variance are forward-looking decay curves.
// `seconds: null` renders whatever the server provides with no lookback
// param (the single-point-at-now fallback).
export const POSITION_LOOKBACK_OPTIONS: readonly { label: string; seconds: number | null }[] = [
  { label: "5m", seconds: 5 * 60 },
  { label: "15m", seconds: 15 * 60 },
  { label: "1h", seconds: 60 * 60 },
  { label: "4h", seconds: 4 * 60 * 60 },
  { label: "1d", seconds: 24 * 60 * 60 },
];

export const DEFAULT_POSITION_LOOKBACK_LABEL = "15m";
export const POSITION_LOOKBACK_KEY = "posit-position-lookback";

// Pipeline chart "Link grid" toggle — when on, the pipeline view mirrors the
// position grid's active view mode.
export const PIPELINE_LINK_KEY = "posit-pipeline-linked";

// Pipeline chart "Decompose" toggle — when on (and metric ∈ {fair, variance,
// marketCalc} and smoothing = instant), the chart renders per-risk-space
// stacked contributions in calc space (variance-linear) rather than the
// single aggregated line in vol-points.
export const PIPELINE_DECOMPOSE_KEY = "posit-pipeline-decompose";

// Metrics whose calc-space per-space decomposition is emitted in the
// timeseries payload. Used to gate the Decompose toggle in the panel.
export const DECOMPOSABLE_METRICS: readonly Metric[] = ["fair", "variance", "marketCalc"];

// Block inspector "Follow focus" toggle — auto-filters the table to the
// workbench focus dimension when on.
export const BLOCKS_FOLLOW_FOCUS_KEY = "posit-blocks-follow-focus";

// LlmChat command history persistence.
export const CHAT_HISTORY_KEY = "posit-chat-history";
export const CHAT_HISTORY_MAX = 50;

// ---------------------------------------------------------------------------
// Position grid — view modes + timeframe options
// ---------------------------------------------------------------------------

export const VIEW_MODE_META: Record<ViewMode, ViewModeMeta> = {
  position: { label: "Smoothed Desired", unit: "$vega", decimals: 2, signed: true },
  rawPosition: { label: "Instant Desired", unit: "$vega", decimals: 2, signed: true },
  edge: { label: "Instant Edge", unit: "vp", decimals: 2, signed: true },
  smoothedEdge: { label: "Smoothed Edge", unit: "vp", decimals: 2, signed: true },
  variance: { label: "Instant Variance", unit: "vp", decimals: 2, signed: false },
  smoothedVar: { label: "Smoothed Variance", unit: "vp", decimals: 2, signed: false },
  fair: { label: "Instant Fair", unit: "vp", decimals: 2, signed: false },
  smoothedFair: { label: "Smoothed Fair", unit: "vp", decimals: 2, signed: false },
  marketCalculated: { label: "Instant Market (Calc)", unit: "vp", decimals: 2, signed: false },
  smoothedMarketCalculated: { label: "Smoothed Market (Calc)", unit: "vp", decimals: 2, signed: false },
  marketSource: { label: "Market (Source)", unit: "vp", decimals: 2, signed: false },
};

/** Dropdown entries for the Overview grid. Each row is one metric; the
 *  Smoothed/Instant toggle picks the variant. `marketSource` and `change`
 *  have no smoothed variant — the toggle is disabled when they're selected. */
export interface MetricMeta {
  label: string;
  unit: string;
  decimals: number;
  signed: boolean;
}

export const METRIC_META: Record<Metric, MetricMeta> = {
  desired: { label: "Desired", unit: "$vega", decimals: 2, signed: true },
  edge: { label: "Edge", unit: "vp", decimals: 2, signed: true },
  variance: { label: "Variance", unit: "vp", decimals: 2, signed: false },
  fair: { label: "Fair", unit: "vp", decimals: 2, signed: false },
  marketCalc: { label: "Market (Calc)", unit: "vp", decimals: 2, signed: false },
  marketSource: { label: "Market (Source)", unit: "vp", decimals: 2, signed: false },
};

/** Metric order in the Overview dropdown. */
export const METRICS: readonly Metric[] = [
  "desired",
  "edge",
  "variance",
  "fair",
  "marketCalc",
  "marketSource",
];

/** Persistence key for the Smoothed/Instant toggle — the dropdown state
 *  itself lives in the parent (WorkbenchPage) as the controlling viewMode. */
export const OVERVIEW_SMOOTHING_KEY = "posit-overview-smoothing";
