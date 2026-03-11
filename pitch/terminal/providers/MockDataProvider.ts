import type {
  ServerPayload,
  DataStream,
  GlobalContext,
  DesiredPosition,
  UpdateCard,
  EngineState,
  StreamStatus,
  UserIdentity,
  CellNote,
  DailyWrapData,
} from "../types";

const ASSETS = ["BTC", "ETH"];
const EXPIRIES = ["27MAR26", "25APR26", "30MAY26", "27JUN26"];
const ENGINE_STATES: EngineState[] = ["STABILIZING", "OPTIMIZING"];

/** Backend-only config: bankroll multiplier for desiredPos = (edge / uncertaintyFactor) * BANKROLL */
const BANKROLL = 50_000;

/** Probability that any given position updates on a single tick */
const CHANGE_PROBABILITY = 0.10;

/** Minimum |cumulative delta| in $vega before an update card is emitted for a given position */
const UPDATE_THRESHOLD_VEGA = 400;

/**
 * Justification reasons aligned with investigation.py §5 Reasoning Protocol
 * and §6 Language Rules — long/short for direction, more/less for magnitude.
 */
const REASONS = [
  "Realized vol up. Fair value up, market implied hasn't moved as much. Edge more positive — more long.",
  "Realized vol down over last 12h. Fair value down, market implied down less. Edge less positive — less long.",
  "FOMC event passed. Fair value down as vol bump decays. Market implied getting offered but slower. Edge less positive — less long.",
  "CPI release approaching. Fair value up on event bump. Market implied getting bid but not as fast. Edge more positive — more long.",
  "Implied vol getting bid into earnings. Fair value also up, but market implied got bid higher. Edge less positive — less long.",
  "Implied vol getting offered near expiry. Fair value also down, but market implied dropped more. Edge more positive — more long.",
  "Historical IV at 10th percentile. Fair value above market implied. Edge positive — long.",
  "Historical IV at 90th percentile. Fair value below market implied. Edge negative — short.",
  "More long BTC; less long ETH to keep net correlated exposure the same.",
  "Less long ETH; more long BTC near-dated to rebalance correlation.",
  "Correlation between BTC and ETH increasing; adjusting to stay flat.",
  "Scheduled event vol bump added for protocol upgrade. Fair value up, market implied flat. Edge more positive — more long.",
  "Near-dated realized vol diverging from far-dated. Fair value up near-dated, market implied flat. More long near-dated, less long far-dated.",
  "New expiry listed, vol getting bid. Fair value up more than market implied. Edge positive — long.",
  "Uncertainty increasing — conflicting signals from realized vol and vol flow streams. Variance up — less long.",
  "Realized vol stream stable. Fair value unchanged, market implied unchanged. No edge change — position unchanged.",
];
const STREAM_NAMES = [
  "KDB_CLIENT_PROD",
  "SQL_LOCAL_BTC",
  "REST_DERIBIT_V2",
  "WS_BINANCE_OPTS",
  "FIX_CME_GATEWAY",
];

/** Mock team members for the client firm */
export const MOCK_USERS: UserIdentity[] = [
  { id: "user-1", name: "Sjoerd Stevens", initials: "SS", role: "Head of Desk" },
  { id: "user-2", name: "Sean Gong", initials: "SG", role: "Senior Trader" },
  { id: "user-3", name: "James Okafor", initials: "JO", role: "Quant Analyst" },
  { id: "user-4", name: "Sarah Lin", initials: "SL", role: "Risk Manager" },
];

/** The currently logged-in user */
export const CURRENT_USER: UserIdentity = MOCK_USERS[0];

/** Pre-seeded cell notes from various team members */
const SEED_NOTES: CellNote[] = [
  { id: "note-1", cellKey: "BTC-27MAR26", author: "Sean Gong", authorInitials: "SG", content: "Watch for expiry pin risk — OI concentrated around 85k strike.", timestamp: Date.now() - 3_600_000 },
  { id: "note-2", cellKey: "ETH-25APR26", author: "James Okafor", authorInitials: "JO", content: "Pectra upgrade catalyst could drive vol expansion mid-April.", timestamp: Date.now() - 7_200_000 },
  { id: "note-3", cellKey: "BTC-30MAY26", author: "Sarah Lin", authorInitials: "SL", content: "Comfortable with current sizing — risk limits have headroom.", timestamp: Date.now() - 1_800_000 },
  { id: "note-4", cellKey: "ETH-27JUN26", author: "Sjoerd Stevens", authorInitials: "SS", content: "Back-month looks cheap relative to realized. Keep building.", timestamp: Date.now() - 5_400_000 },
  { id: "note-5", cellKey: "BTC-25APR26", author: "Sean Gong", authorInitials: "SG", content: "FOMC on Apr 30 could bleed into this expiry — stay nimble.", timestamp: Date.now() - 2_400_000 },
];

