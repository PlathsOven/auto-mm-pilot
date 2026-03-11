"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ============================================================
// Constants
// ============================================================

const STREAMS = [
  "Recent realized volatility",
  "Historical implied volatility",
  "Events database",
];

const TRADING_PARAMS = ["ATM Volatility", "Retreat Leans", "Quoting Width"];

const C = {
  streams: "#6366f1",
  logic: "#a78bfa",
  hands: "#22c55e",
  params: "#f59e0b",
};

// ============================================================
// Shared primitives
// ============================================================

function DownArrow({ color = "currentColor", label }: { color?: string; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      <div className="h-5 w-px" style={{ backgroundColor: `${color}50` }} />
      {label && (
        <span className="text-[9px] font-medium" style={{ color }}>
          {label}
        </span>
      )}
      <div
        className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent"
        style={{ borderTopColor: `${color}50` }}
      />
    </div>
  );
}

function SectionCard({
  title,
  color,
  children,
  dashed = false,
  className = "",
}: {
  title: string;
  color: string;
  children: React.ReactNode;
  dashed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border ${dashed ? "border-2 border-dashed" : ""} p-4 flex flex-col gap-2 w-full ${className}`}
      style={{
        borderColor: dashed ? `${color}30` : `${color}40`,
        backgroundColor: `${color}06`,
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
      style={{ borderColor: `${color}30`, color, backgroundColor: `${color}08` }}
    >
      {label}
    </span>
  );
}

// ============================================================
// Dot-point list helper (matches Data Streams / Trading Params style)
// ============================================================

function DotList({ items, color }: { items: string[]; color: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <div key={item} className="flex items-center gap-1.5 text-xs text-foreground/80">
          <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          {item}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// APT internals — Pricing Logic
// ============================================================

function PricingLogicInternals() {
  return (
    <div className="flex flex-col items-center gap-0 w-full">
      {/* Standardisation */}
      <div className="rounded-lg border px-4 py-2 text-center w-full max-w-xs" style={{ borderColor: `${C.logic}40`, backgroundColor: `${C.logic}10` }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.logic }}>Standardisation</span>
        <p className="text-[9px] text-muted-foreground mt-0.5">Normalise all streams into comparable units</p>
      </div>

      <DownArrow color={C.logic} />

      {/* Fair Value + Variance */}
      <div className="flex gap-3 w-full max-w-xs">
        {[
          { title: "Fair Value", desc: "Per-stream fair value" },
          { title: "Variance", desc: "Per-stream variance" },
        ].map((m) => (
          <div key={m.title} className="flex-1 rounded-lg border px-3 py-2 text-center" style={{ borderColor: `${C.logic}40`, backgroundColor: `${C.logic}10` }}>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.logic }}>{m.title}</span>
            <p className="text-[9px] text-muted-foreground mt-0.5">{m.desc}</p>
          </div>
        ))}
      </div>

      <DownArrow color={C.logic} />

      {/* Aggregator */}
      <div className="rounded-lg border px-4 py-2 text-center w-full max-w-xs" style={{ borderColor: `${C.logic}40`, backgroundColor: `${C.logic}10` }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.logic }}>Aggregator</span>
        <p className="text-[9px] text-muted-foreground mt-0.5">Combines values + variances with external inputs</p>
        <div className="flex flex-wrap justify-center gap-1.5 mt-1.5">
          <Chip label="+ Market Implied" color={C.logic} />
          <Chip label="+ Correlations" color={C.logic} />
        </div>
      </div>

    </div>
  );
}

// ============================================================
// APT internals — Execution Logic
// ============================================================

function ExecutionLogicInternals() {
  return (
    <div className="flex flex-col items-center gap-0 w-full">
      <div className="rounded-lg border px-4 py-2 text-center w-full max-w-xs" style={{ borderColor: `${C.hands}40`, backgroundColor: `${C.hands}10` }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.hands }}>Position Change Optimisation</span>
        <p className="text-[9px] text-muted-foreground mt-0.5">Transforms desired position changes to minimise execution costs</p>
        <div className="flex flex-wrap justify-center gap-1.5 mt-1.5">
          <Chip label="+ Current Positions" color={C.hands} />
        </div>
      </div>

      <DownArrow color={C.hands} />

      <div className="rounded-lg border px-4 py-2 text-center w-full max-w-xs" style={{ borderColor: `${C.hands}40`, backgroundColor: `${C.hands}10` }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.hands }}>Parameter Router</span>
        <p className="text-[9px] text-muted-foreground mt-0.5">Chooses parameter changes that minimise execution costs</p>
      </div>

    </div>
  );
}

// ============================================================
// Main slide — vertical flow
// ============================================================

type IpHighlight = null | "gravity" | "apt";

export function PositionManagementSlide() {
  const [showAptInternals, setShowAptInternals] = useState(false);
  const [ipHighlight, setIpHighlight] = useState<IpHighlight>(null);

  const gravityDim = ipHighlight === "apt" ? "opacity-20" : "opacity-100";
  const aptDim = ipHighlight === "gravity" ? "opacity-20" : "opacity-100";
  const arrowDim = ipHighlight !== null ? "opacity-40" : "opacity-100";

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-lg mx-auto">
      <p className="text-muted-foreground text-sm leading-relaxed text-center">
        Position management converts pricing signals into trading parameter
        changes. <strong className="text-foreground">Pricing Logic</strong> decides{" "}
        <em>what</em> position to hold;{" "}
        <strong className="text-foreground">Execution Logic</strong> figures out{" "}
        <em>how</em> to get there. APT automates both.
      </p>

      {/* Toggles row */}
      <div className="flex items-center gap-6 justify-center flex-wrap">
        {/* Black-box / Internals toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAptInternals(!showAptInternals)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              showAptInternals ? "bg-[var(--brand)]" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                showAptInternals ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span className="text-xs text-foreground/80 font-medium">
            {showAptInternals ? "APT Internals" : "Black Box View"}
          </span>
        </div>

        <div className="h-4 w-px bg-muted" />

        {/* IP highlight pills */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">IP:</span>
          {([
            { key: "gravity" as const, label: "Gravity Team", color: C.streams },
            { key: "apt" as const, label: "Trader/APT", color: C.logic },
          ]).map((pill) => {
            const active = ipHighlight === pill.key;
            return (
              <button
                key={pill.key}
                onClick={() => setIpHighlight(active ? null : pill.key)}
                className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-all"
                style={{
                  color: active ? "#fff" : pill.color,
                  borderColor: `${pill.color}${active ? "ff" : "40"}`,
                  backgroundColor: active ? pill.color : `${pill.color}08`,
                }}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Vertical flow ── */}

      {/* 1 · Data Streams */}
      <div className={`w-full transition-opacity duration-300 ${gravityDim}`}>
        <SectionCard title="Data Streams" color={C.streams}>
          <span className="text-[10px] text-muted-foreground italic text-center">
            Gravity Team&apos;s pricing signals
          </span>
          <DotList items={STREAMS} color={C.streams} />
        </SectionCard>
      </div>

      <div className={`transition-opacity duration-300 ${arrowDim}`}>
        <DownArrow color={C.streams} label="Pricing Signals" />
      </div>

      {/* 2 + 3 · Pricing Logic & Execution Logic — Black Box bracket */}
      <div className={`w-full transition-opacity duration-300 ${aptDim}`}>
      <SectionCard title="" color={C.logic} dashed className="relative pt-6">
        {/* Badge */}
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-semibold uppercase tracking-wider px-3 py-0.5 rounded-full border whitespace-nowrap"
          style={{ color: C.logic, borderColor: `${C.logic}40`, backgroundColor: `${C.logic}15` }}
        >
          BLACK BOX: Trader / APT
        </div>

        {/* Pricing Logic */}
        <SectionCard title="Pricing Logic" color={C.logic}>
          <AnimatePresence mode="wait">
            {showAptInternals ? (
              <motion.div
                key="pricing-internals"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="flex justify-center"
              >
                <PricingLogicInternals />
              </motion.div>
            ) : (
              <motion.div
                key="pricing-blackbox"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-2"
              >
                <span className="text-[10px] text-muted-foreground italic text-center block">
                  Converting information into desired positions
                </span>
                <DotList items={["Trader Experience"]} color={C.logic} />
              </motion.div>
            )}
          </AnimatePresence>
        </SectionCard>

        <DownArrow color={C.logic} label="Desired Position" />

        {/* Execution Logic */}
        <SectionCard title="Execution Logic" color={C.hands}>
          <AnimatePresence mode="wait">
            {showAptInternals ? (
              <motion.div
                key="exec-internals"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="flex justify-center"
              >
                <ExecutionLogicInternals />
              </motion.div>
            ) : (
              <motion.div
                key="exec-blackbox"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-2"
              >
                <span className="text-[10px] text-muted-foreground italic text-center block">
                  Shifting positions towards desired positions
                </span>
                <DotList items={["Trader Experience"]} color={C.hands} />
              </motion.div>
            )}
          </AnimatePresence>
        </SectionCard>
      </SectionCard>
      </div>

      <div className={`transition-opacity duration-300 ${arrowDim}`}>
        <DownArrow color={C.hands} label="Parameter Changes" />
      </div>

      {/* 4 · Trading Parameters */}
      <div className={`w-full transition-opacity duration-300 ${gravityDim}`}>
        <SectionCard title="Trading Parameters" color={C.params}>
          <span className="text-[10px] text-muted-foreground italic text-center">
            Pricing inputs
          </span>
          <DotList items={TRADING_PARAMS} color={C.params} />
        </SectionCard>
      </div>
      
    </div>
  );
}
