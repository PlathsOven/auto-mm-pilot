/**
 * Static DAG layout for the Anatomy pipeline canvas.
 *
 * React Flow owns drag / pan / zoom; positions and edge shapes are
 * hand-authored so the graph reads as the 4-space pipeline (risk / raw
 * / calc / target) for a single (symbol, expiry) slice.
 *
 * Ontology: nodes = transformations, edges = values. Each edge label
 * carries the value name plus its current granularity in parentheses
 * so the graph doubles as a shape-of-data legend:
 *   (block)          — one row per block
 *   (block, t)       — per-block time series
 *   (space, t)       — per-(dim, space) time series, blocks collapsed
 *   (t)              — per-dim time series, spaces collapsed
 *
 * Three coloured tracks (fair / var / market) run in parallel through
 * the main pipeline, with two explicit structural crossings:
 *
 *   - `market_value_inference` sits off the main horizontal line,
 *     below the calc lane. Only market + fair flow in; only filled
 *     market flows out, back up to `aggregation`. fair and var bypass
 *     MVI entirely (they go directly RSA → aggregation).
 *   - `calc_to_target` merges fair + market into edge. Handle count
 *     drops 3 → 2 (edge + var) so the merge is visible as a taper.
 *   - `position_sizing` merges edge + var into a single position
 *     output. Handle count drops 2 → 1.
 *
 * Three lane bands tint the background to mark raw / calc / target
 * spaces; `unit_conversion` and `calc_to_target` straddle lane
 * boundaries via a two-tone chip in each node's header.
 */

export const PIPELINE_ORDER = [
  "unit_conversion",
  "temporal_fair_value",
  "risk_space_aggregation",
  "market_value_inference",
  "aggregation",
  "calc_to_target",
  "smoothing",
  "position_sizing",
  "correlations",
] as const;

export type StepKey = (typeof PIPELINE_ORDER)[number];

/** Plain-language one-liner shown as the step node's subtitle. */
export const PIPELINE_NARRATIVE: Record<StepKey, string> = {
  unit_conversion: "Map raw → calc space.",
  temporal_fair_value: "Distribute per-block totals across time.",
  risk_space_aggregation: "Mean across blocks per (dim, space).",
  market_value_inference: "Fill missing market(space, t) using fair(space, t).",
  aggregation: "Sum spaces per (dim, t).",
  calc_to_target: "Calc → target. edge = fair − market.",
  smoothing: "EWM-smooth edge and var.",
  position_sizing: "pos = edge · bankroll / var.",
  correlations: "Back out position from exposure: P = Cₛ⁻¹·E·Cₑ⁻¹.",
};

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

// Main pipeline pitch is 640 px (240-px cards + 400 px free space).
// 400 px is the floor that keeps the three parallel per-track labels
// clear of adjacent cards AND gives the two RSA → MVI detour labels
// enough vertical room that they never crowd the main-line labels.
// market_value_inference sits off the main line in the gap between
// RSA and aggregation, dropped down to Y_MVI — the gap reserves
// horizontal space without requiring a separate main-line column.
const X = {
  streams: 0,
  unit_conversion: 640,
  temporal_fair_value: 1280,
  risk_space_aggregation: 1920,
  market_value_inference: 2240,
  aggregation: 2560,
  calc_to_target: 3200,
  smoothing: 3840,
  position_sizing: 4480,
  correlations: 5120,
  output: 5760,
};

const Y_MAIN = 240;
// Y_MVI pushes MVI well below the main line so the three RSA ↔ MVI ↔
// aggregation detour labels live in their own vertical band, ~300 px
// clear of the main-line labels at y ≈ Y_MAIN + 35..75% of card.
const Y_MVI = 640;

export const STEP_NODE_POSITIONS: Partial<Record<StepKey, { x: number; y: number }>> = {
  unit_conversion: { x: X.unit_conversion, y: Y_MAIN },
  temporal_fair_value: { x: X.temporal_fair_value, y: Y_MAIN },
  risk_space_aggregation: { x: X.risk_space_aggregation, y: Y_MAIN },
  market_value_inference: { x: X.market_value_inference, y: Y_MVI },
  aggregation: { x: X.aggregation, y: Y_MAIN },
  calc_to_target: { x: X.calc_to_target, y: Y_MAIN },
  smoothing: { x: X.smoothing, y: Y_MAIN },
  position_sizing: { x: X.position_sizing, y: Y_MAIN },
  correlations: { x: X.correlations, y: Y_MAIN },
};

export const OUTPUT_NODE_POSITION = { x: X.output, y: Y_MAIN };

