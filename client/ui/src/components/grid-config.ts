import type { DesiredPosition } from "../types";

export type ViewMode =
  | "position"
  | "rawPosition"
  | "change"
  | "edge"
  | "smoothedEdge"
  | "variance"
  | "smoothedVar"
  | "totalFair"
  | "totalMarketFair";

export type ViewModeGroup = "primary" | "secondary";

export interface ViewModeMeta {
  label: string;
  unit: string;
  decimals: number;
  group: ViewModeGroup;
}

export const VIEW_MODE_META: Record<ViewMode, ViewModeMeta> = {
  position: { label: "Position", unit: "$vega", decimals: 2, group: "primary" },
  change: { label: "Change", unit: "$vega", decimals: 2, group: "primary" },
  edge: { label: "Edge", unit: "vp", decimals: 2, group: "primary" },
  variance: { label: "Variance", unit: "vp", decimals: 2, group: "primary" },
  rawPosition: { label: "Raw Position", unit: "$vega", decimals: 2, group: "secondary" },
  smoothedEdge: { label: "Smoothed Edge", unit: "vp", decimals: 2, group: "secondary" },
  smoothedVar: { label: "Smoothed Variance", unit: "vp", decimals: 2, group: "secondary" },
  totalFair: { label: "Total Fair", unit: "vp", decimals: 2, group: "secondary" },
  totalMarketFair: { label: "Market Fair", unit: "vp", decimals: 2, group: "secondary" },
};

export const PRIMARY_VIEW_MODES: ViewMode[] = ["position", "change", "edge", "variance"];
export const SECONDARY_VIEW_MODES: ViewMode[] = [
  "rawPosition",
  "smoothedEdge",
  "smoothedVar",
  "totalFair",
  "totalMarketFair",
];

export const TIMEFRAME_OPTIONS = [
  { label: "Latest", ms: 0 },
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 300_000 },
  { label: "15 min", ms: 900_000 },
] as const;
export type TimeframeLabel = (typeof TIMEFRAME_OPTIONS)[number]["label"];

export const HIGHLIGHT_DURATION_MS = 2000;

export function getCellValue(p: DesiredPosition, mode: ViewMode, change: number): number {
  switch (mode) {
    case "position": return p.desiredPos;
    case "rawPosition": return p.rawDesiredPos;
    case "change": return change;
    case "edge": return p.edgeVol;
    case "smoothedEdge": return p.smoothedEdgeVol;
    case "variance": return p.varianceVol;
    case "smoothedVar": return p.smoothedVarVol;
    case "totalFair": return p.totalFairVol;
    case "totalMarketFair": return p.totalMarketFairVol;
  }
}
