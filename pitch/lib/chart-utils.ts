// ============================================================
// Shared chart utilities for sunburst / arc visualisations
// ============================================================

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function arcPath(
  cx: number, cy: number,
  innerR: number, outerR: number,
  startAngle: number, endAngle: number,
): string {
  const sweep = Math.abs(endAngle - startAngle);
  if (sweep < 0.1) return "";
  const largeArc = sweep > 180 ? 1 : 0;
  const os = polarToCartesian(cx, cy, outerR, startAngle);
  const oe = polarToCartesian(cx, cy, outerR, endAngle);
  const is_ = polarToCartesian(cx, cy, innerR, startAngle);
  const ie = polarToCartesian(cx, cy, innerR, endAngle);
  return [
    `M ${os.x} ${os.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${oe.x} ${oe.y}`,
    `L ${ie.x} ${ie.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${is_.x} ${is_.y}`,
    "Z",
  ].join(" ");
}

export function arcLabelPos(
  cx: number, cy: number,
  innerR: number, outerR: number,
  startAngle: number, endAngle: number,
) {
  const midAngle = (startAngle + endAngle) / 2;
  return polarToCartesian(cx, cy, (innerR + outerR) / 2, midAngle);
}

export function formatDollars(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function parseNum(s: string): number {
  if (s === "" || s === "-" || s === "−") return 0;
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

// Shared layout constants
export const CX = 200;
export const CY = 200;
export const INNER_R1 = 70;
export const OUTER_R1 = 130;
export const INNER_R2 = 135;
export const OUTER_R2 = 185;
export const GAP = 1.2;
