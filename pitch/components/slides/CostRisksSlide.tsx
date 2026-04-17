"use client";

import { Check, X } from "lucide-react";

// ============================================================
// Table data
// ============================================================

interface Row {
  dimension: string;
  posit: string;
  trader: string;
  winner: "posit" | "trader" | "draw";
}

const TABLE_ROWS: Row[] = [
  {
    dimension: "Annual Cost",
    posit: "Fixed licensing cost",
    trader: "YoY salary increases",
    winner: "posit",
  },
  {
    dimension: "Profit share",
    posit: "No",
    trader: "Yes",
    winner: "posit",
  },
  {
    dimension: "Fixed Cost",
    posit: "Custom-built for free",
    trader: "Signing bonuses",
    winner: "posit",
  },
  {
    dimension: "Integration",
    posit: "Simple technical integration only",
    trader: "3m training required",
    winner: "posit",
  },
  {
    dimension: "Error risks",
    posit: "Glitches",
    trader: "Fat fingers",
    winner: "draw",
  },
  {
    dimension: "Dependency risk",
    posit: "Shutdown = Replacement trader",
    trader: "Termination = Replacement trader",
    winner: "draw",
  },
  {
    dimension: "Start time",
    posit: "2m to first iteration",
    trader: "Notice period (3m) + Non-compete (12m)",
    winner: "posit",
  },
];

const C = {
  posit: "#f59e0b",
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
        running Posit versus employing a human trader.
      </p>

      {/* ── Comparison Table ── */}
      <div className="w-full rounded-xl border border-muted overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[140px_1fr_1fr] bg-accent/40">
          <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" />
          <div
            className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider border-l border-muted"
            style={{ color: C.posit }}
          >
            Posit
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
                color: row.winner === "posit" ? C.good : "var(--foreground)",
                opacity: row.winner === "posit" ? 1 : 0.7,
              }}
            >
              {row.winner === "posit" ? (
                <Check className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: C.good }} />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: C.bad }} />
              )}
              <span>{row.posit}</span>
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
          Posit is strictly better on cost &amp; comparable on risk
        </span>
        <div className="h-px flex-1 bg-muted" />
      </div>
    </div>
  );
}
