"use client";

import { Monitor } from "lucide-react";

export function IntroSlide() {
  return (
    <div className="flex flex-col items-center gap-10 w-full max-w-2xl mx-auto">
      <p className="text-muted-foreground text-base leading-relaxed text-center max-w-lg">
        An Automated Positional Trader for crypto options market-making desks.
        <br />
        <span className="text-foreground font-medium">
          24/7 Citadel-style positional trading at a fraction of the cost.
        </span>
      </p>

      <a
        href="https://auto-mm-pilot-afgd.vercel.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2.5 rounded-xl border border-[var(--brand)] bg-[var(--brand)]/10 px-6 py-3.5 text-sm font-semibold text-[var(--brand)] transition-colors hover:bg-[var(--brand)]/20"
      >
        <Monitor className="h-4 w-4" />
        Open APT Terminal Demo
      </a>

      <p className="text-xs text-muted-foreground/60">
        Live interactive demo with simulated market data
      </p>
    </div>
  );
}
