import { useTransforms } from "../../../providers/TransformsProvider";
import { useActivePositionSizing } from "../../../hooks/useActivePositionSizing";
import type { ConfidenceDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";

interface Props {
  value: ConfidenceDraft;
  onChange: (next: ConfidenceDraft) => void;
  state: SectionState;
}

const SLIDER_MIN = 0.01;
const SLIDER_MAX = 1.0;
const SLIDER_STEP = 0.01;

const ANCHORS = [
  { value: SLIDER_MIN, label: "Confident" },
  { value: SLIDER_MAX, label: "Speculative" },
];

// Tolerance for highlighting an anchor label as "active" — relative to the
// slider range so it scales if the bounds ever change.
const ANCHOR_MATCH_ABS = SLIDER_STEP / 2;

function linearPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const clamped = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, v));
  return ((clamped - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
}

/**
 * Confidence is expressed as a `var_fair_ratio` — variance per unit fair value.
 * Lower values mean higher confidence (less variance for the same edge).
 */
export function ConfidenceSection({ value, onChange, state }: Props) {
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
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] text-mm-text-dim">
        <span>Variance transform</span>
        <code className="rounded bg-mm-accent/10 px-1.5 py-0.5 font-mono text-mm-accent">
          {variance}
        </code>
      </div>
      <div className="grid gap-3">
        {/* The anchor labels are positioned absolutely at the slider's
            proportional value position so they line up with the track
            regardless of label text width. */}
        <div className="relative pb-12">
          <input
            type="range"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={SLIDER_STEP}
            value={Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, value.var_fair_ratio))}
            onChange={(e) => {
              const raw = parseFloat(e.target.value);
              // Round to 2dp to match the step resolution so floating-point
              // noise doesn't leak values like 0.30000000000000004.
              const next = Math.round(raw * 100) / 100;
              onChange({ var_fair_ratio: next });
            }}
            className="w-full accent-mm-accent"
          />
          <div className="pointer-events-none absolute inset-x-0 top-4 h-10">
            {ANCHORS.map((a) => {
              const pct = linearPct(a.value);
              const active = Math.abs(value.var_fair_ratio - a.value) < ANCHOR_MATCH_ABS;
              // First/last anchor hug the edges so their text doesn't
              // extend past the track.
              const isFirst = a === ANCHORS[0];
              const isLast = a === ANCHORS[ANCHORS.length - 1];
              const translate = isFirst
                ? "translateX(0)"
                : isLast
                  ? "translateX(-100%)"
                  : "translateX(-50%)";
              const textAlign = isFirst ? "text-left" : isLast ? "text-right" : "text-center";
              return (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => onChange({ var_fair_ratio: a.value })}
                  style={{ left: `${pct}%`, transform: translate }}
                  className={`pointer-events-auto absolute top-0 rounded px-1 py-0.5 ${textAlign} transition-colors hover:text-mm-text ${
                    active ? "text-mm-accent" : "text-mm-text-dim"
                  }`}
                >
                  <div className="tabular-nums text-[10px]">{a.value.toFixed(2)}</div>
                  <div className="whitespace-nowrap text-[9px]">{a.label}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-baseline justify-between rounded-md border border-black/[0.06] bg-black/[0.03] px-3 py-2 text-[10px]">
          <span className="text-mm-text-dim">Current var_fair_ratio</span>
          <span className="font-mono text-mm-text">{value.var_fair_ratio.toFixed(2)}</span>
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