export const STREAM_COLUMN_X = X.streams;
export const STREAM_ROW_HEIGHT = 90;
// Offset for the ConnectorNode rendered upstream of a connector-fed stream.
// 220px clears the stream card width (200px) plus a small gap so edge
// labels don't crowd the source node.
export const CONNECTOR_OFFSET = 220;

// ---------------------------------------------------------------------------
// Tracks (fair / var / market / edge)
// ---------------------------------------------------------------------------

export type TrackKey = "fair" | "var" | "market" | "edge";

/** Vertical position (percentage of node height) for each track's
 *  handle. fair / var / market are parallel before calc_to_target;
 *  `edge` sits between fair and var post-CTT so the 3 → 2 taper
 *  signals the fair + market → edge merge. */
export const TRACK_TOP_PCT: Record<TrackKey, number> = {
  fair: 35,
  var: 55,
  market: 75,
  edge: 40,
};

/** Colour each track gets on its edge stroke + handle dots. */
export const TRACK_COLORS: Record<TrackKey, string> = {
  fair: "rgba(99,102,241,0.75)",    // indigo-500
  var: "rgba(251,146,60,0.75)",     // orange-400
  market: "rgba(16,185,129,0.75)",  // emerald-500
  edge: "rgba(139,92,246,0.85)",    // violet-500
};

export interface NodeTrackSpec {
  in: readonly TrackKey[];
  out: readonly TrackKey[];
}

/** Which named handles each main transform node exposes. An empty list
 *  falls back to a single default (unnamed, centred) handle — used for
 *  unit_conversion's raw input (stream edges have no handle spec) and
 *  position_sizing's position output (one edge to the output node). */
export const NODE_TRACKS: Partial<Record<StepKey, NodeTrackSpec>> = {
  unit_conversion: { in: [], out: ["fair", "var", "market"] },
  temporal_fair_value: {
    in: ["fair", "var", "market"],
    out: ["fair", "var", "market"],
  },
  risk_space_aggregation: {
    in: ["fair", "var", "market"],
    out: ["fair", "var", "market"],
  },
  // MVI only uses fair (for inference) + market (the value it fills);
  // it outputs only filled market back to the main pipeline.
  market_value_inference: { in: ["fair", "market"], out: ["market"] },
  aggregation: {
    in: ["fair", "var", "market"],
    out: ["fair", "var", "market"],
  },
  calc_to_target: {
    in: ["fair", "var", "market"],
    out: ["edge", "var"],
  },
  smoothing: { in: ["edge", "var"], out: ["edge", "var"] },
  position_sizing: { in: ["edge", "var"], out: [] },
  // correlations collapses position_sizing's merged output into a single
  // track on both sides — the exposure → position translation is purely
  // positional (not edge / var / market).
  correlations: { in: [], out: [] },
};

// ---------------------------------------------------------------------------
// Lane bands (raw / calc / target)
// ---------------------------------------------------------------------------

const TRANSFORM_HALF_WIDTH = 120;
const UC_CENTRE_X = X.unit_conversion + TRANSFORM_HALF_WIDTH;
const CTT_CENTRE_X = X.calc_to_target + TRANSFORM_HALF_WIDTH;
const OUTPUT_RIGHT_X = X.output + 220;
const LANE_PAD_LEFT = 60;
const LANE_PAD_RIGHT = 60;
const LANE_Y = 100;
// Extended so the band cleanly covers market_value_inference, which
// sits below the main line at Y_MVI (640) + 140 = 780.
const LANE_HEIGHT = 700;

export interface AnatomyLaneBand {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tint: string;
}

export const LANE_BANDS: AnatomyLaneBand[] = [
  {
    id: "lane-raw",
    label: "raw",
    x: -LANE_PAD_LEFT,
    y: LANE_Y,
    width: UC_CENTRE_X + LANE_PAD_LEFT,
    height: LANE_HEIGHT,
    tint: "rgba(99,102,241,0.05)",
  },
  {
    id: "lane-calc",
    label: "calc",
    x: UC_CENTRE_X,
    y: LANE_Y,
    width: CTT_CENTRE_X - UC_CENTRE_X,
    height: LANE_HEIGHT,
    tint: "rgba(79,70,229,0.07)",
  },
  {
    id: "lane-target",
    label: "target",
    x: CTT_CENTRE_X,
    y: LANE_Y,
    width: OUTPUT_RIGHT_X + LANE_PAD_RIGHT - CTT_CENTRE_X,
    height: LANE_HEIGHT,
    tint: "rgba(16,185,129,0.07)",
  },
];

// ---------------------------------------------------------------------------
// Lane-boundary chips — nodes that straddle two lanes display a
// two-tone header chip naming the split (e.g. "raw → calc").
// ---------------------------------------------------------------------------

