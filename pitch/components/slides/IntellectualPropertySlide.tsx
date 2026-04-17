"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";

// ============================================================
// Table data
// ============================================================

interface Row {
  feature: string;
  traderSkill: string;
  positLogic: string;
  corporateIp: string;
}

const TABLE_ROWS: Row[] = [
  {
    feature: "Ownership",
    traderSkill: "Stays with the trader.",
    positLogic: "Stays with the Posit external vendor.",
    corporateIp: "Stays with the company.",
  },
  {
    feature: "Transferability",
    traderSkill: "Traders take their skill to their next job.",
    positLogic: "Vendor retains logic across engagements.",
    corporateIp: "Owned solely by the company.",
  },
  {
    feature: "Legal Protection",
    traderSkill: "Generally unprotected (Freedom to work).",
    positLogic: "Protected as vendor trade secrets.",
    corporateIp: "Protected by patents, copyrights, contracts, etc.",
  },
];

const CORPORATE_IP_ITEMS = [
  "Adaptive Parameters",
  "On-Demand Explanations",
  "Team Chat + Notes",
  "Daily Trading Wraps",
];

const C = {
  skill: "#a78bfa",
  corporate: "#22c55e",
  posit: "#f59e0b",
};

// ============================================================
// Main slide
// ============================================================

export function IntellectualPropertySlide() {
  const [showPosit, setShowPosit] = useState(false);

  const middleLabel = showPosit ? "Posit Logic" : "Trader Skill";
  const middleColor = showPosit ? C.posit : C.skill;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-2xl mx-auto">
      {/* Intro */}
      <p className="text-muted-foreground text-sm leading-relaxed text-center max-w-lg">
        A trader&apos;s skill is <em>not</em> corporate IP&nbsp;&mdash; it walks
        out the door when they leave. Posit&apos;s internal logic is no different.
        But Posit also <strong className="text-foreground">converts</strong> that
        skill into lasting corporate IP.
      </p>

      {/* Toggle */}
      <div className="flex items-center gap-3 justify-center">
        <span
          className="text-xs font-medium transition-colors"
          style={{ color: showPosit ? "var(--muted-foreground)" : C.skill }}
        >
          Trader Skill
        </span>
        <button
          onClick={() => setShowPosit(!showPosit)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            showPosit ? "bg-[var(--brand)]" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
              showPosit ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span
          className="text-xs font-medium transition-colors"
          style={{ color: showPosit ? C.posit : "var(--muted-foreground)" }}
        >
          Posit Logic
        </span>
      </div>

      {/* ── Comparison Table ── */}
      <div className="w-full rounded-xl border border-muted overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[140px_1fr_1fr] bg-accent/40">
          <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Feature
          </div>
          <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider border-l border-muted">
            <AnimatePresence mode="wait">
              <motion.span
                key={middleLabel}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                style={{ color: middleColor }}
              >
                {middleLabel}
              </motion.span>
            </AnimatePresence>
          </div>
          <div
            className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider border-l border-muted"
            style={{ color: C.corporate }}
          >
            Corporate IP
          </div>
        </div>

        {/* Rows */}
        {TABLE_ROWS.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-[140px_1fr_1fr] ${
              i < TABLE_ROWS.length - 1 ? "border-b border-muted" : ""
            }`}
          >
            <div className="px-4 py-3 text-xs font-semibold text-foreground/90">
              {row.feature}
            </div>
            <div className="px-4 py-3 text-xs text-foreground/80 border-l border-muted">
              <AnimatePresence mode="wait">
                <motion.span
                  key={showPosit ? "posit" : "trader"}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="block"
                >
                  {showPosit ? row.positLogic : row.traderSkill}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="px-4 py-3 text-xs text-foreground/80 border-l border-muted">
              {row.corporateIp}
            </div>
          </div>
        ))}
      </div>

      {/* ── Arrow: Trader Skill / Posit Logic → Corporate IP ── */}
      <div className="w-full flex flex-col items-center gap-4 pt-2">
        {/* Arrow row */}
        <div className="flex items-center justify-center gap-4 w-full max-w-md">
          {/* Left label */}
          <div
            className="rounded-lg border px-4 py-2 text-center text-xs font-semibold shrink-0"
            style={{
              borderColor: `${middleColor}40`,
              backgroundColor: `${middleColor}08`,
              color: middleColor,
            }}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={middleLabel}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {middleLabel}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className="h-px flex-1" style={{ backgroundColor: `${C.posit}50` }} />
            <div
              className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
              style={{
                color: C.posit,
                backgroundColor: `${C.posit}15`,
                border: `1px solid ${C.posit}30`,
              }}
            >
              Posit
            </div>
            <div className="flex items-center gap-0">
              <div className="h-px w-4" style={{ backgroundColor: `${C.posit}50` }} />
              <ArrowRight className="h-4 w-4" style={{ color: `${C.posit}80` }} />
            </div>
          </div>

          {/* Right label */}
          <div
            className="rounded-lg border px-4 py-2 text-center text-xs font-semibold shrink-0"
            style={{
              borderColor: `${C.corporate}40`,
              backgroundColor: `${C.corporate}08`,
              color: C.corporate,
            }}
          >
            Corporate IP
          </div>
        </div>

        {/* Dot points */}
        <div
          className="rounded-xl border p-4 w-full max-w-md"
          style={{
            borderColor: `${C.posit}30`,
            backgroundColor: `${C.posit}06`,
          }}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-wider block text-center mb-3"
            style={{ color: C.posit }}
          >
            Posit Institutionalises Knowledge
          </span>
          <div className="flex flex-col gap-2">
            {CORPORATE_IP_ITEMS.map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs text-foreground/80">
                <div
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: C.posit }}
                />
                {item}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 text-center leading-relaxed">
            Every decision is recorded, explained, and searchable&nbsp;&mdash;
            making it easier to train new staff, improve collective skills,
            and build lasting organisational knowledge.
          </p>
        </div>
      </div>

    </div>
  );
}
