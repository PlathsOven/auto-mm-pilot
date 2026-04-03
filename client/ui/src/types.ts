/** Page routing for the main App shell */
export type AppPage = "dashboard" | "apidocs";

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

/** Engine operating mode */
export type EngineState =
  | "WAITING"
  | "INITIALIZING"
  | "STABILIZING"
  | "OPTIMIZING"
  | "DISRUPTED";

/** Global context bar state */
export interface GlobalContext {
  engineState: EngineState;
  operatingSpace: string;
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
  role: "user" | "assistant" | "team";
  sender: string;
  content: string;
  timestamp: number;
}

/** Identity of the logged-in terminal user */
export interface UserIdentity {
  id: string;
  name: string;
  initials: string;
  role: string;
}

/** A comment/note on a specific cell */
export interface CellNote {
  id: string;
  cellKey: string;
  author: string;
  authorInitials: string;
  content: string;
  timestamp: number;
}

/** Daily trading wrap summary data */
export interface DailyWrapData {
  generatedAt: number;
  largestPositionChanges: WrapPositionEntry[];
  largestDesiredChanges: WrapPositionEntry[];
  currentRisks: string[];
  bestCaseScenarios: WrapScenario[];
  worstCaseScenarios: WrapScenario[];
}

export interface WrapPositionEntry {
  asset: string;
  expiry: string;
  delta: number;
  driver: string;
}

export interface WrapScenario {
  description: string;
  trigger: string;
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
