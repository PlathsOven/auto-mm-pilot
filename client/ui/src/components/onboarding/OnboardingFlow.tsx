import { useEffect, useState, type ReactNode } from "react";
import { useOnboarding } from "../../providers/OnboardingProvider";
import { useMode } from "../../providers/ModeProvider";

const PIPELINE_STEPS = [
  "unit_conversion",
  "decay_profile",
  "temporal_fair_value",
  "variance",
  "aggregation",
  "position_sizing",
  "smoothing",
];

const MODES = [
  { label: "Studio", sub: "Build streams + pipeline" },
  { label: "Floor", sub: "Monitor positions" },
  { label: "Lens", sub: "Audit decisions" },
] as const;

interface OnboardingCard {
  id: string;
  label: string;
  /** If set, auto-advance this card after N ms. */
  autoAdvanceMs?: number;
  /** Heading + body text rendered by the shared primitive. */
  heading?: ReactNode;
  body?: ReactNode;
  /** Custom visual rendered between body and nav buttons. */
  visual?: ReactNode;
  /** CTA label for the Next button. Defaults to "Next". */
  ctaLabel?: string;
}

/**
 * First-launch onboarding overlay.
 *
 * Sequence is a flat data array walked by `CardShell`. Adding a card = one
 * entry in `CARDS`; no bespoke sub-components required.
 *
 * State persists in `localStorage.apt.onboarding.completed`. Re-openable
 * from the user menu or via cmd+K → "Replay onboarding tour".
 */
export function OnboardingFlow() {
  const { open, markCompleted } = useOnboarding();
  const { setMode } = useMode();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Auto-advance for cards that specify it
  useEffect(() => {
    if (!open) return;
    const card = CARDS[index];
    if (!card.autoAdvanceMs) return;
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, CARDS.length - 1)), card.autoAdvanceMs);
    return () => clearTimeout(t);
  }, [open, index]);

  if (!open) return null;

  const card = CARDS[index];
  const isFirst = index === 0;
  const isLast = index === CARDS.length - 1;

  const finish = () => {
    setMode("floor");
    markCompleted();
  };

  const next = () => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-[600px] max-w-[90vw] overflow-hidden rounded-2xl border border-mm-border/60 bg-mm-surface shadow-2xl shadow-black/60">
        <div className="flex flex-col px-8 py-8">
          {card.heading && (
            <h2 className="text-base font-semibold text-mm-accent">{card.heading}</h2>
          )}
          {card.body && <div className="mt-2 text-[11px] text-mm-text-dim">{card.body}</div>}
          {card.visual && <div className="my-5">{card.visual}</div>}

          {/* Nav buttons — hidden on auto-advance cards */}
          {!card.autoAdvanceMs && (
            <div className="flex items-center justify-between">
              {!isFirst ? (
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                  className="text-[10px] text-mm-text-dim hover:text-mm-text"
                >
                  ← Back
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={next}
                className="rounded-lg bg-mm-accent px-5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90"
              >
                {card.ctaLabel ?? "Next"}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-mm-border/40 bg-mm-bg/40 px-4 py-2 text-[10px] text-mm-text-dim">
          <span>{card.label}</span>
          <button
            type="button"
            onClick={finish}
            className="rounded px-2 py-0.5 transition-colors hover:bg-mm-border/30 hover:text-mm-text"
          >
            Skip onboarding
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

const CARDS: OnboardingCard[] = [
  {
    id: "splash",
    label: "Welcome",
    autoAdvanceMs: 3000,
    visual: (
      <div className="flex flex-col items-center text-center">
        <p className="text-sm text-mm-text-dim">Welcome to APT</p>
        <p className="mt-3 text-base leading-relaxed text-mm-text">
          APT turns ideas into positions through one configurable equation.
        </p>
        <p className="mt-6 text-3xl font-semibold text-mm-accent">P = E·B / V</p>
        <p className="mt-2 text-[11px] text-mm-text-dim">
          Position = Edge × Bankroll / Variance
        </p>
      </div>
    ),
  },
  {
    id: "streams",
    label: "Step 1 of 3 — Streams",
    heading: "You define streams.",
    body: (
      <>
        Realized vol, FOMC events, funding rates — anything you can quantify becomes a
        stream contributing a view on fair value.
      </>
    ),
    visual: (
      <div className="flex items-center justify-center gap-3 rounded-lg border border-mm-border/40 bg-mm-bg/40 p-6 text-center">
        <div className="text-[10px] text-mm-text-dim">CSV row</div>
        <div className="text-xl text-mm-accent">→</div>
        <svg viewBox="0 0 80 30" className="h-10 w-20">
          <polyline
            points="0,25 10,22 20,18 30,15 40,12 50,10 60,7 70,5 80,3"
            fill="none"
            stroke="#818cf8"
            strokeWidth="1.5"
          />
        </svg>
        <div className="text-[10px] text-mm-text-dim">curve</div>
      </div>
    ),
  },
  {
    id: "pipeline",
    label: "Step 2 of 3 — Pipeline",
    heading: "APT runs a 7-step pipeline you control.",
    body: (
      <>
        Every step is pluggable. Swap{" "}
        <code className="rounded bg-mm-bg-deep px-1 text-mm-accent">position_sizing</code> from
        Kelly to power-utility and watch positions adapt in real time.
      </>
    ),
    visual: (
      <div className="flex flex-wrap items-center justify-center gap-1 rounded-lg border border-mm-border/40 bg-mm-bg/40 p-3">
        {PIPELINE_STEPS.map((s, i) => (
          <span
            key={s}
            className="rounded border border-mm-border/40 bg-mm-bg-deep px-1.5 py-0.5 font-mono text-[9px] text-mm-text-dim"
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>
    ),
  },
  {
    id: "positions",
    label: "Step 3 of 3 — Positions",
    heading: "You see what your position should be — and why.",
    body: (
      <>
        Floor shows live positions. Hover any cell for stream attribution. Click to investigate
        with the LLM. Open Lens for full decomposition.
      </>
    ),
    visual: (
      <div className="rounded-lg border border-mm-border/40 bg-mm-bg/40 p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded bg-mm-accent/10 p-2 text-[10px] text-mm-accent">+12,500</div>
          <div className="rounded bg-mm-bg-deep p-2 text-[10px] text-mm-text-dim">+4,200</div>
          <div className="rounded bg-mm-error/10 p-2 text-[10px] text-mm-error">−6,800</div>
        </div>
        <p className="mt-2 text-center text-[9px] text-mm-text-dim">
          Each cell = one (asset, expiry) pair
        </p>
      </div>
    ),
  },
  {
    id: "tour",
    label: "Mode tour",
    heading: "Three modes, three roles.",
    body: (
      <>
        Switch between them in the top bar (or with{" "}
        <code className="rounded bg-mm-bg-deep px-1 text-mm-accent">⌘K</code>).
      </>
    ),
    ctaLabel: "Drop me into Floor →",
    visual: (
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((m) => (
          <div
            key={m.label}
            className="rounded-lg border border-mm-border/40 bg-mm-bg/40 p-3 text-center"
          >
            <div className="text-xs font-semibold text-mm-accent">{m.label}</div>
            <div className="mt-1 text-[9px] text-mm-text-dim">{m.sub}</div>
          </div>
        ))}
      </div>
    ),
  },
];
