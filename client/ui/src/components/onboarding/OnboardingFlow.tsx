import { useEffect, useState } from "react";
import { useOnboarding } from "../../providers/OnboardingProvider";
import { useMode } from "../../providers/ModeProvider";

type Step = "splash" | "card1" | "card2" | "card3" | "tour";

const PIPELINE_STEPS = [
  "unit_conversion",
  "decay_profile",
  "temporal_fair_value",
  "variance",
  "aggregation",
  "position_sizing",
  "smoothing",
];

/**
 * First-launch onboarding overlay.
 *
 * Sequence: 3-second splash → 3-card carousel → mode tour → drop into Floor.
 * State persists in `localStorage.apt.onboarding.completed`. Re-openable
 * from the user menu or via cmd+K → "Replay onboarding tour".
 */
export function OnboardingFlow() {
  const { open, markCompleted } = useOnboarding();
  const { setMode } = useMode();
  const [step, setStep] = useState<Step>("splash");

  // Auto-advance splash after 3s
  useEffect(() => {
    if (open && step === "splash") {
      const t = setTimeout(() => setStep("card1"), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, step]);

  // Reset to splash whenever the overlay opens
  useEffect(() => {
    if (open) setStep("splash");
  }, [open]);

  if (!open) return null;

  const finish = () => {
    setMode("floor");
    markCompleted();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-[600px] max-w-[90vw] overflow-hidden rounded-2xl border border-mm-border/60 bg-mm-surface shadow-2xl shadow-black/60">
        {step === "splash" && <SplashCard onAdvance={() => setStep("card1")} />}
        {step === "card1" && <Card1 onNext={() => setStep("card2")} onSkip={finish} />}
        {step === "card2" && <Card2 onNext={() => setStep("card3")} onBack={() => setStep("card1")} />}
        {step === "card3" && <Card3 onNext={() => setStep("tour")} onBack={() => setStep("card2")} />}
        {step === "tour" && <ModeTour onFinish={finish} />}

        <div className="flex items-center justify-between border-t border-mm-border/40 bg-mm-bg/40 px-4 py-2 text-[10px] text-mm-text-dim">
          <span>{stepLabel(step)}</span>
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

function stepLabel(step: Step): string {
  switch (step) {
    case "splash":
      return "Welcome";
    case "card1":
      return "Step 1 of 3 — Streams";
    case "card2":
      return "Step 2 of 3 — Pipeline";
    case "card3":
      return "Step 3 of 3 — Positions";
    case "tour":
      return "Mode tour";
  }
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function SplashCard({ onAdvance }: { onAdvance: () => void }) {
  return (
    <div className="flex flex-col items-center px-8 py-10 text-center">
      <p className="text-sm text-mm-text-dim">Welcome to APT</p>
      <p className="mt-3 text-base leading-relaxed text-mm-text">
        APT turns ideas into positions through one configurable equation.
      </p>
      <p className="mt-6 text-3xl font-semibold text-mm-accent">P = E·B / V</p>
      <p className="mt-2 text-[11px] text-mm-text-dim">Position = Edge × Bankroll / Variance</p>
      <button
        type="button"
        onClick={onAdvance}
        className="mt-8 rounded-lg bg-mm-accent px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-mm-accent/90"
      >
        Show me how
      </button>
    </div>
  );
}

function Card1({ onNext, onSkip: _onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col px-8 py-8">
      <h2 className="text-base font-semibold text-mm-accent">You define streams.</h2>
      <p className="mt-2 text-[11px] text-mm-text-dim">
        Realized vol, FOMC events, funding rates — anything you can quantify becomes a stream
        contributing a view on fair value.
      </p>
      <div className="my-5 flex items-center justify-center gap-3 rounded-lg border border-mm-border/40 bg-mm-bg/40 p-6 text-center">
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
      <button
        type="button"
        onClick={onNext}
        className="mt-2 self-end rounded-lg bg-mm-accent px-5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90"
      >
        Next
      </button>
    </div>
  );
}

function Card2({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col px-8 py-8">
      <h2 className="text-base font-semibold text-mm-accent">
        APT runs a 7-step pipeline you control.
      </h2>
      <p className="mt-2 text-[11px] text-mm-text-dim">
        Every step is pluggable. Swap{" "}
        <code className="rounded bg-mm-bg-deep px-1 text-mm-accent">position_sizing</code> from
        Kelly to power-utility and watch positions adapt in real time.
      </p>
      <div className="my-5 flex flex-wrap items-center justify-center gap-1 rounded-lg border border-mm-border/40 bg-mm-bg/40 p-3">
        {PIPELINE_STEPS.map((s, i) => (
          <span
            key={s}
            className="rounded border border-mm-border/40 bg-mm-bg-deep px-1.5 py-0.5 font-mono text-[9px] text-mm-text-dim"
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[10px] text-mm-text-dim hover:text-mm-text"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-lg bg-mm-accent px-5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Card3({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col px-8 py-8">
      <h2 className="text-base font-semibold text-mm-accent">
        You see what your position should be — and why.
      </h2>
      <p className="mt-2 text-[11px] text-mm-text-dim">
        Floor shows live positions. Hover any cell for stream attribution. Click to investigate
        with the LLM. Open Lens for full decomposition.
      </p>
      <div className="my-5 rounded-lg border border-mm-border/40 bg-mm-bg/40 p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded bg-mm-accent/10 p-2 text-[10px] text-mm-accent">+12,500</div>
          <div className="rounded bg-mm-bg-deep p-2 text-[10px] text-mm-text-dim">+4,200</div>
          <div className="rounded bg-mm-error/10 p-2 text-[10px] text-mm-error">−6,800</div>
        </div>
        <p className="mt-2 text-center text-[9px] text-mm-text-dim">
          Each cell = one (asset, expiry) pair
        </p>
      </div>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[10px] text-mm-text-dim hover:text-mm-text"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-lg bg-mm-accent px-5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ModeTour({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col px-8 py-8">
      <h2 className="text-base font-semibold text-mm-accent">Three modes, three roles.</h2>
      <p className="mt-2 text-[11px] text-mm-text-dim">
        Switch between them in the top bar (or with{" "}
        <code className="rounded bg-mm-bg-deep px-1 text-mm-accent">⌘K</code>).
      </p>
      <div className="my-5 grid grid-cols-3 gap-2">
        <ModeCard label="Studio" sub="Build streams + pipeline" />
        <ModeCard label="Floor" sub="Monitor positions" />
        <ModeCard label="Lens" sub="Audit decisions" />
      </div>
      <button
        type="button"
        onClick={onFinish}
        className="mt-2 self-end rounded-lg bg-mm-accent px-5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90"
      >
        Drop me into Floor →
      </button>
    </div>
  );
}

function ModeCard({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="rounded-lg border border-mm-border/40 bg-mm-bg/40 p-3 text-center">
      <div className="text-xs font-semibold text-mm-accent">{label}</div>
      <div className="mt-1 text-[9px] text-mm-text-dim">{sub}</div>
    </div>
  );
}
