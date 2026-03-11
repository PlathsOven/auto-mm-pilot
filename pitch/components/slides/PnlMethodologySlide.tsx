"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ============================================================
// Helpers (shared with TradingPnlSlide)
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

interface SimpleParams {
  marketEdge: string;   // $ absolute
  edgeShare: string;    // %
  edgeRetention: string; // %
}

interface ArcSegment {
  id: string;
  label: string;
  fullLabel: string;
  value: number;
  color: string;
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
  edgeCaptured: "#a78bfa",
  edgeNotCaptured: "#3f3f46",
  retained: "#22c55e",
  notRetained: "#3f3f46",
};

const DEFAULTS: SimpleParams = {
  marketEdge: "50000000",
  edgeShare: "10",
  edgeRetention: "50",
};

// ============================================================
// Computation
// ============================================================

function compute(p: SimpleParams) {
  const marketEdge = parseNum(p.marketEdge);
  const edgeShare = parseNum(p.edgeShare) / 100;
  const edgeRetention = parseNum(p.edgeRetention) / 100;

  const captured = marketEdge * edgeShare;
  const notCaptured = Math.max(0, marketEdge - captured);
  const retained = captured * edgeRetention;
  const notRetained = Math.max(0, captured - retained);
  const pnl = retained;

  return { marketEdge, edgeShare, edgeRetention, captured, notCaptured, retained, notRetained, pnl };
}

function buildSimpleArcs(c: ReturnType<typeof compute>): { level1: ArcSegment[]; level2: ArcSegment[] } {
  if (c.marketEdge <= 0) return { level1: [], level2: [] };

  const l1Total = c.captured + c.notCaptured;
  if (l1Total === 0) return { level1: [], level2: [] };

  const capturedAngle = (c.captured / l1Total) * 360;

  const level1: ArcSegment[] = [];
  if (capturedAngle > GAP) {
    level1.push({
      id: "l1-captured", label: "Captured", fullLabel: "Edge Captured",
      value: c.captured, color: COLORS.edgeCaptured,
      startAngle: 0, endAngle: capturedAngle - GAP,
      innerR: INNER_R1, outerR: OUTER_R1,
    });
  }
  if (360 - capturedAngle > GAP) {
    level1.push({
      id: "l1-notcap", label: "Not Captured", fullLabel: "Edge Not Captured",
      value: c.notCaptured, color: COLORS.edgeNotCaptured,
      startAngle: capturedAngle, endAngle: 360 - GAP,
      innerR: INNER_R1, outerR: OUTER_R1,
    });
  }

  // Level 2: retention breakdown within the captured arc
  const level2: ArcSegment[] = [];
  if (c.captured > 0) {
    const capEnd = capturedAngle - GAP;
    const retTotal = c.retained + c.notRetained;
    if (retTotal > 0) {
      const retAngle = (c.retained / retTotal) * capEnd;
      if (retAngle > GAP) {
        level2.push({
          id: "retained", label: "Retained", fullLabel: "Edge Retained",
          value: c.retained, color: COLORS.retained,
          startAngle: 0, endAngle: retAngle - GAP,
          innerR: INNER_R2, outerR: OUTER_R2,
        });
      }
      if (capEnd - retAngle > GAP) {
        level2.push({
          id: "notret", label: "Not Retained", fullLabel: "Edge Not Retained",
          value: c.notRetained, color: COLORS.notRetained,
          startAngle: retAngle, endAngle: capEnd - GAP,
          innerR: INNER_R2, outerR: OUTER_R2,
        });
      }
    }
  }

  return { level1, level2 };
}

// ============================================================
// SimpleSunburstChart
// ============================================================

