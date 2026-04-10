import { useTransforms } from "../../../providers/TransformsProvider";
import { useActivePositionSizing } from "../../../hooks/useActivePositionSizing";
import type { ConfidenceDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";

interface Props {
  value: ConfidenceDraft;
  onChange: (next: ConfidenceDraft) => void;
  state: SectionState;
  dimmed?: boolean;
}

const ANCHORS = [
  { value: 0.1, label: "Extremely confident" },
  { value: 1.0, label: "Confident" },
  { value: 5.0, label: "Speculative" },
  { value: 20.0, label: "Experimental" },
];

/**
 * Confidence is expressed as a `var_fair_ratio` — variance per unit fair value.
 * Lower values mean higher confidence (less variance for the same edge).
 */
export function ConfidenceSection({ value, onChange, state, dimmed }: Props) {
  const { steps } = useTransforms();
  const variance = steps?.variance?.selected ?? "fair_proportional";
  const positionSizing = useActivePositionSizing();

  // Position multiplier implied at the current var_fair_ratio.
  // For kelly: position ∝ 1/var, so multiplier = 1 / var_fair_ratio.
  // For power_utility: position ∝ 1/(γ·var), so multiplier = 1 / (γ · var_fair_ratio).
  let multiplier = NaN;
  if (positionSizing && Number.isFinite(value.var_fair_ratio) && value.var_fair_ratio > 0) {
    if (positionSizing.name === "kelly") {
      multiplier = 1 / value.var_fair_ratio;
    } else if (positionSizing.name === "power_utility") {
      const gamma =
        typeof positionSizing.params.risk_aversion === "number"
          ? (positionSizing.params.risk_aversion as number)
          : 2.0;
      multiplier = 1 / (gamma * value.var_fair_ratio);
    }
  }

  return (
    <SectionCard
      title="Confidence"
      number={6}
      status={state.status}
      message={state.message}
      dimmed={dimmed}
      mathDisclosure={
        <p>
          Active <code className="text-mm-accent">variance</code> = <strong>{variance}</strong>.
          The block's variance contribution is computed as <code>var_fair_ratio × |fair|</code> for
          fair-proportional, or as a constant for the constant variant. The position-sizing step
          then divides by total variance, so a lower ratio yields a larger position.
        </p>
      }
    >
      <div className="grid gap-3">
        <input
          type="range"
          min={0.05}
          max={20}
          step={0.05}
          value={value.var_fair_ratio}
          onChange={(e) => onChange({ var_fair_ratio: parseFloat(e.target.value) })}
          className="w-full accent-mm-accent"
        />
        <div className="flex items-baseline justify-between text-[10px] text-mm-text-dim">
          {ANCHORS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => onChange({ var_fair_ratio: a.value })}
              className={`rounded px-1.5 py-0.5 text-left transition-colors hover:text-mm-text ${
                Math.abs(value.var_fair_ratio - a.value) < 0.05
                  ? "text-mm-accent"
                  : "text-mm-text-dim"
              }`}
            >
              <div className="tabular-nums">{a.value.toFixed(1)}</div>
              <div className="text-[9px]">{a.label}</div>
            </button>
          ))}
        </div>

        <div className="flex items-baseline justify-between rounded-md border border-black/[0.06] bg-black/[0.03] px-3 py-2 text-[10px]">
          <span className="text-mm-text-dim">Current var_fair_ratio</span>
          <span className="font-mono text-mm-text">{value.var_fair_ratio.toFixed(3)}</span>
        </div>
        <div className="flex items-baseline justify-between rounded-md border border-black/[0.06] bg-black/[0.03] px-3 py-2 text-[10px]">
          <span className="text-mm-text-dim">Implied position multiplier</span>
          <span className="font-mono text-mm-accent">
            {Number.isFinite(multiplier) ? `${multiplier.toFixed(3)}×` : "—"}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