/** Mutable cell notes store */
let cellNotesStore: CellNote[] = [...SEED_NOTES];
let noteCounter = SEED_NOTES.length;

export function getCellNotes(): CellNote[] {
  return cellNotesStore;
}

export function addCellNote(cellKey: string, content: string): CellNote {
  noteCounter++;
  const note: CellNote = {
    id: `note-${noteCounter}`,
    cellKey,
    author: CURRENT_USER.name,
    authorInitials: CURRENT_USER.initials,
    content,
    timestamp: Date.now(),
  };
  cellNotesStore = [note, ...cellNotesStore];
  return note;
}

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function round(n: number, d: number): number {
  return +n.toFixed(d);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Stable stream state — statuses only shift occasionally */
let streamState: DataStream[] | null = null;

function generateStreams(): DataStream[] {
  if (!streamState) {
    streamState = STREAM_NAMES.map((name, i) => ({
      id: `stream-${i}`,
      name,
      status: "ONLINE" as StreamStatus,
      lastHeartbeat: Date.now(),
    }));
  }
  for (const s of streamState) {
    s.lastHeartbeat = Date.now() - Math.floor(Math.random() * 1500);
    if (Math.random() < 0.03) {
      const statuses: StreamStatus[] = ["ONLINE", "ONLINE", "ONLINE", "DEGRADED", "OFFLINE"];
      s.status = pickRandom(statuses);
    }
  }
  return streamState.map((s) => ({ ...s }));
}

function generateContext(): GlobalContext {
  return {
    engineState: pickRandom(ENGINE_STATES),
    operatingSpace: "D50 VOLATILITY",
    lastUpdateTimestamp: Date.now(),
  };
}

function deriveDesiredPos(edge: number, uf: number): number {
  return round((edge / uf) * BANKROLL, 2);
}

/** Persistent position state across mock ticks */
let positionState: Map<string, DesiredPosition> | null = null;

function initPositionState(): Map<string, DesiredPosition> {
  const state = new Map<string, DesiredPosition>();
  for (const asset of ASSETS) {
    for (const expiry of EXPIRIES) {
      const key = `${asset}-${expiry}`;
      const edge = round(rand(-0.5, 0.5), 4);
      const uf = round(rand(0.8, 2.5), 4);
      const desiredPos = deriveDesiredPos(edge, uf);
      const currentPos = round(desiredPos * rand(0.4, 1.2), 2);
      const marketIV = round(rand(30, 90), 2);
      const fairIV = round(marketIV + rand(-5, 5), 2);
      state.set(key, {
        asset,
        expiry,
        edge,
        uncertaintyFactor: uf,
        desiredPos,
        currentPos,
        marketIV,
        fairIV,
        changeMagnitude: 0,
        updatedAt: Date.now(),
      });
    }
  }
  return state;
}

let updateCounter = 0;

/** Tracks the last emitted desiredPos per key to accumulate deltas */
let lastEmittedPos: Map<string, number> | null = null;

function generateOffsetUpdate(): {
  positions: DesiredPosition[];
  updates: UpdateCard[];
} {
  if (!positionState) {
    positionState = initPositionState();
  }

  if (!lastEmittedPos) {
    lastEmittedPos = new Map();
    for (const [k, p] of positionState) lastEmittedPos.set(k, p.desiredPos);
  }

  const updates: UpdateCard[] = [];
  const now = Date.now();

  for (const [key, pos] of positionState) {
    if (Math.random() > CHANGE_PROBABILITY) continue;

    const edgeOffset = round(rand(-0.01, 0.01), 4);
    const newEdge = round(pos.edge + edgeOffset, 4);
    const newUf = round(Math.max(0.3, pos.uncertaintyFactor + rand(-0.002, 0.002)), 4);
    const newPos = deriveDesiredPos(newEdge, newUf);
    const changeMag = round(newPos - pos.desiredPos, 2);
    const newCurrentPos = round(pos.currentPos + (newPos - pos.currentPos) * rand(0.01, 0.08), 2);
    const newMarketIV = round(pos.marketIV + rand(-0.3, 0.3), 2);
    const newFairIV = round(pos.fairIV + rand(-0.2, 0.2), 2);

    positionState.set(key, {
      ...pos,
      edge: newEdge,
      uncertaintyFactor: newUf,
      desiredPos: newPos,
      currentPos: newCurrentPos,
      marketIV: newMarketIV,
      fairIV: newFairIV,
      changeMagnitude: changeMag,
      updatedAt: now,
    });

    const emittedPos = lastEmittedPos.get(key) ?? pos.desiredPos;
    const cumulativeDelta = Math.abs(newPos - emittedPos);
    if (cumulativeDelta >= UPDATE_THRESHOLD_VEGA) {
      updateCounter++;
      updates.push({
        id: `update-${updateCounter}`,
        asset: pos.asset,
        expiry: pos.expiry,
        oldPos: emittedPos,
        newPos,
        delta: round(newPos - emittedPos, 2),
        reason: pickRandom(REASONS),
        timestamp: now,
      });
      lastEmittedPos.set(key, newPos);
    }
  }

  return {
    positions: Array.from(positionState.values()),
    updates,
  };
}

export function generateMockPayload(): ServerPayload {
  const { positions, updates } = generateOffsetUpdate();
  return {
    streams: generateStreams(),
    context: generateContext(),
    positions,
    updates,
  };
}

/** Static daily wrap — generated once per session */
let cachedDailyWrap: DailyWrapData | null = null;

export function generateDailyWrap(): DailyWrapData {
  if (cachedDailyWrap) return cachedDailyWrap;

  cachedDailyWrap = {
    generatedAt: Date.now(),
    largestPositionChanges: [
      { asset: "BTC", expiry: "27MAR26", delta: round(rand(2000, 8000), 0), driver: "FOMC event passed. Fair value down as vol bump decays. Market implied getting offered but slower. Edge less positive — less long." },
      { asset: "ETH", expiry: "25APR26", delta: round(rand(-6000, -1500), 0), driver: "Realized vol down over last 12h. Fair value down, market implied down less. Edge more negative — more short." },
      { asset: "BTC", expiry: "30MAY26", delta: round(rand(1000, 4000), 0), driver: "Realized vol stream up. Fair value for BTC 30MAY up. Market implied hasn't moved as much. Edge more positive — more long." },
    ],
    largestDesiredChanges: [
      { asset: "ETH", expiry: "27JUN26", delta: round(rand(5000, 12000), 0), driver: "Historical IV at 12th percentile. Fair value above market implied. Edge positive — long." },
      { asset: "BTC", expiry: "25APR26", delta: round(rand(-10000, -3000), 0), driver: "Realized vol up, but market implied got bid even higher. Edge less positive despite higher fair value — less long." },
      { asset: "ETH", expiry: "27MAR26", delta: round(rand(2000, 7000), 0), driver: "Implied vol getting bid into Pectra upgrade. Fair value up faster than market implied. Edge more positive — more long." },
    ],
    currentRisks: [
      "Concentrated BTC near-dated long vega ($" + round(rand(15000, 35000), 0) + ") with 22 days to expiry.",
      "Correlation between BTC and ETH at session highs — if BTC goes more long, ETH rebalancing will be large.",
      "Back-month desired positions diverging from current fills — execution lag creating unhedged drift.",
      "Realized vol stream flat for 6h but market implied getting offered. Edge looks more positive but based on stale fair value — may be unreliable.",
    ],
    bestCaseScenarios: [
      { description: "BTC near-dated long positions profit +$" + round(rand(20000, 60000), 0) + " as realized vol exceeds market implied.", trigger: "Realized vol increases, fair value rises faster than market implied. Edge more positive — long positions profit." },
      { description: "ETH back-month edge widens by " + round(rand(1, 4), 1) + "vp as fair value moves above market implied.", trigger: "Realized vol consistently above market expectations over 2–4 weeks. Fair value up while market implied lags — edge more positive, more long." },
    ],
    worstCaseScenarios: [
      { description: "BTC near-dated long positions draw down −$" + round(rand(15000, 40000), 0) + " as market implied gets offered into expiry.", trigger: "Realized vol drops. Fair value down but market implied down faster — edge looks more positive but we're long into a vol crush." },
      { description: "Correlation spike forces simultaneous loss across all expiries.", trigger: "Systemic event drives correlated repricing. All market implieds move together — correlation assumptions break down, rebalancing can't keep up." },
    ],
  };

  return cachedDailyWrap;
}
