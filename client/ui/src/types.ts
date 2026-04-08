/** Status of an individual data stream adapter */
export type StreamStatus = "ONLINE" | "DEGRADED" | "OFFLINE";

/** A single data stream / adapter entry */
export interface DataStream {
  id: string;
  name: string;
  status: StreamStatus;
  lastHeartbeat: number;
}

/** Status of a registered stream in the server registry */
export type RegisteredStreamStatus = "PENDING" | "READY";

/** Block config as returned by the server API */
export interface BlockConfigPayload {
  annualized: boolean;
  size_type: "fixed" | "relative";
  aggregation_logic: "average" | "offset";
  temporal_position: "static" | "shifting";
  decay_end_size_mult: number;
  decay_rate_prop_per_min: number;
  decay_profile: "linear";
  var_fair_ratio: number;
}

/** A stream registered via the stream management API */
export interface RegisteredStream {
  stream_name: string;
  key_cols: string[];
  status: RegisteredStreamStatus;
  scale: number | null;
  offset: number | null;
  exponent: number | null;
  block: BlockConfigPayload | null;
}

/** Global context bar state */
export interface GlobalContext {
  lastUpdateTimestamp: number;
}

/** A single row in the desired-position table (mirrors pipeline output) */
export interface DesiredPosition {
  asset: string;
  expiry: string;
  edge: number;
  smoothedEdge: number;
  variance: number;
  smoothedVar: number;
  desiredPos: number;
  rawDesiredPos: number;
  currentPos: number;
  totalFair: number;
  totalMarketFair: number;
  changeMagnitude: number;
  updatedAt: number;
}

/** A position-change update card */
export interface UpdateCard {
  id: string;
  asset: string;
  expiry: string;
  oldPos: number;
  newPos: number;
  delta: number;
  reason: string;
  timestamp: number;
}

/** Top-level payload received over WebSocket */
export interface ServerPayload {
  streams: DataStream[];
  context: GlobalContext;
  positions: DesiredPosition[];
  updates: UpdateCard[];
}

/** Context pushed to the LLM chat when a card or cell is clicked */
export type InvestigationContext =
  | { type: "update"; card: UpdateCard }
  | { type: "position"; asset: string; expiry: string; position: DesiredPosition };

/** A single message in the LLM chat */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// API request / response types
// ---------------------------------------------------------------------------

/** POST /api/investigate — request payload */
export interface InvestigatePayload {
  conversation: { role: string; content: string }[];
  cell_context?: Record<string, unknown> | null;
}

/** POST /api/justify — request payload */
export interface JustifyPayload {
  asset: string;
  expiry: string;
  old_pos: number;
  new_pos: number;
  delta: number;
}

/** POST /api/justify — response */
export interface JustifyResponse {
  justification: string;
}

/** POST /api/snapshots — response */
export interface SnapshotResponse {
  stream_name: string;
  rows_accepted: number;
  pipeline_rerun: boolean;
}

/** POST /api/market-pricing — response */
export interface MarketPricingResponse {
  spaces_updated: number;
  pipeline_rerun: boolean;
}

/** PATCH /api/config/bankroll — response */
export interface BankrollResponse {
  bankroll: number;
  pipeline_rerun: boolean;
}

// ---------------------------------------------------------------------------
// Pipeline time series (charting)
// ---------------------------------------------------------------------------

/** A single symbol/expiry dimension from the pipeline */
export interface TimeSeriesDimension {
  symbol: string;
  expiry: string;
}

/** Block-level time series for one block */
export interface BlockTimeSeries {
  block_name: string;
  space_id: string;
  aggregation_logic: string;
  timestamps: string[];
  fair: number[];
  market_fair: number[];
  var: number[];
}

/** Aggregated time series across all blocks */
export interface AggregatedTimeSeries {
  timestamps: string[];
  total_fair: number[];
  total_market_fair: number[];
  edge: number[];
  smoothed_edge: number[];
  var: number[];
  smoothed_var: number[];
  raw_desired_position: number[];
  smoothed_desired_position: number[];
}

/** Current decomposition snapshot for the latest timestamp */
export interface CurrentBlockDecomposition {
  block_name: string;
  space_id: string;
  fair: number;
  market_fair: number;
  var: number;
}

/** A single row in the block configuration table */
export interface BlockRow {
  block_name: string;
  stream_name: string;
  symbol: string;
  expiry: string;
  space_id: string;
  source: "stream" | "manual";
  // Engine parameters
  annualized: boolean;
  size_type: "fixed" | "relative";
  aggregation_logic: "average" | "offset";
  temporal_position: "static" | "shifting";
  decay_end_size_mult: number;
  decay_rate_prop_per_min: number;
  var_fair_ratio: number;
  scale: number;
  offset: number;
  exponent: number;
  // Output values
  target_value: number;
  raw_value: number;
  market_value: number | null;
  target_market_value: number | null;
  fair: number | null;
  market_fair: number | null;
  var: number | null;
  // Timing
  start_timestamp: string | null;
  updated_at: string | null;
}

/** Full pipeline time series response */
export interface PipelineTimeSeriesResponse {
  symbol: string;
  expiry: string;
  blocks: BlockTimeSeries[];
  aggregated: AggregatedTimeSeries;
  current_decomposition: {
    blocks: CurrentBlockDecomposition[];
    aggregated: Record<string, number>;
  };
}

// ---------------------------------------------------------------------------
// Transform configuration
// ---------------------------------------------------------------------------

export interface TransformParam {
  name: string;
  type: "float" | "int" | "bool" | "str";
  default: unknown;
  description: string;
  min: number | null;
  max: number | null;
  options: string[] | null;
}

export interface TransformInfo {
  name: string;
  description: string;
  params: TransformParam[];
  /** Optional symbolic form, e.g. "P = E·B / (γ·V)". Empty string if unset. */
  formula: string;
}

export interface TransformStep {
  label: string;
  contract: string;
  selected: string;
  params: Record<string, unknown>;
  transforms: TransformInfo[];
}

export interface TransformListResponse {
  steps: Record<string, TransformStep>;
}
