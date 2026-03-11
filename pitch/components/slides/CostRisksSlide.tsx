"use client";

import { Check, X } from "lucide-react";

// ============================================================
// Table data
// ============================================================

interface Row {
  dimension: string;
  apt: string;
  trader: string;
  winner: "apt" | "trader" | "draw";
}

const TABLE_ROWS: Row[] = [
  {
    dimension: "Annual Cost",
    apt: "Fixed licensing cost",
    trader: "YoY salary increases",
    winner: "apt",
  },
  {
    dimension: "Profit share",
    apt: "No",
    trader: "Yes",
    winner: "apt",
  },
  {
    dimension: "Fixed Cost",
    apt: "Custom-built for free",
    trader: "Signing bonuses",
    winner: "apt",
  },
  {
    dimension: "Integration",
    apt: "Simple technical integration only",
    trader: "3m training required",
    winner: "apt",
  },
  {
    dimension: "Error risks",
    apt: "Glitches",
    trader: "Fat fingers",
    winner: "draw",
  },
  {
    dimension: "Dependency risk",
    apt: "Shutdown = Replacement trader",
    trader: "Termination = Replacement trader",
    winner: "draw",
  },
  {
    dimension: "Start time",
    apt: "2m to first iteration",
    trader: "Notice period (3m) + Non-compete (12m)",
    winner: "apt",
  },
];

const C = {
  apt: "#f59e0b",
  trader: "#a78bfa",
  good: "#22c55e",
  bad: "#ef4444",
};

// ============================================================
// Main slide
// ============================================================

export function CostRisksSlide() {
  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-2xl mx-auto">
      {/* Intro */}
      <p className="text-muted-foreground text-sm leading-relaxed text-center max-w-lg">
        A side-by-side comparison of the total cost and operational risk of
        running APT versus employing a human trader.
      </p>

      {/* ── Comparison Table ── */}
      <div className="w-full rounded-xl border border-muted overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[140px_1fr_1fr] bg-accent/40">
          <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" />
          <div
            className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider border-l border-muted"
            style={{ color: C.apt }}
          >
            APT
          </div>
          <div
            className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider border-l border-muted"
            style={{ color: C.trader }}
          >
            Trader
          </div>
        </div>

        {/* Rows */}
        {TABLE_ROWS.map((row, i) => (
          <div
            key={row.dimension}
            className={`grid grid-cols-[140px_1fr_1fr] ${
              i < TABLE_ROWS.length - 1 ? "border-b border-muted" : ""
            }`}
          >
            <div className="px-4 py-3 text-xs font-semibold text-foreground/90">
              {row.dimension}
            </div>
            <div
              className="px-4 py-3 text-xs border-l border-muted flex items-start gap-2"
              style={{
                color: row.winner === "apt" ? C.good : "var(--foreground)",
                opacity: row.winner === "apt" ? 1 : 0.7,
              }}
            >
              {row.winner === "apt" ? (
                <Check className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: C.good }} />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: C.bad }} />
              )}
              <span>{row.apt}</span>
            </div>
            <div
              className="px-4 py-3 text-xs border-l border-muted flex items-start gap-2"
              style={{
                color: row.winner === "trader" ? C.good : "var(--foreground)",
                opacity: row.winner === "trader" ? 1 : 0.7,
              }}
            >
              {row.winner === "trader" ? (
                <Check className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: C.good }} />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: C.bad }} />
              )}
              <span>{row.trader}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 text-muted-foreground w-full">
        <div className="h-px flex-1 bg-muted" />
        <span className="text-[10px] uppercase tracking-widest whitespace-nowrap">
          APT is strictly better on cost &amp; comparable on risk
        </span>
        <div className="h-px flex-1 bg-muted" />
      </div>
    </div>
  );
}
