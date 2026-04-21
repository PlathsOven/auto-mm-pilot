/**
 * Static DAG layout for the Anatomy pipeline canvas.
 *
 * React Flow is responsible for drag/pan/zoom, but the initial positions of
 * the fixed pipeline nodes are hardcoded here so the graph always reads in
 * left-to-right DAG order with the fair-value / variance branch clearly
 * visible. Stream node positions are computed at runtime from the registry
 * (stacked vertically to the left of `unit_conversion`).
 */

export const PIPELINE_ORDER = [
  "unit_conversion",
  "decay_profile",
  "temporal_fair_value",
  "variance",
  "aggregation",
  "calc_to_target",
  "smoothing",
  "position_sizing",
] as const;

export type StepKey = (typeof PIPELINE_ORDER)[number];

/** Plain-language one-liner shown as the step node's subtitle. */
export const PIPELINE_NARRATIVE: Record<StepKey, string> = {
  unit_conversion: "Map raw units into calculation space (e.g. variance).",
  decay_profile: "Decide how a block's influence fades over time.",
  temporal_fair_value: "Compose blocks into a fair / var / market time series.",
  variance: "Quantify uncertainty around the fair value.",
  aggregation: "Sum across risk spaces within each (symbol, expiry).",
  calc_to_target: "Forward-integrate + annualise calc space into target space.",
  smoothing: "Stabilise edge and variance against short-term noise.",
  position_sizing: "Translate edge + variance + bankroll into a position.",
};

/** Column x-coordinates (pixels) for each pipeline step.
 *
 * Node cards are ~240px wide — the 380px column spacing leaves ~140px of
 * free space for the edge label chip between each pair of nodes. */
const X = {
  streams: 0,
  unit_conversion: 380,
  decay_profile: 760,
  temporal_fair_value: 1140,
  variance: 1520,
  aggregation: 1900,
  calc_to_target: 2280,
  smoothing: 2660,
  position_sizing: 3040,
  output: 3420,
};

/** Base y-row (main track). */
const Y_MAIN = 240;
/** Variance branch row — offset downward to show the fork clearly. */
const Y_VARIANCE = 440;

/** Hardcoded positions for the transform step nodes + the output node. */
export const STEP_NODE_POSITIONS: Record<StepKey, { x: number; y: number }> = {
  unit_conversion: { x: X.unit_conversion, y: Y_MAIN },
  decay_profile: { x: X.decay_profile, y: Y_MAIN },
  temporal_fair_value: { x: X.temporal_fair_value, y: Y_MAIN },
  variance: { x: X.variance, y: Y_VARIANCE },
  aggregation: { x: X.aggregation, y: Y_MAIN },
  calc_to_target: { x: X.calc_to_target, y: Y_MAIN },
  smoothing: { x: X.smoothing, y: Y_MAIN },
  position_sizing: { x: X.position_sizing, y: Y_MAIN },
};

export const OUTPUT_NODE_POSITION = { x: X.output, y: Y_MAIN };

/** Column x for stream nodes (stacked vertically to the left of unit_conversion). */
export const STREAM_COLUMN_X = X.streams;
/** Vertical spacing between stacked stream nodes. */
export const STREAM_ROW_HEIGHT = 90;

/**
 * Edge definitions between transform nodes. Each edge carries an optional
 * `label` describing the data that flows along it. Stream → unit_conversion
 * edges are generated at runtime from the registered stream list.
 */
export interface AnatomyEdgeDef {
  id: string;
  source: StepKey | "output";
  target: StepKey | "output";
  label?: string;
}

export const PIPELINE_EDGES: AnatomyEdgeDef[] = [
  { id: "e-uc-dp", source: "unit_conversion", target: "decay_profile", label: "calc totals" },
  { id: "e-dp-tfv", source: "decay_profile", target: "temporal_fair_value", label: "decayed blocks" },
  // The fork: temporal_fair_value feeds BOTH aggregation (fair) AND variance (var).
  { id: "e-tfv-agg", source: "temporal_fair_value", target: "aggregation", label: "fair" },
  { id: "e-tfv-var", source: "temporal_fair_value", target: "variance" },
  { id: "e-var-agg", source: "variance", target: "aggregation", label: "var" },
  { id: "e-agg-ctt", source: "aggregation", target: "calc_to_target", label: "calc-space totals" },
  { id: "e-ctt-smooth", source: "calc_to_target", target: "smoothing", label: "target-space edge + var" },
  { id: "e-smooth-ps", source: "smoothing", target: "position_sizing", label: "smoothed" },
  { id: "e-ps-output", source: "position_sizing", target: "output", label: "desired position" },
];
