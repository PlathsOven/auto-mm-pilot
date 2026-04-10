import { useEffect, useState, type ReactNode } from "react";
import { useOnboarding } from "../../providers/OnboardingProvider";
import { useMode } from "../../providers/ModeProvider";

type HighlightKey = "all" | "streams" | "engine" | "positions" | "feedback";

interface OnboardingCard {
  id: string;
  label: string;
  /** Which pipeline region the shared diagram should highlight. */
  highlight: HighlightKey;
  heading: ReactNode;
  body: ReactNode;
  /** CTA label for the Next button. Defaults to "Next". */
  ctaLabel?: string;
}

/**
 * First-launch onboarding overlay.
 *
 * Every card shares one persistent pipeline diagram and walks the user through
 * its regions in order: inputs (streams) → engine → outputs (positions) →
 * feedback loop (you + LLM). The shared visual is the through-line; each card
 * only swaps heading, body, and which region is lit.
 *
 * State persists in `localStorage.apt.onboarding.completed`. Re-openable from
 * the command palette ("Replay onboarding tour" / "Explain APT").
 */
export function OnboardingFlow() {
  const { open, markCompleted } = useOnboarding();
  const { setMode } = useMode();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  if (!open) return null;

  const card = CARDS[index];
  const isFirst = index === 0;
  const isLast = index === CARDS.length - 1;

  const finish = () => {
    setMode("studio");
    markCompleted();
  };

  const next = () => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="relative w-[600px] max-w-[90vw] overflow-hidden rounded-xl border border-white/50 bg-white/85 shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.06]" style={{ backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)" }}>
        <div className="flex flex-col px-8 py-8">
          <h2 className="text-base font-semibold text-mm-accent">{card.heading}</h2>
          <div className="mt-2 text-xs leading-relaxed text-mm-text-dim">{card.body}</div>

          <div className="my-6">
            <PipelineDiagram highlight={card.highlight} />
          </div>

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
        </div>

        <div className="flex items-center justify-between border-t border-black/[0.06] bg-black/[0.03] px-4 py-2 text-[10px] text-mm-text-dim">
          <span>{card.label}</span>
          <button
            type="button"
            onClick={finish}
            className="rounded px-2 py-0.5 transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          >
            Skip onboarding
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline diagram (shared visual)
// ---------------------------------------------------------------------------

const ACCENT = "#4f5bd5"; // mm-accent
const DIM = "#3f3f46"; // mm-border, slightly lifted for visibility

/**
 * Four-region pipeline diagram: Streams → Engine → Positions, with a
 * You+LLM feedback loop closing the circle. Fixed 460×220 box. The `highlight`
 * prop selects which region(s) are lit; the rest dim.
 */
function PipelineDiagram({ highlight }: { highlight: HighlightKey }) {
  const isLit = (k: Exclude<HighlightKey, "all">) => highlight === "all" || highlight === k;
  const forwardLit = highlight === "all";
  const feedbackLit = highlight === "all" || highlight === "feedback";

  return (
    <div className="relative mx-auto h-[220px] w-[460px]">
      {/* SVG overlay for arrows (non-interactive). */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 460 220"
        fill="none"
      >
        <defs>
          <marker
            id="arrow-lit"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={ACCENT} />
          </marker>
          <marker
            id="arrow-dim"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DIM} />
          </marker>
        </defs>

        {/* Forward flow: Streams → Engine */}
        <line
          x1="120"
          y1="50"
          x2="168"
          y2="50"
          stroke={forwardLit ? ACCENT : DIM}
          strokeWidth="1.5"
          markerEnd={forwardLit ? "url(#arrow-lit)" : "url(#arrow-dim)"}
        />
        {/* Forward flow: Engine → Positions */}
        <line
          x1="290"
          y1="50"
          x2="338"
          y2="50"
          stroke={forwardLit ? ACCENT : DIM}
          strokeWidth="1.5"
          markerEnd={forwardLit ? "url(#arrow-lit)" : "url(#arrow-dim)"}
        />

        {/* Feedback loop: Positions bottom → down → left → You+LLM right edge */}
        <path
          d="M 400 80 L 400 190 L 292 190"
          stroke={feedbackLit ? ACCENT : DIM}
          strokeWidth="1.5"
          strokeDasharray="4,4"
          markerEnd={feedbackLit ? "url(#arrow-lit)" : "url(#arrow-dim)"}
        />
        {/* Feedback loop: You+LLM left edge → left → up → Streams bottom */}
        <path
          d="M 170 190 L 60 190 L 60 82"
          stroke={feedbackLit ? ACCENT : DIM}
          strokeWidth="1.5"
          strokeDasharray="4,4"
          markerEnd={feedbackLit ? "url(#arrow-lit)" : "url(#arrow-dim)"}
        />
      </svg>

      <DiagramBox label="Streams" sub="what you know" lit={isLit("streams")} left={0} top={20} />
      <DiagramBox label="Engine" sub="how it decides" lit={isLit("engine")} left={170} top={20} />
      <DiagramBox label="Positions" sub="what to hold" lit={isLit("positions")} left={340} top={20} />
      <DiagramBox
        label="You + LLM"
        sub="stay in the loop"
        lit={isLit("feedback")}
        left={170}
        top={160}
        dashed
      />
    </div>
  );
}

function DiagramBox({
  label,
  sub,
  lit,
  left,
  top,
  dashed = false,
}: {
  label: string;
  sub: string;
  lit: boolean;
  left: number;
  top: number;
  dashed?: boolean;
}) {
  const borderStyle = dashed ? "border-dashed" : "border-solid";
  const litCls = "border-mm-accent bg-mm-accent/10 text-mm-accent shadow-[0_0_16px_-4px_rgba(79,91,213,0.30)]";
  const dimCls = "border-black/[0.06] bg-black/[0.03] text-mm-text-dim opacity-40";
  return (
    <div
      className={`absolute flex h-[60px] w-[120px] flex-col items-center justify-center rounded-lg border transition-all duration-300 ${borderStyle} ${
        lit ? litCls : dimCls
      }`}
      style={{ left, top }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="mt-0.5 text-[9px] font-normal normal-case text-mm-text-dim">{sub}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

const CARDS: OnboardingCard[] = [
  {
    id: "intro",
    label: "Welcome",
    highlight: "all",
    heading: "Welcome to APT",
    body: <>APT turns ideas into positions through one configurable engine.</>,
  },
  {
    id: "streams",
    label: "Inputs — Streams",
    highlight: "streams",
    heading: "Start with what you know.",
    body: (
      <>
        Realized vol, FOMC, funding rates, historical IV, your own regime call — anything you can
        quantify becomes a stream, expressing a view on fair value. APT doesn&rsquo;t privilege any
        source.
      </>
    ),
  },
  {
    id: "engine",
    label: "Engine — Decision framework",
    highlight: "engine",
    heading: "Your judgment, formalized.",
    body: (
      <>
        The engine blends every stream into a single position decision — weighted by your
        confidence in each source and the uncertainty around each view. The work a senior trader
        does in their head, running continuously and consistently.
      </>
    ),
  },
  {
    id: "positions",
    label: "Outputs — Positions",
    highlight: "positions",
    heading: "See where your book should be.",
    body: (
      <>
        For each (asset, expiry) pair, APT shows the position you should hold — and which streams
        drove it. Every number traces back to the views that produced it.
      </>
    ),
  },
  {
    id: "feedback",
    label: "Feedback loop — You + LLM",
    highlight: "feedback",
    heading: "Stay in the loop.",
    body: (
      <>
        Disagree? Say so in plain English — <em>&ldquo;reduce BTC vol confidence&rdquo;</em>,{" "}
        <em>&ldquo;add a view for next week&rsquo;s CPI&rdquo;</em>,{" "}
        <em>&ldquo;freeze ETH near-dated exposure&rdquo;</em>. The LLM turns your judgment into
        engine parameters, and suggests improvements back when it spots something worth knowing.
      </>
    ),
    ctaLabel: "Drop me into the Studio →",
  },
];
