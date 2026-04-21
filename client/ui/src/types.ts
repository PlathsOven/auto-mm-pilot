/** Status of an individual data stream adapter */
export type StreamStatus = "ONLINE" | "DEGRADED" | "OFFLINE";

/** A single data stream / adapter entry.
 *
 *  `active` mirrors the registry toggle — inactive streams are still emitted
 *  on the WS payload (so the UI can render and reactivate them) but their
 *  blocks don't appear in the pipeline output for this tick.
 */
export interface DataStream {
  id: string;
  name: string;
  status: StreamStatus;
  lastHeartbeat: number;
  active: boolean;
}

/** Status of a registered stream in the server registry */
export type RegisteredStreamStatus = "PENDING" | "READY";

/** Block config as returned by the server API */
export interface BlockConfigPayload {
  annualized: boolean;
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
  active: boolean;
  scale: number | null;
  offset: number | null;
  exponent: number | null;
  block: BlockConfigPayload | null;
  description: string | null;
  sample_csv: string | null;
  value_column: string | null;
}

/** Global context bar state */
export interface GlobalContext {
  lastUpdateTimestamp: number;
}

/** A single row in the desired-position table (mirrors pipeline output).
 *
 *  The `*Vol` fields are the same scalars expressed in annualised vol
 *  points (sign-preserving sqrt of ``sum_forward_grid / T_years``) — what
 *  options traders actually read. The raw variance-unit fields are kept
 *  for math-facing surfaces (LiveEquationStrip, pipeline chart).
 */
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
  smoothedTotalFair: number;
  totalMarketFair: number;
  smoothedTotalMarketFair: number;
  edgeVol: number;
  smoothedEdgeVol: number;
  varianceVol: number;
  smoothedVarVol: number;
  totalFairVol: number;
  smoothedTotalFairVol: number;
  totalMarketFairVol: number;
  smoothedTotalMarketFairVol: number;
  marketVol: number;
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

/** One unregistered-stream push attempt captured by the server.
 *
 *  Surfaced on the WS tick payload and via GET /api/notifications/unregistered.
 *  Rendered in the Notifications center with a "Register this stream" CTA
 *  that deep-links into Anatomy with the form pre-filled.
 */
export interface UnregisteredPushAttempt {
  streamName: string;
  exampleRow: Record<string, unknown>;
  attemptCount: number;
  firstSeen: string;  // ISO 8601 UTC
  lastSeen: string;   // ISO 8601 UTC
}

/** A READY stream whose recent snapshots carried no `market_value`.
 *
 *  When the feeder only sends `raw_value`, the pipeline defaults
 *  market-implied value to match fair — edge collapses to zero and every
 *  desired position reads zero. This alert tells the trader why. Surfaced
 *  on the WS tick payload and via GET /api/notifications/silent-streams.
 */
export interface SilentStreamAlert {
  streamName: string;
  rowsSeen: number;
  firstSeen: string;  // ISO 8601 UTC
  lastSeen: string;   // ISO 8601 UTC
}

/** Per-(symbol, expiry) alert when per-block market values don't reconcile
 *  to the user's aggregate marketVol.
 *
 *  The market-value-inference step should make `totalMarketFairVol` equal
 *  `marketVol` by construction; a visible gap means either (a) the user
 *  overrode per-block values past what the inferred blocks can absorb,
 *  (b) no inferred blocks have forward coverage, or (c) no aggregate was
 *  set but per-block values are non-zero. All three fields are in vol
 *  points — the same units the CellInspector renders. */
export interface MarketValueMismatchAlert {
  symbol: string;
  expiry: string;
  aggregateVol: number;
  impliedVol: number;
  diff: number;
}

/** Top-level payload received over WebSocket */
export interface ServerPayload {
  streams: DataStream[];
  context: GlobalContext;
  positions: DesiredPosition[];
  updates: UpdateCard[];
  unregisteredPushes?: UnregisteredPushAttempt[];
  silentStreams?: SilentStreamAlert[];
  marketValueMismatches?: MarketValueMismatchAlert[];
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

// ---------------------------------------------------------------------------
// Position grid — view modes + timeframes
// ---------------------------------------------------------------------------

export type ViewMode =
  | "position"
  | "rawPosition"
  | "edge"
  | "smoothedEdge"
  | "variance"
  | "smoothedVar"
  | "fair"
  | "smoothedFair"
  | "marketSource"
  | "marketCalculated"
  | "smoothedMarketCalculated";

export interface ViewModeMeta {
  label: string;
  unit: string;
  decimals: number;
  /** Whether the value carries a meaningful sign. Fair / Market / Variance
   *  are non-negative by construction, so the grid suppresses the "+"
   *  prefix on them to avoid implying a signed quantity. */
  signed: boolean;
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
 * Composite identity for a block row.
 *
 * `block_name` alone isn't unique — the same name (e.g. `ema_iv`) is reused
 * across every symbol/expiry/stream it's attached to. Every surface that
 * focuses, highlights, or inspects a single block must compare on the full
 * composite so two rows with the same `block_name` on different dimensions
 * stay distinguishable.
 */
export interface BlockKey {
  blockName: string;
  streamName: string;
  symbol: string;
  expiry: string;
  /** ISO timestamp or null — null means "shifting" or no start set. */
  startTimestamp: string | null;
}

/**
 * Discriminated union of every focusable entity in the workbench.
 *
 * - `cell` — a single (symbol, expiry) cell from the desired-position grid.
 * - `symbol` — an entire symbol row.
 * - `expiry` — an entire expiry column.
 * - `stream` — a registered data stream.
 * - `block` — a single block identified by its full composite key.
 */
export type Focus =
  | { kind: "cell"; symbol: string; expiry: string }
  | { kind: "symbol"; symbol: string }
  | { kind: "expiry"; expiry: string }
  | { kind: "stream"; name: string }
  | { kind: "block"; key: BlockKey };

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
  streamName: string;
  spaceId: string;
  startTimestamp: string | null;
  timestamps: string[];
  fair: (number | null)[];
  var: (number | null)[];
}

/** Aggregated time series across all blocks */
export interface AggregatedTimeSeries {
  timestamps: string[];
  totalFair: number[];
  smoothedTotalFair: number[];
  totalMarketFair: number[];
  smoothedTotalMarketFair: number[];
  edge: number[];
  smoothedEdge: number[];
  var: number[];
  smoothedVar: number[];
  rawDesiredPosition: number[];
  smoothedDesiredPosition: number[];
  /** User-entered aggregate market vol (vol points). Step-function over time,
   *  constant across a projection window — mirrors the grid's Market tab. */
  marketVol: number[];
}

/** Current decomposition snapshot for the latest timestamp */
export interface CurrentBlockDecomposition {
  blockName: string;
  streamName: string;
  spaceId: string;
  startTimestamp: string | null;
  fair: number;
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
  temporal_position: "static" | "shifting";
  decay_end_size_mult: number;
  decay_rate_prop_per_min: number;
  var_fair_ratio: number;
  scale: number;
  offset: number;
  exponent: number;
  /** (symbol, expiry) pairs this block fans out to. null / missing means
   *  every pair in the dim universe (default behaviour). */
  applies_to?: [string, string][] | null;
  // Output values
  raw_value: number;
  fair: number | null;
  var: number | null;
  market_value_source?: "block" | "aggregate" | "passthrough" | null;
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