export interface AnatomyLaneBoundary {
  from: string;
  to: string;
}

export const LANE_BOUNDARIES: Partial<Record<StepKey, AnatomyLaneBoundary>> = {
  unit_conversion: { from: "raw", to: "calc" },
  calc_to_target: { from: "calc", to: "target" },
};

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** Bundled label carried by every stream → unit_conversion edge.
 *  Granularity only — specific columns vary per stream. */
export const STREAM_EDGE_LABEL = "(block)";

export interface AnatomyEdgeDef {
  id: string;
  source: StepKey | "output";
  target: StepKey | "output";
  sourceHandle?: TrackKey;
  targetHandle?: TrackKey;
  label?: string;
}

export const PIPELINE_EDGES: AnatomyEdgeDef[] = [
  // unit_conversion → temporal_fair_value — three parallel tracks emerge.
  { id: "e-uc-td-fair", source: "unit_conversion", target: "temporal_fair_value", sourceHandle: "fair", targetHandle: "fair", label: "fair(block)" },
  { id: "e-uc-td-var", source: "unit_conversion", target: "temporal_fair_value", sourceHandle: "var", targetHandle: "var", label: "var(block)" },
  { id: "e-uc-td-market", source: "unit_conversion", target: "temporal_fair_value", sourceHandle: "market", targetHandle: "market", label: "market(block)" },

  // temporal_fair_value → risk_space_aggregation (per block, t)
  { id: "e-td-rsa-fair", source: "temporal_fair_value", target: "risk_space_aggregation", sourceHandle: "fair", targetHandle: "fair", label: "fair(block, t)" },
  { id: "e-td-rsa-var", source: "temporal_fair_value", target: "risk_space_aggregation", sourceHandle: "var", targetHandle: "var", label: "var(block, t)" },
  { id: "e-td-rsa-market", source: "temporal_fair_value", target: "risk_space_aggregation", sourceHandle: "market", targetHandle: "market", label: "market(block, t)" },

  // RSA → aggregation (fair + var go direct; market is routed via MVI).
  { id: "e-rsa-agg-fair", source: "risk_space_aggregation", target: "aggregation", sourceHandle: "fair", targetHandle: "fair", label: "fair(space, t)" },
  { id: "e-rsa-agg-var", source: "risk_space_aggregation", target: "aggregation", sourceHandle: "var", targetHandle: "var", label: "var(space, t)" },

  // RSA → MVI (fair as inference input; market carries the nullable
  // pre-infer value).
  { id: "e-rsa-mvi-fair", source: "risk_space_aggregation", target: "market_value_inference", sourceHandle: "fair", targetHandle: "fair", label: "fair(space, t)" },
  { id: "e-rsa-mvi-market", source: "risk_space_aggregation", target: "market_value_inference", sourceHandle: "market", targetHandle: "market", label: "market(space, t)?" },

  // MVI → aggregation (only the filled market rejoins the main flow).
  { id: "e-mvi-agg-market", source: "market_value_inference", target: "aggregation", sourceHandle: "market", targetHandle: "market", label: "market(space, t)" },

  // aggregation → calc_to_target — spaces collapsed; per-(dim, t).
  { id: "e-agg-ctt-fair", source: "aggregation", target: "calc_to_target", sourceHandle: "fair", targetHandle: "fair", label: "fair(t)" },
  { id: "e-agg-ctt-var", source: "aggregation", target: "calc_to_target", sourceHandle: "var", targetHandle: "var", label: "var(t)" },
  { id: "e-agg-ctt-market", source: "aggregation", target: "calc_to_target", sourceHandle: "market", targetHandle: "market", label: "market(t)" },

  // calc_to_target → smoothing — fair + market merged into edge inside CTT.
  { id: "e-ctt-smooth-edge", source: "calc_to_target", target: "smoothing", sourceHandle: "edge", targetHandle: "edge", label: "edge(t)" },
  { id: "e-ctt-smooth-var", source: "calc_to_target", target: "smoothing", sourceHandle: "var", targetHandle: "var", label: "var(t)" },

  // smoothing → position_sizing
  { id: "e-smooth-ps-edge", source: "smoothing", target: "position_sizing", sourceHandle: "edge", targetHandle: "edge", label: "smoothed_edge(t)" },
  { id: "e-smooth-ps-var", source: "smoothing", target: "position_sizing", sourceHandle: "var", targetHandle: "var", label: "smoothed_var(t)" },

  // position_sizing → correlations — edge + var merged into exposure.
  { id: "e-ps-corr", source: "position_sizing", target: "correlations", label: "exposure(t)" },

  // correlations → output — post-correlation-inverse position.
  { id: "e-corr-output", source: "correlations", target: "output", label: "position(t)" },
];
