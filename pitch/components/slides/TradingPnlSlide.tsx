"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ============================================================
// Helpers
// ============================================================

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
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

function arcLabelPos(
  cx: number, cy: number,
  innerR: number, outerR: number,
  startAngle: number, endAngle: number,
) {
  const midAngle = (startAngle + endAngle) / 2;
  return polarToCartesian(cx, cy, (innerR + outerR) / 2, midAngle);
}

function formatDollars(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function parseNum(s: string): number {
  if (s === "" || s === "-" || s === "−") return 0;
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

// ============================================================
// Types
// ============================================================

interface ParamStrings {
  marketEdge: string;
  edgeShareDay: string;
  edgeShareNight: string;
  retShortDay: string;
  retLongDay: string;
  retShortNight: string;
  retLongNight: string;
}

interface ParsedParams {
  marketEdge: number;
  edgeShareDay: number;
  edgeShareNight: number;
  retShortDay: number;
  retLongDay: number;
  retShortNight: number;
  retLongNight: number;
}

interface ComputedValues {
  edgeDayAbs: number; edgeNightAbs: number; edgeNotCapturedAbs: number;
  dayRetShort: number; dayRetLong: number; dayNotRetained: number;
  nightRetShort: number; nightRetLong: number; nightNotRetained: number;
  annualPnl: number;
}

interface ArcSegment {
  id: string;
  label: string;
  fullLabel: string;
  value: number;
  color: string;
  isNegative: boolean;
  startAngle: number;
  endAngle: number;
  innerR: number;
  outerR: number;
}

// ============================================================
// Constants
// ============================================================

const CX = 200;
const CY = 200;
const INNER_R1 = 70;
const OUTER_R1 = 130;
const INNER_R2 = 135;
const OUTER_R2 = 185;
const GAP = 1.2;

const COLORS = {
  edgeDay: "#a78bfa",
  edgeNight: "#6366f1",
  edgeNotCaptured: "#3f3f46",
  retainedShortTerm: "#22c55e",
  retainedLongTerm: "#14b8a6",
  notRetained: "#3f3f46",
  negative: "#ef4444",
};

const CURRENT_DEFAULTS: ParamStrings = {
  marketEdge: "50000000",
  edgeShareDay: "10",
  edgeShareNight: "0",
  retShortDay: "40",
  retLongDay: "10",
  retShortNight: "40",
  retLongNight: "-60",
};

const WITH_POSIT_DEFAULTS: ParamStrings = {
  marketEdge: "50000000",
  edgeShareDay: "10",
  edgeShareNight: "5",
  retShortDay: "40",
  retLongDay: "20",
  retShortNight: "40",
  retLongNight: "10",
};

// ============================================================
// Pure computation (shared between both scenarios)
// ============================================================

function parseParams(s: ParamStrings): ParsedParams {
  return {
    marketEdge: parseNum(s.marketEdge),
    edgeShareDay: parseNum(s.edgeShareDay),
    edgeShareNight: parseNum(s.edgeShareNight),
    retShortDay: parseNum(s.retShortDay),
    retLongDay: parseNum(s.retLongDay),
    retShortNight: parseNum(s.retShortNight),
    retLongNight: parseNum(s.retLongNight),
  };
}

function computeValues(p: ParsedParams): ComputedValues {
  const edgeDayAbs = p.marketEdge * (p.edgeShareDay / 100);
  const edgeNightAbs = p.marketEdge * (p.edgeShareNight / 100);
  const edgeNotCapturedAbs = Math.max(0, p.marketEdge - edgeDayAbs - edgeNightAbs);

  const dayRetShort = edgeDayAbs * (p.retShortDay / 100);
  const dayRetLong = edgeDayAbs * (p.retLongDay / 100);
  const dayNotRetained = edgeDayAbs - Math.abs(dayRetShort) - Math.abs(dayRetLong);

  const nightRetShort = edgeNightAbs * (p.retShortNight / 100);
  const nightRetLong = edgeNightAbs * (p.retLongNight / 100);
  const nightNotRetained = edgeNightAbs - Math.abs(nightRetShort) - Math.abs(nightRetLong);

  const annualPnl =
    p.marketEdge * (
      (p.edgeShareDay / 100) * (p.retShortDay / 100) +
      (p.edgeShareDay / 100) * (p.retLongDay / 100) +
      (p.edgeShareNight / 100) * (p.retShortNight / 100) +
      (p.edgeShareNight / 100) * (p.retLongNight / 100)
    );

  return {
    edgeDayAbs, edgeNightAbs, edgeNotCapturedAbs,
    dayRetShort, dayRetLong, dayNotRetained,
    nightRetShort, nightRetLong, nightNotRetained,
    annualPnl,
  };
}

function buildArcs(p: ParsedParams, c: ComputedValues): { level1: ArcSegment[]; level2: ArcSegment[] } {
  if (p.marketEdge <= 0) return { level1: [], level2: [] };

  const l1Total = c.edgeDayAbs + c.edgeNightAbs + c.edgeNotCapturedAbs;
  if (l1Total === 0) return { level1: [], level2: [] };

  const dayAngle = (c.edgeDayAbs / l1Total) * 360;
  const nightAngle = (c.edgeNightAbs / l1Total) * 360;

  const level1: ArcSegment[] = [
    { id: "l1-day", label: "Day", fullLabel: "Edge Captured (Day)", value: c.edgeDayAbs, color: COLORS.edgeDay, isNegative: false, startAngle: 0, endAngle: dayAngle - GAP, innerR: INNER_R1, outerR: OUTER_R1 },
    { id: "l1-night", label: "Night", fullLabel: "Edge Captured (Night)", value: c.edgeNightAbs, color: COLORS.edgeNight, isNegative: false, startAngle: dayAngle, endAngle: dayAngle + nightAngle - GAP, innerR: INNER_R1, outerR: OUTER_R1 },
    { id: "l1-notcap", label: "Not Captured", fullLabel: "Edge Not Captured", value: c.edgeNotCapturedAbs, color: COLORS.edgeNotCaptured, isNegative: false, startAngle: dayAngle + nightAngle, endAngle: 360 - GAP, innerR: INNER_R1, outerR: OUTER_R1 },
  ];

  function retArcs(prefix: string, pStart: number, pEnd: number, retS: number, retL: number, notRet: number): ArcSegment[] {
    const span = pEnd - pStart;
    if (span <= 0) return [];
    const total = Math.abs(retS) + Math.abs(retL) + Math.max(0, notRet);
    if (total === 0) return [];
    const sAngle = (Math.abs(retS) / total) * span;
    const lAngle = (Math.abs(retL) / total) * span;
    const a1End = pStart + sAngle;
    const a2End = a1End + lAngle;
    const arcs: ArcSegment[] = [];
    if (sAngle > GAP) arcs.push({ id: `${prefix}-shortterm`, label: "Short Term", fullLabel: `Retained Short Term (${prefix === "day" ? "Day" : "Night"})`, value: retS, color: retS >= 0 ? COLORS.retainedShortTerm : COLORS.negative, isNegative: retS < 0, startAngle: pStart, endAngle: a1End - GAP, innerR: INNER_R2, outerR: OUTER_R2 });
    if (lAngle > GAP) arcs.push({ id: `${prefix}-longterm`, label: "Long Term", fullLabel: `Retained Long Term (${prefix === "day" ? "Day" : "Night"})`, value: retL, color: retL >= 0 ? COLORS.retainedLongTerm : COLORS.negative, isNegative: retL < 0, startAngle: a1End, endAngle: a2End - GAP, innerR: INNER_R2, outerR: OUTER_R2 });
    if (pEnd - a2End > GAP && notRet > 0) arcs.push({ id: `${prefix}-notret`, label: "Not Ret.", fullLabel: `Not Retained (${prefix === "day" ? "Day" : "Night"})`, value: notRet, color: COLORS.notRetained, isNegative: false, startAngle: a2End, endAngle: pEnd - GAP, innerR: INNER_R2, outerR: OUTER_R2 });
    return arcs;
  }

  const level2: ArcSegment[] = [
    ...retArcs("day", 0, dayAngle - GAP, c.dayRetShort, c.dayRetLong, c.dayNotRetained),
    ...retArcs("night", dayAngle, dayAngle + nightAngle - GAP, c.nightRetShort, c.nightRetLong, c.nightNotRetained),
  ];

  return { level1, level2 };
}

// ============================================================
// SunburstChart sub-component
// ============================================================

function SunburstChart({
  level1,
  level2,
  annualPnl,
  marketEdge,
  hatchId,
}: {
  level1: ArcSegment[];
  level2: ArcSegment[];
  annualPnl: number;
  marketEdge: number;
  hatchId: string;
}) {
  const [hovered, setHovered] = useState<ArcSegment | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [hiddenL1, setHiddenL1] = useState<Set<string>>(new Set());
  const [drilledL1, setDrilledL1] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Determine which L1 arcs have L2 children
  const l1HasChildren = useMemo(() => {
    const result = new Set<string>();
    for (const l1 of level1) {
      const prefix = l1.id.replace("l1-", "");
      if (level2.some((l2) => l2.id.startsWith(prefix + "-"))) result.add(l1.id);
    }
    return result;
  }, [level1, level2]);

  // Recompute L2 arcs densely within a parent angle range
  function packL2(children: ArcSegment[], pStart: number, pEnd: number): ArcSegment[] {
    const span = pEnd - pStart;
    if (span <= 0 || children.length === 0) return [];
    const total = children.reduce((s, c) => s + Math.abs(c.value), 0);
    if (total <= 0) return [];
    let cur = pStart;
    const out: ArcSegment[] = [];
    for (const child of children) {
      const cSpan = (Math.abs(child.value) / total) * span;
      if (cSpan > GAP) out.push({ ...child, startAngle: cur, endAngle: cur + cSpan - GAP });
      cur += cSpan;
    }
    return out;
  }

  const handleL1Click = useCallback((arc: ArcSegment) => {
    if (l1HasChildren.has(arc.id)) {
      setDrilledL1((prev) => (prev === arc.id ? null : arc.id));
    } else {
      setHiddenL1((prev) => {
        const next = new Set(prev);
        if (next.has(arc.id)) { next.delete(arc.id); }
        else {
          const visibleCount = level1.filter((a) => !next.has(a.id)).length;
          if (visibleCount <= 1) return prev;
          next.add(arc.id);
        }
        return next;
      });
    }
  }, [l1HasChildren, level1]);

  const resetView = useCallback(() => { setHiddenL1(new Set()); setDrilledL1(null); }, []);

  const { visibleL1, visibleL2 } = useMemo(() => {
    // Drilled into a specific L1 arc — show it as full circle
    if (drilledL1) {
      const arc = level1.find((a) => a.id === drilledL1);
      if (!arc) return { visibleL1: level1, visibleL2: level2 };
      const fullL1: ArcSegment = { ...arc, startAngle: 0, endAngle: 360 - GAP };
      const prefix = arc.id.replace("l1-", "");
      const children = level2.filter((l2) => l2.id.startsWith(prefix + "-"));
      return { visibleL1: [fullL1], visibleL2: packL2(children, 0, 360 - GAP) };
    }

    // Overview with possible hidden arcs
    const activeL1 = level1.filter((a) => !hiddenL1.has(a.id));
    if (hiddenL1.size === 0) {
      // Repack L2 densely even at default to keep consistent gap sizes
      const newL2: ArcSegment[] = [];
      for (const l1Arc of level1) {
        const prefix = l1Arc.id.replace("l1-", "");
        const children = level2.filter((l2) => l2.id.startsWith(prefix + "-"));
        newL2.push(...packL2(children, l1Arc.startAngle, l1Arc.endAngle));
      }
      return { visibleL1: level1, visibleL2: newL2 };
    }

    const totalValue = activeL1.reduce((s, a) => s + a.value, 0);
    if (totalValue <= 0) return { visibleL1: [], visibleL2: [] };

    let cur = 0;
    const newL1: ArcSegment[] = [];
    const newL2: ArcSegment[] = [];
    for (const orig of activeL1) {
      const span = (orig.value / totalValue) * 360;
      const s = cur, e = cur + span - GAP;
      newL1.push({ ...orig, startAngle: s, endAngle: e });
      const prefix = orig.id.replace("l1-", "");
      const children = level2.filter((l2) => l2.id.startsWith(prefix + "-"));
      newL2.push(...packL2(children, s, e));
      cur += span;
    }
    return { visibleL1: newL1, visibleL2: newL2 };
  }, [level1, level2, hiddenL1, drilledL1]);

  const hasModified = hiddenL1.size > 0 || drilledL1 !== null;

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox="0 0 400 400"
        className="w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(0,0,0,0.4)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* Level 1 */}
        {visibleL1.map((arc) => {
          const d = arcPath(CX, CY, arc.innerR, arc.outerR, arc.startAngle, arc.endAngle);
          if (!d) return null;
          return (
            <motion.path key={arc.id} d={d} fill={arc.color}
              initial={{ opacity: 0 }} animate={{ opacity: hovered?.id === arc.id ? 1 : 0.85 }}
              transition={{ duration: 0.3 }} className="cursor-pointer"
              stroke={hovered?.id === arc.id ? "#fff" : "transparent"} strokeWidth={1.5}
              onMouseEnter={() => setHovered(arc)}
              onClick={() => handleL1Click(arc)}
            />
          );
        })}

        {/* Level 2 */}
        {visibleL2.map((arc) => {
          const d = arcPath(CX, CY, arc.innerR, arc.outerR, arc.startAngle, arc.endAngle);
          if (!d) return null;
          return (
            <g key={arc.id}>
              <motion.path d={d} fill={arc.color}
                initial={{ opacity: 0 }} animate={{ opacity: hovered?.id === arc.id ? 1 : 0.8 }}
                transition={{ duration: 0.3 }} className="cursor-pointer"
                stroke={hovered?.id === arc.id ? "#fff" : "transparent"} strokeWidth={1.5}
                onMouseEnter={() => setHovered(arc)}
              />
              {arc.isNegative && <path d={d} fill={`url(#${hatchId})`} className="pointer-events-none" />}
            </g>
          );
        })}

        {/* Level 1 labels */}
        {visibleL1.map((arc) => {
          if (arc.endAngle - arc.startAngle < 15) return null;
          const pos = arcLabelPos(CX, CY, arc.innerR, arc.outerR, arc.startAngle, arc.endAngle);
          return (
            <text key={`lbl-${arc.id}`} x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central"
              className="text-[9px] font-semibold pointer-events-none" fill="#fff" stroke="#000" strokeWidth={2.5} paintOrder="stroke">
              <tspan x={pos.x} dy="-0.5em">{arc.label}</tspan>
              <tspan x={pos.x} dy="1.2em" className="text-[8px]">{formatDollars(arc.value)}</tspan>
            </text>
          );
        })}

        {/* Level 2 labels */}
        {visibleL2.map((arc) => {
          if (arc.endAngle - arc.startAngle < 18) return null;
          const pos = arcLabelPos(CX, CY, arc.innerR, arc.outerR, arc.startAngle, arc.endAngle);
          return (
            <text key={`lbl-${arc.id}`} x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central"
              className="text-[8px] font-semibold pointer-events-none" fill="#fff" stroke="#000" strokeWidth={2.5} paintOrder="stroke">
              <tspan x={pos.x} dy="-0.5em">{arc.label}</tspan>
              <tspan x={pos.x} dy="1.2em" className="text-[7px]">{formatDollars(arc.value)}</tspan>
            </text>
          );
        })}

        {/* Center: Market Edge + Annual PnL */}
        <text x={CX} y={CY - 26} textAnchor="middle" dominantBaseline="central" fill="#a1a1aa" className="text-[7px] font-medium">
          Market Edge
        </text>
        <text x={CX} y={CY - 13} textAnchor="middle" dominantBaseline="central" className="text-[11px] font-bold font-mono" fill="#fafafa">
          {formatDollars(marketEdge)}
        </text>
        <text x={CX} y={CY + 5} textAnchor="middle" dominantBaseline="central" fill="#a1a1aa" className="text-[7px] font-medium">
          Annual PnL
        </text>
        <text x={CX} y={CY + 20} textAnchor="middle" dominantBaseline="central"
          className="text-[13px] font-bold font-mono" fill={annualPnl >= 0 ? COLORS.retainedShortTerm : COLORS.negative}>
          {formatDollars(annualPnl)}
        </text>
        {hasModified && (
          <text x={CX} y={CY + 36} textAnchor="middle" dominantBaseline="central" fill="#a78bfa" className="text-[7px] cursor-pointer" onClick={resetView}>
            {drilledL1 ? "↻ back to all" : "↻ reset view"}
          </text>
        )}
        <circle cx={CX} cy={CY} r={INNER_R1 - 5} fill="transparent" className={hasModified ? "cursor-pointer" : ""} onClick={hasModified ? resetView : undefined} />
      </svg>

      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute z-10 pointer-events-none rounded-lg border border-muted bg-background/95 backdrop-blur-sm px-3 py-2 shadow-lg"
            style={{ left: Math.min(tooltipPos.x + 12, 240), top: tooltipPos.y - 8 }}
          >
            <p className="text-xs font-medium text-foreground">{hovered.fullLabel}</p>
            <p className="text-sm font-mono font-bold mt-0.5" style={{ color: hovered.isNegative ? COLORS.negative : hovered.color }}>
              {formatDollars(hovered.value)}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Cell — inline editable number input for the comparison table
// ============================================================

function Cell({ value, onChange, prefix, suffix, step = 1, allowNeg = false, span }: {
  value: string; onChange: (v: string) => void;
  prefix?: string; suffix?: string; step?: number; allowNeg?: boolean; span?: boolean;
}) {
  return (
    <td className={span ? "px-2 py-1" : "px-2 py-1"} colSpan={span ? 2 : 1}>
      <div className="flex items-center gap-0.5">
        {prefix && <span className="text-[10px] text-muted-foreground font-mono shrink-0">{prefix}</span>}
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} step={step}
          min={allowNeg ? undefined : 0}
          className="w-full min-w-0 rounded border border-muted bg-background px-1.5 py-0.5 text-xs font-mono text-foreground outline-none focus:border-[var(--brand)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && <span className="text-[10px] text-muted-foreground font-mono shrink-0">{suffix}</span>}
      </div>
    </td>
  );
}

// ============================================================
// Main slide: side-by-side comparison
// ============================================================

export function TradingPnlSlide() {
  const [curStrings, setCurStrings] = useState<ParamStrings>(CURRENT_DEFAULTS);
  const [positStrings, setPositStrings] = useState<ParamStrings>(WITH_POSIT_DEFAULTS);

  const curSet = useCallback((key: keyof ParamStrings, val: string) => {
    setCurStrings((prev) => ({ ...prev, [key]: val }));
  }, []);
  const positSet = useCallback((key: keyof ParamStrings, val: string) => {
    setPositStrings((prev) => ({ ...prev, [key]: val }));
  }, []);

  const curP = useMemo(() => parseParams(curStrings), [curStrings]);
  const positP = useMemo(() => parseParams(positStrings), [positStrings]);

  const curC = useMemo(() => computeValues(curP), [curP]);
  const positC = useMemo(() => computeValues(positP), [positP]);

  const curArcs = useMemo(() => buildArcs(curP, curC), [curP, curC]);
  const positArcs = useMemo(() => buildArcs(positP, positC), [positP, positC]);

  const delta = positC.annualPnl - curC.annualPnl;
  const deltaPct = curC.annualPnl !== 0 ? (delta / Math.abs(curC.annualPnl)) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm leading-relaxed max-w-3xl mx-auto text-center">
        Insufficient coverage, poor unmonitored positional performance, and limited trader time reduces firm PnL.
        Posit solves each of these problems to unlock potential PnL for Gravity Team.
      </p>

      {/* Two-column comparison */}
      <div className="grid grid-cols-2 gap-6 items-start">
        <ScenarioColumn
          title="Current"
          arcs={curArcs}
          computed={curC}
          marketEdge={curP.marketEdge}
          hatchId="hatch-cur"
        />
        <ScenarioColumn
          title="Posit"
          arcs={positArcs}
          computed={positC}
          marketEdge={positP.marketEdge}
          hatchId="hatch-posit"
        />
      </div>

      {/* Delta comparison bar */}
      <div className="rounded-xl border border-muted bg-accent/30 p-4 flex items-center justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Current PnL
          </span>
          <span className="font-mono text-lg font-bold" style={{ color: curC.annualPnl >= 0 ? COLORS.retainedShortTerm : COLORS.negative }}>
            {formatDollars(curC.annualPnl)}
          </span>
        </div>

        <div className="flex flex-col items-center gap-0.5 px-6 border-x border-muted">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Posit Uplift
          </span>
          <span className="font-mono text-2xl font-bold" style={{ color: delta >= 0 ? COLORS.retainedShortTerm : COLORS.negative }}>
            {delta >= 0 ? "+" : ""}{formatDollars(delta)}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {delta >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%
          </span>
        </div>

        <div className="flex flex-col gap-0.5 items-end">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            With Posit PnL
          </span>
          <span className="font-mono text-lg font-bold" style={{ color: positC.annualPnl >= 0 ? COLORS.retainedShortTerm : COLORS.negative }}>
            {formatDollars(positC.annualPnl)}
          </span>
        </div>
      </div>

      {/* Shared collapsible parameters */}
      <ParamComparisonTable
        curStrings={curStrings}
        positStrings={positStrings}
        onCurChange={curSet}
        onPositChange={positSet}
      />

      {/* Shared legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[10px]">
        {[
          { color: COLORS.edgeDay, label: "Day", hatched: false },
          { color: COLORS.edgeNight, label: "Night", hatched: false },
          { color: COLORS.edgeNotCaptured, label: "Not Captured", hatched: false },
          { color: COLORS.retainedShortTerm, label: "Retained Short Term", hatched: false },
          { color: COLORS.retainedLongTerm, label: "Retained Long Term", hatched: false },
          { color: COLORS.negative, label: "Negative", hatched: true },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1">
            <div className="relative h-2 w-2 rounded-sm overflow-hidden" style={{ backgroundColor: item.color }}>
              {item.hatched && (
                <svg className="absolute inset-0 w-full h-full">
                  <defs>
                    <pattern id="legend-hatch" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)">
                      <line x1="0" y1="0" x2="0" y2="3" stroke="rgba(0,0,0,0.5)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#legend-hatch)" />
                </svg>
              )}
            </div>
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// ParamComparisonTable — single collapsible table for both scenarios
// ============================================================

function ParamComparisonTable({
  curStrings,
  positStrings,
  onCurChange,
  onPositChange,
}: {
  curStrings: ParamStrings;
  positStrings: ParamStrings;
  onCurChange: (key: keyof ParamStrings, val: string) => void;
  onPositChange: (key: keyof ParamStrings, val: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const sharedSet = (key: keyof ParamStrings, val: string) => {
    onCurChange(key, val);
    onPositChange(key, val);
  };

  const TH = "px-2 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider font-medium text-left";
  const LABEL = "px-2 py-1 text-[11px] text-muted-foreground font-medium whitespace-nowrap";
  const SECTION = "px-2 py-1 text-[9px] text-muted-foreground/70 uppercase tracking-wider font-semibold bg-muted/20";

  type Row = {
    label: string;
    key: keyof ParamStrings;
    shared?: boolean;
    prefix?: string;
    suffix?: string;
    step?: number;
    allowNeg?: boolean;
  };

  const rows: (Row | { section: string })[] = [
    { label: "Market Edge", key: "marketEdge", shared: true, prefix: "$", step: 1_000_000 },
    { section: "Edge Capture" },
    { label: "Day Share", key: "edgeShareDay", suffix: "%", step: 5 },
    { label: "Night Share", key: "edgeShareNight", suffix: "%", step: 5 },
    { section: "Day Retention" },
    { label: "Short Term", key: "retShortDay", suffix: "%", step: 5, allowNeg: true },
    { label: "Long Term", key: "retLongDay", suffix: "%", step: 5, allowNeg: true },
    { section: "Night Retention" },
    { label: "Short Term", key: "retShortNight", suffix: "%", step: 5, allowNeg: true },
    { label: "Long Term", key: "retLongNight", suffix: "%", step: 5, allowNeg: true },
  ];

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider font-medium hover:text-foreground transition-colors mb-2"
      >
        <svg className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18l6-6-6-6" />
        </svg>
        Parameters
      </button>
      {open && (
        <div className="rounded-lg border border-muted/40 bg-accent/30 overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-muted/40">
                <th className={TH} style={{ width: "32%" }} />
                <th className={`${TH} text-center`} style={{ width: "26%" }}>Current</th>
                <th className={`${TH} text-center`} style={{ width: "26%" }}>Posit</th>
                <th className={`${TH} text-center`} style={{ width: "16%" }}>Diff</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                if ("section" in row) {
                  return (
                    <tr key={`s-${i}`}><td colSpan={4} className={SECTION}>{row.section}</td></tr>
                  );
                }
                const curVal = parseNum(curStrings[row.key]);
                const positVal = parseNum(positStrings[row.key]);
                const diff = positVal - curVal;
                const diffColor = row.shared ? "text-muted-foreground/50" : diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-muted-foreground/50";
                const diffStr = row.shared ? "—" : row.prefix === "$" ? formatDollars(diff) : `${diff >= 0 ? "+" : ""}${diff}`;
                return (
                  <tr key={row.key}>
                    <td className={LABEL}>{row.label}</td>
                    {row.shared ? (
                      <Cell
                        value={curStrings[row.key]}
                        onChange={(v) => sharedSet(row.key, v)}
                        prefix={row.prefix} suffix={row.suffix}
                        step={row.step} allowNeg={row.allowNeg} span
                      />
                    ) : (
                      <>
                        <Cell
                          value={curStrings[row.key]}
                          onChange={(v) => onCurChange(row.key, v)}
                          prefix={row.prefix} suffix={row.suffix}
                          step={row.step} allowNeg={row.allowNeg}
                        />
                        <Cell
                          value={positStrings[row.key]}
                          onChange={(v) => onPositChange(row.key, v)}
                          prefix={row.prefix} suffix={row.suffix}
                          step={row.step} allowNeg={row.allowNeg}
                        />
                      </>
                    )}
                    <td className={`px-2 py-1 text-center text-[11px] font-mono ${diffColor}`}>
                      {diffStr}{!row.shared && row.suffix ? row.suffix : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ScenarioColumn — one side of the comparison
// ============================================================

function ScenarioColumn({
  title,
  arcs,
  computed,
  marketEdge,
  hatchId,
}: {
  title: string;
  arcs: { level1: ArcSegment[]; level2: ArcSegment[] };
  computed: ComputedValues;
  marketEdge: number;
  hatchId: string;
}) {
  return (
    <div className="flex flex-col gap-2 items-center">
      <span className="text-lg font-semibold tracking-tight text-center">{title}</span>
      <SunburstChart
        level1={arcs.level1}
        level2={arcs.level2}
        annualPnl={computed.annualPnl}
        marketEdge={marketEdge}
        hatchId={hatchId}
      />
    </div>
  );
}
