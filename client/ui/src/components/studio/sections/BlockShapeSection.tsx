import { useTransforms } from "../../../providers/TransformsProvider";
import type { BlockShapeDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";

interface Props {
  value: BlockShapeDraft;
  onChange: (next: BlockShapeDraft) => void;
  state: SectionState;
  dimmed?: boolean;
}

const SAMPLE_MINUTES = 60;

/**
 * Decay-curve sparkline driven by the active `decay_profile` transform.
 *
 * Profiles supported here visually: linear, exponential, sigmoid, step.
 * Falls back to linear if the active profile name is unknown.
 */
function decayPoints(
  profile: string,
  endMult: number,
  ratePerMin: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let m = 0; m < SAMPLE_MINUTES; m++) {
    const t = m / SAMPLE_MINUTES;
    let y: number;
    switch (profile) {
      case "exponential":
        y = endMult + (1 - endMult) * Math.exp(-ratePerMin * m * 5);
        break;
      case "sigmoid": {
        const k = 10 * ratePerMin;
        y = endMult + (1 - endMult) / (1 + Math.exp(k * (m - SAMPLE_MINUTES / 2)));
        break;
      }
      case "step":
        y = m < SAMPLE_MINUTES * (1 - ratePerMin * 10) ? 1 : endMult;
        break;
      case "linear":
      default:
        y = Math.max(endMult, 1 - ratePerMin * m * 5);
        break;
    }
    pts.push({ x: t * 100, y: 100 - y * 100 });
  }
  return pts;
}

export function BlockShapeSection({ value, onChange, state, dimmed }: Props) {
  const { steps } = useTransforms();
  const decayProfile = steps?.decay_profile?.selected ?? "linear";
  const points = decayPoints(decayProfile, value.decay_end_size_mult, value.decay_rate_prop_per_min);
  const polyline = points.map((p) => `${p.x},${Math.max(0, Math.min(100, p.y))}`).join(" ");

  const patch = <K extends keyof BlockShapeDraft>(k: K, v: BlockShapeDraft[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <SectionCard
      title="Block Shape"
      number={4}
      status={state.status}
      message={state.message}
      dimmed={dimmed}
      mathDisclosure={
        <p>
          Active <code className="text-mm-accent">decay_profile</code> = <strong>{decayProfile}</strong>.
          The block's effective size decays from 1.0 toward <code>decay_end_size_mult</code> at
          rate <code>decay_rate_prop_per_min</code> per minute.
        </p>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          type="toggle"
          label="Annualized"
          value={value.annualized}
          onChange={(v) => patch("annualized", v)}
        />
        <Field
          type="select"
          label="Size type"
          value={value.size_type}
          options={["fixed", "relative"]}
          onChange={(v) => patch("size_type", v as "fixed" | "relative")}
        />
        <Field
          type="select"
          label="Temporal position"
          value={value.temporal_position}
          options={["static", "shifting"]}
          onChange={(v) => patch("temporal_position", v as "static" | "shifting")}
        />
        <Field
          type="number"
          label="decay_end_size_mult"
          value={value.decay_end_size_mult}
          onChange={(v) => patch("decay_end_size_mult", v)}
        />
        <Field
          type="number"
          label="decay_rate_prop_per_min"
          value={value.decay_rate_prop_per_min}
          onChange={(v) => patch("decay_rate_prop_per_min", v)}
        />
      </div>

      <div className="mt-3 rounded-md border border-black/[0.06] bg-black/[0.03] p-2">
        <div className="mb-1 flex items-baseline justify-between text-[10px] text-mm-text-dim">
          <span>Block decay over the next hour</span>
          <span className="text-mm-accent">{decayProfile}</span>
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-16 w-full">
          <polyline points={polyline} fill="none" stroke="#4f5bd5" strokeWidth="1" />
        </svg>
      </div>
    </SectionCard>
  );
}
