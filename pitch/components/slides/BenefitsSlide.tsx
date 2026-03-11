"use client";

import { Clock, Brain, Database, Settings, Eye, Users } from "lucide-react";
import { ReactNode } from "react";

// ============================================================
// Benefit cards data
// ============================================================

interface BenefitCard {
  header: string;
  icon: ReactNode;
  points: string[];
}

const BENEFITS: BenefitCard[] = [
  {
    header: "24/7 coverage, not 10/6",
    icon: <Clock className="h-5 w-5" />,
    points: [
      "Higher Edge Capture",
      "Higher Sharpe from active risk management overnight",
      "Saves valuable trader time",
    ],
  },
  {
    header: "Citadel-style trading",
    icon: <Brain className="h-5 w-5" />,
    points: [
      "Improve day retention by providing orthogonal opinions",
      "Maintain positive edge retention overnight",
    ],
  },
  {
    header: "Perfect memory",
    icon: <Database className="h-5 w-5" />,
    points: [
      "Trader skill becomes Gravity Team IP",
      "Builds database of trading experience",
      "New hires trained faster",
    ],
  },
  {
    header: "Explanations and feedback",
    icon: <Settings className="h-5 w-5" />,
    points: ["Trades the Gravity Team way", "Confidence in decisions", "Orthogonal perspectives for team improvement"],
  },
  {
    header: "100% attention",
    icon: <Eye className="h-5 w-5" />,
    points: [
      "Captures opportunities instantly",
      "Reacts to risks quickly",
    ],
  },
  {
    header: "Built for Gravity Team",
    icon: <Users className="h-5 w-5" />,
    points: [
      "First to access APT",
      "Shape development direction",
    ],
  },
];

// ============================================================
// Main slide
// ============================================================

export function BenefitsSlide() {
  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-3xl mx-auto">
      <p className="text-muted-foreground text-sm leading-relaxed text-center max-w-lg">
        Key advantages APT delivers to Gravity Team over conventional
        staffing.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
        {BENEFITS.map((card) => (
          <div
            key={card.header}
            className="rounded-xl border border-muted bg-accent/20 p-5 flex flex-col gap-3"
          >
            <div className="flex items-center gap-2.5 text-[var(--brand)]">
              {card.icon}
              <h3 className="text-sm font-semibold text-foreground">
                {card.header}
              </h3>
            </div>

            <ul className="flex flex-col gap-1.5 pl-1">
              {card.points.map((point) => (
                <li
                  key={point}
                  className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2"
                >
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

    </div>
  );
}
