import type {
  UserIdentity,
  DailyWrapData,
} from "../types";

/** Mock team members for the client firm */
export const MOCK_USERS: UserIdentity[] = [
  { id: "user-1", name: "Sjoerd Stevens", initials: "SS", role: "Head of Desk" },
  { id: "user-2", name: "Sean Gong", initials: "SG", role: "Senior Trader" },
  { id: "user-3", name: "James Okafor", initials: "JO", role: "Quant Analyst" },
  { id: "user-4", name: "Sarah Lin", initials: "SL", role: "Risk Manager" },
];

/** The currently logged-in user */
export const CURRENT_USER: UserIdentity = MOCK_USERS[0];

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function round(n: number, d: number): number {
  return +n.toFixed(d);
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
