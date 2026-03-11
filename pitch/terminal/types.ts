/** Status of an individual data stream adapter */
export type StreamStatus = "ONLINE" | "DEGRADED" | "OFFLINE";

/** A single data stream / adapter entry */
export interface DataStream {
  id: string;
  name: string;
  status: StreamStatus;
  lastHeartbeat: number;
}

/** Engine operating mode */
export type EngineState =
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

/** A single row in the desired-position table */
export interface DesiredPosition {
  asset: string;
  expiry: string;
  edge: number;
  uncertaintyFactor: number;
  desiredPos: number;
  currentPos: number;
  marketIV: number;
  fairIV: number;
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
