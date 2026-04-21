import type { TransformParam, TransformStep } from "../../../types";
import type { StepKey } from "./anatomyGraph";
import { PIPELINE_NARRATIVE } from "./anatomyGraph";
import { CommittableNumber, CommittableText } from "../sections/Field";

interface TransformDetailProps {
  stepKey: StepKey;
  step: TransformStep;
  saving: boolean;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
  onClose: () => void;
}

/**
 * Right-panel editor for a pipeline transform step: implementation picker,
 * schema-driven param inputs, and the step's formula/contract panel.
 * Mounted by ``NodeDetailPanel`` when a transform node is focused.
 */
export function TransformDetail({
  stepKey,
  step,
  saving,
  onSelectTransform,
  onParamChange,
  onClose,
}: TransformDetailProps) {
  const selected = step.transforms.find((t) => t.name === step.selected);

  return (
    <section className="rounded-xl border border-black/[0.08] bg-black/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-mm-text">{step.label}</h3>
        <div className="flex items-center gap-2">
          {saving && <span className="text-[9px] text-mm-text-dim">saving…</span>}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <p className="mb-3 text-[10px] italic text-mm-text-dim">
        {PIPELINE_NARRATIVE[stepKey]}
      </p>

      <label className="mb-3 flex flex-col gap-1">
        <span className="text-[10px] font-medium text-mm-text-dim">Implementation</span>
        <select
          value={step.selected}
          onChange={(e) => onSelectTransform(stepKey, e.target.value)}
          className="form-input font-mono"
        >
          {step.transforms.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {selected?.description && (
        <p className="mb-3 text-[10px] leading-relaxed text-mm-text-dim">
          {selected.description}
        </p>
      )}

      {selected && selected.params.length > 0 && (
        <div className="mb-3 flex flex-col gap-2 border-t border-black/[0.04] pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Parameters
          </span>
          <div className="grid grid-cols-2 gap-2">
            {selected.params.map((param) => (
              <ParamInput
                key={param.name}
                param={param}
                value={step.params[param.name] ?? param.default}
                onChange={(name, val) => onParamChange(stepKey, name, val)}
              />
            ))}
          </div>
        </div>
      )}

      {selected?.formula && (
        <div className="mt-2 rounded-md border border-black/[0.06] bg-black/[0.03] p-2">
          <div className="text-[9px] uppercase tracking-wider text-mm-text-dim">Formula</div>
          <div className="mt-0.5 font-mono text-xs text-mm-accent">{selected.formula}</div>
        </div>
      )}

      <p
        className="mt-3 truncate border-t border-black/[0.04] pt-2 font-mono text-[9px] text-mm-text-dim"
        title={step.contract}
      >
        {step.contract}
      </p>
    </section>
  );
}

/** Schema-driven input for one ``TransformParam`` — switches on
 *  ``param.type`` to render a checkbox / select / numeric / text input. */
function ParamInput({
  param,
  value,
  onChange,
}: {
  param: TransformParam;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}) {
  if (param.type === "bool") {
    return (
      <label className="flex items-center gap-2 rounded-md border border-black/[0.06] bg-black/[0.03] px-2 py-1.5">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(param.name, e.target.checked)}
          className="h-3 w-3 accent-mm-accent"
        />
        <span className="text-[10px] text-mm-text-dim">{param.name}</span>
      </label>
    );
  }

  if (param.type === "str" && param.options && param.options.length > 0) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-mm-text-dim">{param.name}</span>
        <select
          value={String(value ?? param.default ?? "")}
          onChange={(e) => onChange(param.name, e.target.value)}
          className="form-input font-mono"
        >
          {param.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (param.type === "float" || param.type === "int") {
    const numericValue =
      typeof value === "number" && Number.isFinite(value)
        ? value
        : typeof param.default === "number"
          ? param.default
          : NaN;
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-mm-text-dim">{param.name}</span>
        <CommittableNumber
          value={numericValue}
          step={param.type === "int" ? 1 : "any"}
          min={param.min ?? undefined}
          max={param.max ?? undefined}
          onChange={(next) =>
            onChange(param.name, param.type === "int" ? Math.trunc(next) : next)
          }
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-mm-text-dim">{param.name}</span>
      <CommittableText
        value={String(value ?? "")}
        mono
        onChange={(next) => onChange(param.name, next)}
      />
    </label>
  );
}
