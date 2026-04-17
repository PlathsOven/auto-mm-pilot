"use client";

// ============================================================
// Constants
// ============================================================

const EGRESS_ITEMS = [
  "Encrypted Logic Logs",
  "Masked Linguistic Telemetry",
  "Performance Metadata",
];

// Visual encoding:
//   Colour → Ownership:   firm colour = firm-owned,  vendor colour = vendor-provided
//   Fill   → Visibility:  transparent  = visible/auditable,  dark fill = protected (black box)
const C = {
  firm: "#22c55e",
  vendor: "#a78bfa",
  vpc: "#3b82f6",
  egress: "#94a3b8",
  docker: "#0ea5e9",
};

// ============================================================
// Shared primitives
// ============================================================

function FirmCard({ title }: { title: string }) {
  return (
    <div
      className="rounded-xl border-2 p-3 w-full text-center"
      style={{ borderColor: `${C.firm}50` }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.firm }}>
        {title}
      </span>
    </div>
  );
}

function FirmGate({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-0 py-0.5">
      <div className="h-3 w-px" style={{ backgroundColor: `${C.firm}30` }} />
      <div
        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border-2"
        style={{ borderColor: `${C.firm}50` }}
      >
        <svg className="h-3 w-3" style={{ color: C.firm }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.firm }}>
          {label}
        </span>
      </div>
      <div className="h-3 w-px" style={{ backgroundColor: `${C.firm}30` }} />
    </div>
  );
}

// ============================================================
// Docker icon SVG path (shared)
// ============================================================

const DOCKER_PATH =
  "M13.983 11.078h2.119a.186.186 0 0 0 .186-.185V9.006a.186.186 0 0 0-.186-.186h-2.119a.186.186 0 0 0-.187.186v1.887c0 .102.084.185.187.185m-2.954-5.43h2.118a.186.186 0 0 0 .187-.185V3.574a.186.186 0 0 0-.187-.185h-2.118a.186.186 0 0 0-.187.185v1.888c0 .102.085.185.187.185m0 2.716h2.118a.187.187 0 0 0 .187-.186V6.29a.187.187 0 0 0-.187-.186h-2.118a.187.187 0 0 0-.187.186v1.887c0 .102.085.186.187.186m-2.93 0h2.12a.186.186 0 0 0 .186-.186V6.29a.186.186 0 0 0-.186-.186H8.1a.186.186 0 0 0-.185.186v1.887c0 .102.083.186.185.186m-2.964 0h2.119a.186.186 0 0 0 .185-.186V6.29a.186.186 0 0 0-.185-.186H5.136a.186.186 0 0 0-.186.186v1.887c0 .102.084.186.186.186m5.893 2.715h2.118a.186.186 0 0 0 .187-.185V9.006a.186.186 0 0 0-.187-.186h-2.118a.186.186 0 0 0-.187.186v1.887c0 .102.085.185.187.185m-2.93 0h2.12a.186.186 0 0 0 .186-.185V9.006a.186.186 0 0 0-.186-.186h-2.12a.186.186 0 0 0-.184.186v1.887c0 .102.083.185.185.185m-2.964 0h2.119a.186.186 0 0 0 .185-.185V9.006a.186.186 0 0 0-.185-.186H5.136a.186.186 0 0 0-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 0 0 .184-.185V9.006a.185.185 0 0 0-.184-.186h-2.12a.185.185 0 0 0-.184.186v1.887c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 0 0-.75.748 11.376 11.376 0 0 0 .692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 0 0 3.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z";

// ============================================================
// Main slide
// ============================================================

