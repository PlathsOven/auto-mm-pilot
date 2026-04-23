import { useTransforms } from "../../../providers/TransformsProvider";
import type { BlockShapeDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";
import { formatNumber } from "../../../utils";
import { ConnectorLockedHint } from "./TargetMappingSection";

interface Props {
  value: BlockShapeDraft;
  onChange: (next: BlockShapeDraft) => void;
  state: SectionState;
  readOnly?: boolean;
}

const SAMPLE_MINUTES = 60;

/**
 * Decay-curve sparkline driven by the active `decay_profile` transform.
 *
 * Profiles supported here visually: linear, exponential, sigmoid, step.
 * Falls back to linear if the active profile name is unknown.
 *
 * Returns size multiplier (0..1) at each minute 0..SAMPLE_MINUTES-1.
 * Caller maps that onto the y-axis as `1 * mult` (starts at 1, decays to
 * `decay_end_size_mult`).
 */
function decaySeries(
  profile: string,
  endMult: number,
  ratePerMin: number,
): number[] {
  const pts: number[] = [];
  for (let m = 0; m < SAMPLE_MINUTES; m++) {
    let mult: number;
    switch (profile) {
      case "exponential":
        mult = endMult + (1 - endMult) * Math.exp(-ratePerMin * m * 5);
        break;
      case "sigmoid": {
        const k = 10 * ratePerMin;
        mult = endMult + (1 - endMult) / (1 + Math.exp(k * (m - SAMPLE_MINUTES / 2)));
        break;
      }
      case "step":
        mult = m < SAMPLE_MINUTES * (1 - ratePerMin * 10) ? 1 : endMult;
        break;
      case "linear":
      default:
        mult = Math.max(endMult, 1 - ratePerMin * m * 5);
        break;
    }
    pts.push(mult);
  }
  return pts;
}

// SVG layout — hoisted from magic numbers so the preview geometry is
// readable at a glance.
const SVG = {
  width: 300,
  height: 120,
  padLeft: 44,
  padRight: 10,
  padTop: 10,
  padBottom: 22,
} as const;

export function BlockShapeSection({ value, onChange, state, readOnly = false }: Props) {
  const { steps } = useTransforms();
  const decayProfile = steps?.decay_profile?.selected ?? "linear";
  const series = decaySeries(decayProfile, value.decay_end_size_mult, value.decay_rate_prop_per_min);

  const patch = <K extends keyof BlockShapeDraft>(k: K, v: BlockShapeDraft[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <SectionCard
      title="Block Shape"
      number={4}
      status={state.status}
      message={state.message}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] text-mm-text-dim">
        <span>Decay profile</span>
        <code className="rounded bg-mm-accent/10 px-1.5 py-0.5 font-mono text-mm-accent">
          {decayProfile}
        </code>
      </div>
      {readOnly && <ConnectorLockedHint />}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <Field
          type="toggle"
          label="Annualized"
          disabled={readOnly}
          value={value.annualized}
          onChange={(v) => patch("annualized", v)}
        />
        <Field
          type="select"
          label="Temporal position"
          required
          disabled={readOnly}
          value={value.temporal_position}
          options={["static", "shifting"]}
          onChange={(v) => patch("temporal_position", v as "static" | "shifting")}
        />
        <Field
          type="number"
          label="decay_end_size_mult"
          required
          committable
          disabled={readOnly}
          value={value.decay_end_size_mult}
          onChange={(v) => patch("decay_end_size_mult", v)}
        />
        <Field
          type="number"
          label="decay_rate_prop_per_min"
          required
          committable
          disabled={readOnly}
          value={value.decay_rate_prop_per_min}
          onChange={(v) => patch("decay_rate_prop_per_min", v)}
        />
      </div>

      <BlockPreview
        series={series}
        endMult={value.decay_end_size_mult}
        decayProfile={decayProfile}
      />
    </SectionCard>
  );
}

/** Axis-labelled preview of the block over the next `SAMPLE_MINUTES`.
 *  - x-axis: time in minutes (0 = now = block start, SAMPLE_MINUTES = end)
 *  - y-axis: size multiplier (starts at 1, ends at `decay_end_size_mult`).
 */
function BlockPreview({
  series,
  endMult,
  decayProfile,
}: {
  series: number[];
  endMult: number;
  decayProfile: string;
}) {
  const startLabel = "fixed";
  const plotW = SVG.width - SVG.padLeft - SVG.padRight;
  const plotH = SVG.height - SVG.padTop - SVG.padBottom;

  // Values span [min(endMult, 1), max(endMult, 1)] so the curve fits even
  // when decay_end_size_mult is > 1.
  const yMin = Math.min(endMult, 1, 0);
  const yMax = Math.max(endMult, 1);
  const yRange = yMax - yMin || 1;

  const xAt = (i: number) => SVG.padLeft + (i / (series.length - 1)) * plotW;
  const yAt = (v: number) => SVG.padTop + plotH - ((v - yMin) / yRange) * plotH;

  const polyline = series.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");

  // Axis tick positions for start (0 min) and end (SAMPLE_MINUTES) on x,
  // start value (1.0) and end value (endMult) on y.
  const xStart = xAt(0);
  const xEnd = xAt(series.length - 1);
  const yStart = yAt(1);
  const yEnd = yAt(endMult);

  return (
    <div className="mt-3 rounded-md border border-black/[0.06] bg-black/[0.03] p-2">
      <div className="mb-1 flex items-baseline justify-between text-[10px] text-mm-text-dim">
        <span>Block over the next hour</span>
        <span className="text-mm-accent">{decayProfile}</span>
      </div>
      <svg
        viewBox={`0 0 ${SVG.width} ${SVG.height}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
      >
        {/* Axes */}
        <line
          x1={SVG.padLeft}
          y1={SVG.padTop}
          x2={SVG.padLeft}
          y2={SVG.height - SVG.padBottom}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="0.8"
        />
        <line
          x1={SVG.padLeft}
          y1={SVG.height - SVG.padBottom}
          x2={SVG.width - SVG.padRight}
          y2={SVG.height - SVG.padBottom}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="0.8"
        />

        {/* Dashed reference lines at start/end y-values */}
        <line
          x1={SVG.padLeft}
          y1={yStart}
          x2={SVG.width - SVG.padRight}
          y2={yStart}
          stroke="rgba(0,0,0,0.12)"
          strokeDasharray="2 2"
          strokeWidth="0.5"
        />
        <line
          x1={SVG.padLeft}
          y1={yEnd}
          x2={SVG.width - SVG.padRight}
          y2={yEnd}
          stroke="rgba(0,0,0,0.12)"
          strokeDasharray="2 2"
          strokeWidth="0.5"
        />

        {/* Curve */}
        <polyline points={polyline} fill="none" stroke="#4f5bd5" strokeWidth="1.4" />

        {/* Start / end markers on the curve */}
        <circle cx={xStart} cy={yStart} r="2" fill="#4f5bd5" />
        <circle cx={xEnd} cy={yEnd} r="2" fill="#4f5bd5" />

        {/* Y-axis labels (start + end values) */}
        <text
          x={SVG.padLeft - 4}
          y={yStart}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize="9"
          fill="rgba(0,0,0,0.7)"
        >
          {startLabel}
        </text>
        <text
          x={SVG.padLeft - 4}
          y={yEnd}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize="9"
          fill="rgba(0,0,0,0.7)"
        >
          {formatNumber(endMult, 3)}
        </text>

        {/* X-axis labels (block start + block end) */}
        <text
          x={xStart}
          y={SVG.height - SVG.padBottom + 12}
          textAnchor="start"
          fontSize="9"
          fill="rgba(0,0,0,0.7)"
        >
          0 min (start)
        </text>
        <text
          x={xEnd}
          y={SVG.height - SVG.padBottom + 12}
          textAnchor="end"
          fontSize="9"
          fill="rgba(0,0,0,0.7)"
        >
          {SAMPLE_MINUTES} min
        </text>
      </svg>
    </div>
  );
}

