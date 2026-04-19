/** UI constants. Any magic number that appears inline in a component belongs here. */

export const POLL_INTERVAL_TRANSFORMS_MS = 10_000;
export const POLL_INTERVAL_BLOCKS_MS = 5_000;
export const POLL_INTERVAL_TIMESERIES_MS = 5_000;
export const POLL_INTERVAL_SELECTION_MS = 5_000;

export const HOVER_DELAY_MS = 350;

export const SIDEBAR_DEFAULT_WIDTH_PX = 176;
export const SIDEBAR_MIN_WIDTH_PX = 120;
export const SIDEBAR_MAX_WIDTH_PX = 400;

export const UPDATE_HISTORY_MAX_LENGTH = 100;
export const GLOBAL_CONTEXT_TICK_MS = 47;

// Chat textarea auto-grows up to this height (px) before scrolling internally.
export const CHAT_INPUT_MAX_HEIGHT_PX = 160;

// Workbench right inspector column sizing + persistence keys.
export const INSPECTOR_COLUMN_WIDTH_PX = 320;
export const INSPECTOR_COLUMN_OPEN_KEY = "posit-inspector-open";

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
