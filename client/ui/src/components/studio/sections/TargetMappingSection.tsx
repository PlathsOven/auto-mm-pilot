import { useTransforms } from "../../../providers/TransformsProvider";
import type { TargetMappingDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";

interface Props {
  value: TargetMappingDraft;
  onChange: (next: TargetMappingDraft) => void;
  state: SectionState;
  dimmed?: boolean;
}

/**
 * Schema-driven mapping editor.
 *
 * Reads the active `unit_conversion` transform from TransformsProvider and
 * renders fields for THAT transform's parameters. The Stream Canvas itself
 * stores the values in TargetMappingDraft (scale/offset/exponent), which
 * matches the existing `affine_power` shape used by the configure endpoint.
 */
export function TargetMappingSection({ value, onChange, state, dimmed }: Props) {
  const { steps } = useTransforms();
  const unit = steps?.unit_conversion;
  const activeName = unit?.selected ?? "affine_power";

  // Mini chart of target = f(raw) over a sample range
  const samples: { raw: number; target: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const raw = i / 5; // 0..6
    let target = value.scale * Math.pow(Math.max(raw, 1e-12), value.exponent) + value.offset;
    if (!Number.isFinite(target)) target = 0;
    samples.push({ raw, target });
  }
  const minT = Math.min(...samples.map((s) => s.target), 0);
  const maxT = Math.max(...samples.map((s) => s.target), 1);
  const range = maxT - minT || 1;
  const points = samples
    .map((s, i) => `${(i / (samples.length - 1)) * 100},${100 - ((s.target - minT) / range) * 100}`)
    .join(" ");

  return (
    <SectionCard
      title="Target Mapping"
      number={3}
      status={state.status}
      message={state.message}
      dimmed={dimmed}
      mathDisclosure={
        <p>
          Active <code className="text-mm-accent">unit_conversion</code> = <strong>{activeName}</strong>.
          Maps each raw row to a target-space value: <code>target = scale × raw^exponent + offset</code>.
        </p>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <NumericField
          label="scale"
          value={value.scale}
          onChange={(v) => onChange({ ...value, scale: v })}
        />
        <NumericField
          label="offset"
          value={value.offset}
          onChange={(v) => onChange({ ...value, offset: v })}
        />
        <NumericField
          label="exponent"
          value={value.exponent}
          onChange={(v) => onChange({ ...value, exponent: v })}
        />
      </div>

      <div className="mt-3 rounded-md border border-mm-border/40 bg-mm-bg-deep/60 p-2">
        <div className="mb-1 text-[10px] text-mm-text-dim">target = f(raw)</div>
        <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-12 w-full">
          <polyline
            points={points
              .split(" ")
              .map((p) => {
                const [x, y] = p.split(",");
                return `${x},${parseFloat(y) / 2}`;
              })
              .join(" ")}
            fill="none"
            stroke="#818cf8"
            strokeWidth="0.6"
          />
        </svg>
      </div>
    </SectionCard>
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
