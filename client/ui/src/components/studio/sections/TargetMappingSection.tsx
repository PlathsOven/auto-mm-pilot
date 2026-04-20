import { useTransforms } from "../../../providers/TransformsProvider";
import type { TargetMappingDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";
import { formatNumber } from "../../../utils";

interface Props {
  value: TargetMappingDraft;
  onChange: (next: TargetMappingDraft) => void;
  state: SectionState;
}

/**
 * Schema-driven mapping editor.
 *
 * Reads the active `unit_conversion` transform from TransformsProvider and
 * renders fields for THAT transform's parameters. The Stream Canvas itself
 * stores the values in TargetMappingDraft (scale/offset/exponent), which
 * matches the existing `affine_power` shape used by the configure endpoint.
 */
export function TargetMappingSection({ value, onChange, state }: Props) {
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
    >
      <TransformBadge name={activeName} />
      <div className="mt-2 grid grid-cols-3 gap-3">
        <Field type="number" label="scale" required value={value.scale} onChange={(v) => patch("scale", v)} />
        <Field type="number" label="offset" required value={value.offset} onChange={(v) => patch("offset", v)} />
        <Field type="number" label="exponent" required value={value.exponent} onChange={(v) => patch("exponent", v)} />
      </div>

      <div className="mt-3 grid gap-2 rounded-md border border-black/[0.06] bg-black/[0.03] px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-mm-text-dim">Equation</span>
          <span className="text-[9px] text-mm-text-dim/80">target = f(raw)</span>
        </div>
        <Equation scale={value.scale} offset={value.offset} exponent={value.exponent} />
        <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="h-10 w-full opacity-80">
          <polyline points={points} fill="none" stroke="#4f5bd5" strokeWidth="0.6" />
        </svg>
      </div>
    </SectionCard>
  );
}

/** Render `target = scale · raw^exponent + offset` with live parameter
 *  substitution. Uses semantic `<sup>` for the exponent — no LaTeX dep. */
function Equation({
  scale,
  offset,
  exponent,
}: {
  scale: number;
  offset: number;
  exponent: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[12px] leading-tight text-mm-text">
      <span className="italic">target</span>
      <span className="text-mm-text-dim">=</span>
      <Num value={scale} />
      <span className="text-mm-text-dim">·</span>
      <span className="italic">raw</span>
      <sup className="-ml-0.5 text-[10px]">
        <Num value={exponent} />
      </sup>
      <span className="text-mm-text-dim">{offset >= 0 ? "+" : "−"}</span>
      <Num value={Math.abs(offset)} />
    </div>
  );
}

/** Small inline pill naming the active pipeline transform behind this
 *  section — replaces the old "Show me the math" disclosure. */
function TransformBadge({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-mm-text-dim">
      <span>Transform</span>
      <code className="rounded bg-mm-accent/10 px-1.5 py-0.5 font-mono text-mm-accent">
        {name}
      </code>
    </div>
  );
}

function Num({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <span className="text-mm-error">?</span>;
  return <span className="tabular-nums text-mm-accent">{formatNumber(value)}</span>;
}
