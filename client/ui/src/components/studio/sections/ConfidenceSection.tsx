import type { ReactNode } from "react";
import { useTransforms } from "../../../providers/TransformsProvider";
import { useActivePositionSizing } from "../../../hooks/useActivePositionSizing";
import type { ConfidenceDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";

interface Props {
  value: ConfidenceDraft;
  onChange: (next: ConfidenceDraft) => void;
  state: SectionState;
  expanded?: boolean;
  nav?: ReactNode;
}

const ANCHORS = [
  { value: 0.1, label: "Extremely confident" },
  { value: 1.0, label: "Baseline" },
  { value: 10.0, label: "Speculative" },
];

const SLIDER_MIN = 0.1;
const SLIDER_MAX = 10;
const LOG_MIN = Math.log(SLIDER_MIN);
const LOG_MAX = Math.log(SLIDER_MAX);

// Tolerance for highlighting an anchor label as "active" — relative to the
// anchor value, since absolute tolerance doesn't scale across 0.1 → 10.
const ANCHOR_MATCH_RELATIVE = 0.02;

/**
 * Log scale so the baseline (1.0) sits exactly at the midpoint between
 * 0.1 and 10 — each step is a 10× factor, matching how the architect
 * perceives confidence (multiplicative, not additive).
 */
function logPct(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const clamped = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, v));
  return ((Math.log(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100;
}

/** Slider's raw input value — Math.log(var_fair_ratio), clamped to display range. */
function toSliderRaw(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return LOG_MIN;
  return Math.log(Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, v)));
}

/**
 * Confidence is expressed as a `var_fair_ratio` — variance per unit fair value.
 * Lower values mean higher confidence (less variance for the same edge).
 */
export function ConfidenceSection({ value, onChange, state, expanded, nav }: Props) {
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
      expanded={expanded}
      nav={nav}
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
            regardless of label text width. A small gutter at each end
            (±6%) keeps the first/last label from clipping past the track. */}
        <div className="relative pb-12">
          <input
            type="range"
            min={LOG_MIN}
            max={LOG_MAX}
            step={0.001}
            value={toSliderRaw(value.var_fair_ratio)}
            onChange={(e) => {
              const raw = parseFloat(e.target.value);
              // Round to 3 significant figures so typed values don't end
              // up like 1.0000000000000002 after log → exp → log roundtrips.
              const next = Number.parseFloat(Math.exp(raw).toPrecision(3));
              onChange({ var_fair_ratio: next });
            }}
            className="w-full accent-mm-accent"
          />
          <div className="pointer-events-none absolute inset-x-0 top-4 h-10">
            {ANCHORS.map((a) => {
              const pct = logPct(a.value);
              const active = Math.abs(value.var_fair_ratio - a.value) < a.value * ANCHOR_MATCH_RELATIVE;
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
                  <div className="tabular-nums text-[10px]">{a.value.toFixed(1)}</div>
                  <div className="whitespace-nowrap text-[9px]">{a.label}</div>
                </button>
              );
            })}
          </div>
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
