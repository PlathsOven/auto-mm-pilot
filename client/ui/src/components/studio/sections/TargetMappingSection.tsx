import { useTransforms } from "../../../providers/TransformsProvider";
import type { TargetMappingDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";

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
  const activeName = steps?.unit_conversion?.selected ?? "affine_power";

  // Sample target = f(raw) over a small range to render a mini sparkline
  const samples = Array.from({ length: 30 }, (_, i) => {
    const raw = i / 5; // 0..6
    const target = value.scale * Math.pow(Math.max(raw, 1e-12), value.exponent) + value.offset;
    return { raw, target: Number.isFinite(target) ? target : 0 };
  });
  const minT = Math.min(...samples.map((s) => s.target), 0);
  const maxT = Math.max(...samples.map((s) => s.target), 1);
  const range = maxT - minT || 1;
  const points = samples
    .map((s, i) => `${(i / (samples.length - 1)) * 100},${50 - ((s.target - minT) / range) * 50}`)
    .join(" ");

  const patch = <K extends keyof TargetMappingDraft>(k: K, v: TargetMappingDraft[K]) =>
    onChange({ ...value, [k]: v });

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
        <Field type="number" label="scale" value={value.scale} onChange={(v) => patch("scale", v)} />
        <Field type="number" label="offset" value={value.offset} onChange={(v) => patch("offset", v)} />
        <Field type="number" label="exponent" value={value.exponent} onChange={(v) => patch("exponent", v)} />
      </div>

      <div className="mt-3 rounded-md border border-black/[0.06] bg-black/[0.03] p-2">
        <div className="mb-1 text-[10px] text-mm-text-dim">target = f(raw)</div>
        <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-12 w-full">
          <polyline points={points} fill="none" stroke="#4f5bd5" strokeWidth="0.6" />
        </svg>
      </div>
    </SectionCard>
  );
}
