import type { DesiredPosition } from "../types";

export type ViewMode = "position" | "rawPosition" | "change" | "edge" | "smoothedEdge" | "variance" | "smoothedVar" | "totalFair" | "totalMarketFair";

export const VIEW_MODE_META: Record<ViewMode, { label: string; unit: string; decimals: number }> = {
  position: { label: "Desired Position", unit: "$vega", decimals: 2 },
  rawPosition: { label: "Raw Desired Position", unit: "$vega", decimals: 2 },
  change: { label: "Change", unit: "$vega", decimals: 2 },
  edge: { label: "Edge", unit: "", decimals: 6 },
  smoothedEdge: { label: "Smoothed Edge", unit: "", decimals: 6 },
  variance: { label: "Variance", unit: "", decimals: 6 },
  smoothedVar: { label: "Smoothed Variance", unit: "", decimals: 6 },
  totalFair: { label: "Total Fair", unit: "", decimals: 6 },
  totalMarketFair: { label: "Total Market Fair", unit: "", decimals: 6 },
};

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
    case "edge": return p.edge;
    case "smoothedEdge": return p.smoothedEdge;
    case "variance": return p.variance;
    case "smoothedVar": return p.smoothedVar;
    case "totalFair": return p.totalFair;
    case "totalMarketFair": return p.totalMarketFair;
  }
}
