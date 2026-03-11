"use client";

import { Rocket, Crosshair, Radio, Handshake, RefreshCw } from "lucide-react";
import { ReactNode } from "react";

// ============================================================
// Timeline data
// ============================================================

interface Milestone {
  label: string;
  items: string[];
  icon: ReactNode;
  accent: string;
}

const MILESTONES: Milestone[] = [
  {
    label: "Immediate",
    items: ["APT development begins"],
    icon: <Rocket className="h-4 w-4" />,
    accent: "#f59e0b",
  },
  {
    label: "1 month",
    items: ["Desired position engine complete"],
    icon: <Crosshair className="h-4 w-4" />,
    accent: "#3b82f6",
  },
  {
    label: "2 months",
    items: ["Data stream integration complete", "Auxiliary features complete"],
    icon: <Radio className="h-4 w-4" />,
    accent: "#8b5cf6",
  },
  {
    label: "Trust earned",
    items: ["Parameter change integration", "Licensing fee transfer"],
    icon: <Handshake className="h-4 w-4" />,
    accent: "#22c55e",
  },
  {
    label: "Continuing iteration",
    items: ["Ongoing support", "Feedback incorporation"],
    icon: <RefreshCw className="h-4 w-4" />,
    accent: "#06b6d4",
  },
];

// ============================================================
// Main slide
// ============================================================

export function TimelineSlide() {
  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-2xl mx-auto">
      <p className="text-muted-foreground text-sm leading-relaxed text-center max-w-lg">
        A phased rollout that de-risks adoption — value delivered early, full
        autonomy unlocked incrementally.
      </p>

      {/* ── Vertical timeline ── */}
      <div className="relative w-full flex flex-col gap-0 pl-8">
        {/* Vertical line */}
        <div className="absolute left-[15px] top-3 bottom-3 w-px bg-muted" />

        {MILESTONES.map((m, i) => (
          <div key={m.label} className="relative flex items-start gap-5 py-5">
            {/* Dot */}
            <div
              className="absolute left-[-17px] top-5 h-3 w-3 rounded-full border-2 shrink-0 z-10"
              style={{
                borderColor: m.accent,
                backgroundColor: i === 0 ? m.accent : "var(--background)",
              }}
            />

            {/* Content */}
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <span style={{ color: m.accent }}>{m.icon}</span>
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: m.accent }}
                >
                  {m.label}
                </span>
              </div>
              <ul className="flex flex-col gap-1 mt-0.5">
                {m.items.map((item) => (
                  <li
                    key={item}
                    className="text-sm text-foreground/80 leading-relaxed flex items-start gap-2"
                  >
                    <span className="mt-2 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
