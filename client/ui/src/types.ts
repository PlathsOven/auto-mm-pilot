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
  symbol: string;
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
  symbol: string;
  expiry: string;
  oldPos: number;
  newPos: number;
  delta: number;
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
  | { type: "position"; symbol: string; expiry: string; position: DesiredPosition };

/** A single message in the LLM chat */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

/** Parsed engine command from LLM response */
export interface EngineCommand {
  action: "create_manual_block" | "create_stream";
  params: Record<string, unknown>;
}

/** Pending manual-block command awaiting user review in the BlockDrawer */
export interface PendingBlockCommand {
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stream time-series (per-key snapshot history)
// ---------------------------------------------------------------------------

/** One point in a stream-key time series. */
export interface StreamTimeseriesPoint {
  timestamp: string;
  raw_value: number;
  market_value: number | null;
}

/** Time series for one unique key-column combination within a stream. */
export interface StreamKeyTimeseries {
  key: Record<string, string>;
  points: StreamTimeseriesPoint[];
}

/** GET /api/streams/{name}/timeseries response. */
export interface StreamTimeseriesResponse {
  stream_name: string;
  key_cols: string[];
  status: "PENDING" | "READY";
  row_count: number;
  series: StreamKeyTimeseries[];
}

// ---------------------------------------------------------------------------
// Workbench focus — drives Inspector + channelled panels
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every focusable entity in the workbench.
 *
 * - `cell` — a single (symbol, expiry) cell from the desired-position grid.
 * - `symbol` — an entire symbol row.
 * - `expiry` — an entire expiry column.
 * - `stream` — a registered data stream.
 * - `block` — a single block by name.
 */
export type Focus =
  | { kind: "cell"; symbol: string; expiry: string }
  | { kind: "symbol"; symbol: string }
  | { kind: "expiry"; expiry: string }
  | { kind: "stream"; name: string }
  | { kind: "block"; name: string };

// ---------------------------------------------------------------------------
// API request / response types
// ---------------------------------------------------------------------------

/** Chat mode — controls which prompt modules the server uses */
export type ChatMode = "investigate" | "build" | "general";

/** POST /api/investigate — request payload (mirrors ``InvestigateRequest`` in server/api/models.py). */
export interface InvestigateRequest {
  conversation: { role: string; content: string }[];
  cell_context?: InvestigationContext | null;
  mode: ChatMode;
}

/** POST /api/snapshots — response */
export interface SnapshotResponse {
  stream_name: string;
  rows_accepted: number;
  pipeline_rerun: boolean;
}

/** PATCH /api/config/bankroll — response */
export interface BankrollResponse {
  bankroll: number;
  pipeline_rerun: boolean;
}

// ---------------------------------------------------------------------------
// Aggregate market values
// ---------------------------------------------------------------------------

export interface MarketValueEntry {
  symbol: string;
  expiry: string;
  total_vol: number;
}

export interface MarketValueListResponse {
  entries: MarketValueEntry[];
}

// ---------------------------------------------------------------------------
// Pipeline time series (charting)
// ---------------------------------------------------------------------------

/** A single symbol/expiry dimension from the pipeline */
export interface TimeSeriesDimension {
  symbol: string;
  expiry: string;
}

/** Block-level time series for one block — pivoted onto the shared
 *  `blockTimestamps` axis at the response level. `null` entries mark ticks
 *  where this particular block doesn't have data (different blocks can
 *  have different start_timestamps). */
export interface BlockTimeSeries {
  blockName: string;
  spaceId: string;
  aggregationLogic: string;
  timestamps: string[];
  fair: (number | null)[];
  marketFair: (number | null)[];
  var: (number | null)[];
}

/** Aggregated time series across all blocks */
export interface AggregatedTimeSeries {
  timestamps: string[];
  totalFair: number[];
  totalMarketFair: number[];
  edge: number[];
  smoothedEdge: number[];
  var: number[];
  smoothedVar: number[];
  rawDesiredPosition: number[];
  smoothedDesiredPosition: number[];
}

/** Current decomposition snapshot for the latest timestamp */
export interface CurrentBlockDecomposition {
  blockName: string;
  spaceId: string;
  fair: number;
  marketFair: number;
  var: number;
}

/** Aggregated decomposition snapshot at the current tick timestamp */
export interface CurrentAggregatedDecomposition {
  totalFair: number;
  totalMarketFair: number;
  edge: number;
  smoothedEdge: number;
  var: number;
  smoothedVar: number;
  rawDesiredPosition: number;
  smoothedDesiredPosition: number;
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

/** Full pipeline time series response.
 *
 *  `aggregated.timestamps` is the historical position axis (used by the
 *  Position view); `blockTimestamps` is the forward-looking axis spanning
 *  current_ts → expiry (used by the Fair / Variance views).
 */
export interface PipelineTimeSeriesResponse {
  symbol: string;
  expiry: string;
  blocks: BlockTimeSeries[];
  blockTimestamps: string[];
  aggregated: AggregatedTimeSeries;
  currentDecomposition: {
    blocks: CurrentBlockDecomposition[];
    aggregated: CurrentAggregatedDecomposition | null;
    aggregateMarketValue?: { totalVol: number } | null;
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

// ---------------------------------------------------------------------------
// Client → server WebSocket frames (/ws/client)
// ---------------------------------------------------------------------------

/** Row of a snapshot-frame payload (mirrors ``SnapshotRow`` in server/api/models.py). */
export interface SnapshotRow {
  timestamp: string;
  raw_value: number;
  market_value?: number | null;
  // Extra key_cols permitted per stream config
  [key: string]: unknown;
}

/** Inbound snapshot frame sent by the client over /ws/client. */
export interface ClientWsInboundFrame {
  seq: number;
  stream_name: string;
  rows: SnapshotRow[];
}

/** Inbound market-value frame sent by the client over /ws/client. */
export interface ClientWsMarketValueFrame {
  type: "market_value";
  seq: number;
  entries: MarketValueEntry[];
}

/** ACK sent by the server in response to every inbound frame. */
export interface ClientWsAck {
  type: "ack";
  seq: number;
  rows_accepted: number;
  pipeline_rerun: boolean;
}

/** Error sent by the server when an inbound frame fails validation/processing. */
export interface ClientWsError {
  type: "error";
  seq: number | null;
  detail: string;
}

/** Discriminated union of every outbound frame on /ws/client. */
export type ClientWsOutboundFrame = ClientWsAck | ClientWsError;

// ---------------------------------------------------------------------------
// Multi-user auth + account + admin (mirror of server/api/models.py)
// ---------------------------------------------------------------------------

export interface UserPublic {
  id: string;
  username: string;
  created_at: string;
  is_admin: boolean;
}

export interface SignupRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  session_token: string;
  user: UserPublic;
}

export interface ApiKeyResponse {
  api_key: string;
}

export type UsageEventType =
  | "panel_open"
  | "panel_close"
  | "manual_block_create"
  | "cell_click"
  | "app_focus"
  | "app_blur";

export interface UsageEventRequest {
  type: UsageEventType;
  metadata?: Record<string, string | number | boolean>;
}

export interface AdminUserSummary {
  id: string;
  username: string;
  created_at: string;
  last_login_at: string | null;
  active_ws_connections: number;
  manual_block_count: number;
  total_sessions: number;
  total_time_seconds: number;
}

export interface AdminUserListResponse {
  users: AdminUserSummary[];
}
