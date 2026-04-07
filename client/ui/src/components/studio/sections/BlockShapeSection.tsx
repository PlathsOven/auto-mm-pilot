import { useTransforms } from "../../../providers/TransformsProvider";
import type { BlockShapeDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";

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
        <ToggleField
          label="Annualized"
          value={value.annualized}
          onChange={(v) => onChange({ ...value, annualized: v })}
        />
        <SelectField
          label="Size type"
          value={value.size_type}
          options={["fixed", "relative"]}
          onChange={(v) => onChange({ ...value, size_type: v as "fixed" | "relative" })}
        />
        <SelectField
          label="Temporal position"
          value={value.temporal_position}
          options={["static", "shifting"]}
          onChange={(v) =>
            onChange({ ...value, temporal_position: v as "static" | "shifting" })
          }
        />
        <NumericField
          label="decay_end_size_mult"
          value={value.decay_end_size_mult}
          onChange={(v) => onChange({ ...value, decay_end_size_mult: v })}
        />
        <NumericField
          label="decay_rate_prop_per_min"
          value={value.decay_rate_prop_per_min}
          onChange={(v) => onChange({ ...value, decay_rate_prop_per_min: v })}
        />
      </div>

      <div className="mt-3 rounded-md border border-mm-border/40 bg-mm-bg-deep/60 p-2">
        <div className="mb-1 flex items-baseline justify-between text-[10px] text-mm-text-dim">
          <span>Block decay over the next hour</span>
          <span className="text-mm-accent">{decayProfile}</span>
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-16 w-full">
          <polyline points={polyline} fill="none" stroke="#818cf8" strokeWidth="1" />
        </svg>
      </div>
    </SectionCard>
  );
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border border-mm-border/40 bg-mm-bg/40 px-2 py-1.5">
      <span className="text-[10px] font-medium text-mm-text-dim">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          value ? "bg-mm-accent" : "bg-mm-border"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
            value ? "translate-x-[14px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-mm-text-dim">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="form-input"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumericField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-mm-text-dim">{label}</span>
      <input
        type="number"
        step="any"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        className="form-input font-mono"
      />
    </label>
  );
}