export function DataSecuritySlide() {
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-2xl mx-auto">
      <p className="text-muted-foreground text-sm leading-relaxed text-center max-w-lg">
        Posit is delivered as a <strong className="text-foreground">compiled Docker container</strong> deployed
        entirely within the firm&apos;s VPC. All security gates are vendor-provided
        but <strong className="text-foreground">fully auditable</strong> by the firm&apos;s engineering team.
      </p>

      {/* ── Main layout: VPC with egress anchored to Posit ── */}
      <div className="w-full pr-56">
        <div
          className="rounded-2xl border-2 border-dashed p-4 pt-6 flex flex-col items-center gap-0 relative overflow-visible"
          style={{
            borderColor: `${C.vpc}40`,
            backgroundColor: `${C.vpc}04`,
          }}
        >
          {/* VPC label */}
          <div
            className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-widest px-3 py-0.5 rounded-full border whitespace-nowrap"
            style={{
              color: C.vpc,
              borderColor: `${C.vpc}40`,
              backgroundColor: `${C.vpc}12`,
            }}
          >
            Gravity Team VPC
          </div>

          {/* 1 · Data Streams — firm-owned, visible → firm colour, no fill */}
          <FirmCard title="Data Streams" />

          {/* 2 · Posit — vendor-owned, PROTECTED → vendor colour, DARK fill */}
          {/* Egress arrow is absolutely positioned from this wrapper */}
          <div className="flex flex-col items-center gap-0 py-0.5 w-full relative">
            <div className="h-3 w-px" style={{ backgroundColor: `${C.vendor}30` }} />
            <div
              className="rounded-xl border-2 p-3 pb-4 w-full flex items-center justify-center relative pt-5"
              style={{
                borderColor: `${C.vendor}60`,
                backgroundColor: `${C.vendor}20`,
              }}
            >
              {/* Docker badge */}
              <div
                className="absolute -top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border whitespace-nowrap"
                style={{
                  color: C.docker,
                  borderColor: `${C.docker}40`,
                  backgroundColor: `${C.docker}15`,
                }}
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d={DOCKER_PATH} />
                </svg>
                Docker Container
              </div>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: C.vendor }}
              >
                Posit
              </span>
            </div>
            <div className="h-3 w-px" style={{ backgroundColor: `${C.vendor}30` }} />

            {/* ── Egress arrow originating from Posit ── */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full flex items-center gap-0 pl-0">
              {/* Line out */}
              <div className="h-px w-4" style={{ backgroundColor: `${C.egress}40` }} />
              {/* Entity Masking — vendor-owned, visible → vendor colour, no fill */}
              <div
                className="flex items-center gap-1 px-2 py-1 rounded-lg border-2 shrink-0"
                style={{ borderColor: `${C.vendor}50` }}
              >
                <svg className="h-2.5 w-2.5" style={{ color: C.vendor }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: C.vendor }}>
                  Entity Masking
                </span>
              </div>
              {/* Line + arrowhead */}
              <div className="h-px w-2" style={{ backgroundColor: `${C.egress}40` }} />
              <svg
                className="h-3 w-3 shrink-0"
                style={{ color: `${C.egress}70` }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              {/* Egress labels */}
              <div className="flex flex-col gap-0.5 pl-1.5 shrink-0">
                <span
                  className="text-[9px] font-bold uppercase tracking-wider"
                  style={{ color: C.egress }}
                >
                  Data Egress
                </span>
                {EGRESS_ITEMS.map((item) => (
                  <div key={item} className="flex items-center gap-1">
                    <div
                      className="h-1 w-1 rounded-full shrink-0"
                      style={{ backgroundColor: `${C.egress}80` }}
                    />
                    <span className="text-[8px] text-muted-foreground whitespace-nowrap">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Hard Risk Fuses — firm-owned, visible → firm colour, no fill */}
          <FirmGate label="Hard Risk Fuses" />

          {/* 3 · Trading Parameters — firm-owned, visible → firm colour, no fill */}
          <FirmCard title="Trading Parameters" />
        </div>
      </div>

      {/* ── Bottom legend — subtle, no border ── */}
      <div className="flex items-center justify-center gap-8 pt-1">
        {/* Ownership pair */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-6 rounded border-2" style={{ borderColor: `${C.firm}50` }} />
            <span className="text-[9px] text-muted-foreground">Firm-owned</span>
          </div>
          <span className="text-[9px] text-muted-foreground/40">/</span>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-6 rounded border-2" style={{ borderColor: `${C.vendor}50` }} />
            <span className="text-[9px] text-muted-foreground">Vendor-provided</span>
          </div>
        </div>

        <div className="h-3 w-px bg-muted-foreground/20" />

        {/* Visibility pair */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-6 rounded border-2" style={{ borderColor: `${C.vendor}50` }} />
            <span className="text-[9px] text-muted-foreground">Visible</span>
          </div>
          <span className="text-[9px] text-muted-foreground/40">/</span>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-6 rounded border-2" style={{ borderColor: `${C.vendor}60`, backgroundColor: `${C.vendor}20` }} />
            <span className="text-[9px] text-muted-foreground">Protected</span>
          </div>
        </div>
      </div>
    </div>
  );
}