function SimpleSunburstChart({
  level1, level2, pnl, marketEdge,
}: {
  level1: ArcSegment[];
  level2: ArcSegment[];
  pnl: number;
  marketEdge: number;
}) {
  const [hovered, setHovered] = useState<ArcSegment | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  return (
    <div className="relative w-full max-w-[480px] mx-auto">
      <svg
        ref={svgRef}
        viewBox="0 0 400 400"
        className="w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Level 1 */}
        {level1.map((arc) => {
          const d = arcPath(CX, CY, arc.innerR, arc.outerR, arc.startAngle, arc.endAngle);
          if (!d) return null;
          return (
            <motion.path key={arc.id} d={d} fill={arc.color}
              initial={{ opacity: 0 }} animate={{ opacity: hovered?.id === arc.id ? 1 : 0.85 }}
              transition={{ duration: 0.3 }} className="cursor-pointer"
              stroke={hovered?.id === arc.id ? "#fff" : "transparent"} strokeWidth={1.5}
              onMouseEnter={() => setHovered(arc)}
            />
          );
        })}

        {/* Level 2 */}
        {level2.map((arc) => {
          const d = arcPath(CX, CY, arc.innerR, arc.outerR, arc.startAngle, arc.endAngle);
          if (!d) return null;
          return (
            <motion.path key={arc.id} d={d} fill={arc.color}
              initial={{ opacity: 0 }} animate={{ opacity: hovered?.id === arc.id ? 1 : 0.8 }}
              transition={{ duration: 0.3 }} className="cursor-pointer"
              stroke={hovered?.id === arc.id ? "#fff" : "transparent"} strokeWidth={1.5}
              onMouseEnter={() => setHovered(arc)}
            />
          );
        })}

        {/* Level 1 labels */}
        {level1.map((arc) => {
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
        {level2.map((arc) => {
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

        {/* Center: Market Edge + PnL */}
        <text x={CX} y={CY - 26} textAnchor="middle" dominantBaseline="central" fill="#a1a1aa" className="text-[7px] font-medium">
          Market Edge
        </text>
        <text x={CX} y={CY - 13} textAnchor="middle" dominantBaseline="central" className="text-[11px] font-bold font-mono" fill="#fafafa">
          {formatDollars(marketEdge)}
        </text>
        <text x={CX} y={CY + 5} textAnchor="middle" dominantBaseline="central" fill="#a1a1aa" className="text-[7px] font-medium">
          Trading PnL
        </text>
        <text x={CX} y={CY + 20} textAnchor="middle" dominantBaseline="central"
          className="text-[13px] font-bold font-mono" fill={pnl >= 0 ? COLORS.retained : "#ef4444"}>
          {formatDollars(pnl)}
        </text>
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
            <p className="text-sm font-mono font-bold mt-0.5" style={{ color: hovered.color }}>
              {formatDollars(hovered.value)}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// EquationInput — inline number input within the equation
// ============================================================

function EquationInput({ value, onChange, prefix, suffix, step = 1 }: {
  value: string; onChange: (v: string) => void;
  prefix?: string; suffix?: string; step?: number;
}) {
  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-sm text-muted-foreground font-mono shrink-0">{prefix}</span>}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min={0}
        className="w-28 rounded border border-muted bg-background px-2 py-1 text-center text-sm font-mono text-foreground outline-none focus:border-[var(--brand)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="text-sm text-muted-foreground font-mono shrink-0">{suffix}</span>}
    </div>
  );
}

// ============================================================
// Driver data
// ============================================================

interface DriverSection {
  term: string;
  color: string;
  drivers: string[];
  subsections?: { heading: string; items: string[] }[];
}

const DRIVER_DATA: { marketEdge: DriverSection; edgeShare: DriverSection; edgeRetention: DriverSection } = {
  marketEdge: { term: "Market Edge", color: "#a78bfa", drivers: ["Market selection", "Business development & strategy"] },
  edgeShare: { term: "Edge Share", color: "#a78bfa", drivers: ["Latency", "Queue priority", "Execution logic"] },
  edgeRetention: {
    term: "Edge Retention",
    color: "#22c55e",
    drivers: [],
    subsections: [
      { heading: "Short Term", items: ["Retreat logic", "Taking / skipping logic", "Microprice quality", "Short-term signals"] },
      { heading: "Long Term", items: ["Position management quality"] },
    ],
  },
};

// ============================================================
// DriverCard — floating card with upward-pointing connector
// ============================================================

function DriverCard({ data }: { data: DriverSection }) {
  return (
    <div className="flex flex-col items-center mt-3">
      {/* Upward connector arrow */}
      <div className="flex flex-col items-center mb-0">
        <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[5px] border-l-transparent border-r-transparent" style={{ borderBottomColor: data.color, opacity: 0.5 }} />
        <div className="w-px h-4" style={{ backgroundColor: data.color, opacity: 0.5 }} />
      </div>
      <div className="rounded-lg border border-muted bg-background/80 backdrop-blur-sm px-3 py-2 flex flex-col gap-1.5 min-w-[140px]">
        {/* Simple drivers */}
        {data.drivers.length > 0 && (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: data.color }}>
              {data.term}
            </span>
            {data.drivers.map((d) => (
              <div key={d} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                <div className="h-1 w-1 rounded-full shrink-0 mt-[5px]" style={{ backgroundColor: data.color }} />
                {d}
              </div>
            ))}
          </>
        )}
        {/* Subsections */}
        {data.subsections?.map((sub, i) => (
          <div key={sub.heading} className={`flex flex-col gap-1 ${i > 0 ? "mt-1" : ""}`}>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: data.color }}>
              {sub.heading}
            </span>
            {sub.items.map((item) => (
              <div key={item} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                <div className="h-1 w-1 rounded-full shrink-0 mt-[5px]" style={{ backgroundColor: data.color }} />
                {item}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Main slide
// ============================================================

export function PnlMethodologySlide() {
  const [params, setParams] = useState<SimpleParams>(DEFAULTS);

  const set = useCallback((key: keyof SimpleParams, val: string) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  }, []);

  const c = useMemo(() => compute(params), [params]);
  const arcs = useMemo(() => buildSimpleArcs(c), [c]);

  return (
    <div className="flex flex-col gap-8">
      <p className="text-muted-foreground text-sm leading-relaxed max-w-3xl mx-auto text-center">
        Every trading firm&apos;s PnL can be decomposed into three multiplicative factors.
        This framework identifies where PnL is created and where it leaks.
      </p>

      {/* Chart centered */}
      <div className="flex flex-col items-center gap-4">
        <SimpleSunburstChart
          level1={arcs.level1}
          level2={arcs.level2}
          pnl={c.pnl}
          marketEdge={c.marketEdge}
        />

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-xs">
          {[
            { color: COLORS.edgeCaptured, label: "Edge Captured" },
            { color: COLORS.edgeNotCaptured, label: "Not Captured" },
            { color: COLORS.retained, label: "Edge Retained" },
            { color: COLORS.notRetained, label: "Not Retained" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Equation: inputs (top) → labels (middle) → driver cards (bottom) */}
      <div className="rounded-xl border border-muted bg-accent/30 p-6 pb-4">
        <div className="flex items-start justify-center gap-x-2">

          {/* --- Market Edge column --- */}
          <div className="flex flex-col items-center">
            <EquationInput value={params.marketEdge} onChange={(v) => set("marketEdge", v)} prefix="$" step={1_000_000} />
            <span className="text-[10px] text-muted-foreground font-mono mt-0.5">{formatDollars(c.marketEdge)}</span>
            <span className="text-lg md:text-xl font-bold tracking-tight text-foreground mt-1">Market Edge ($)</span>
            <DriverCard data={DRIVER_DATA.marketEdge} />
          </div>

          <span className="text-xl font-bold text-muted-foreground mt-2">×</span>

          {/* --- Edge Share column --- */}
          <div className="flex flex-col items-center">
            <EquationInput value={params.edgeShare} onChange={(v) => set("edgeShare", v)} suffix="%" step={1} />
            <span className="text-[10px] text-muted-foreground font-mono mt-0.5">→ {formatDollars(c.captured)} captured</span>
            <span className="text-lg md:text-xl font-bold tracking-tight text-foreground mt-1">Edge Share (%)</span>
            <DriverCard data={DRIVER_DATA.edgeShare} />
          </div>

          <span className="text-xl font-bold text-muted-foreground mt-2">×</span>

          {/* --- Edge Retention column --- */}
          <div className="flex flex-col items-center">
            <EquationInput value={params.edgeRetention} onChange={(v) => set("edgeRetention", v)} suffix="%" step={1} />
            <span className="text-[10px] text-muted-foreground font-mono mt-0.5">→ {formatDollars(c.retained)} retained</span>
            <span className="text-lg md:text-xl font-bold tracking-tight text-foreground mt-1">Edge Retention (%)</span>
            <DriverCard data={DRIVER_DATA.edgeRetention} />
          </div>

          <span className="text-xl font-bold text-muted-foreground mt-2">=</span>

          {/* --- PnL result column --- */}
          <div className="flex flex-col items-center">
            <div className="flex items-center justify-center h-[34px] px-4 rounded border border-muted bg-background">
              <span className="text-sm font-mono font-bold" style={{ color: c.pnl >= 0 ? COLORS.retained : "#ef4444" }}>
                {formatDollars(c.pnl)}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono mt-0.5">annual PnL</span>
            <span className="text-lg md:text-xl font-bold tracking-tight mt-1" style={{ color: c.pnl >= 0 ? COLORS.retained : "#ef4444" }}>PnL</span>
          </div>
        </div>
      </div>
    </div>
  );
}
