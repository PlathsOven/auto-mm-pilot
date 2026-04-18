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

// Workbench right rail (Inspector + Chat) sizing + persistence keys.
export const WORKBENCH_RAIL_WIDTH_PX = 360;
export const WORKBENCH_RAIL_OPEN_KEY = "posit-rail-open";
export const WORKBENCH_RAIL_TAB_KEY = "posit-rail-tab";
