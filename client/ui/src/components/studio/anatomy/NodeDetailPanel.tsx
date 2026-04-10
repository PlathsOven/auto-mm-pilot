import type { TransformParam, TransformStep } from "../../../types";
import type { StepKey } from "./anatomyGraph";
import { PIPELINE_NARRATIVE } from "./anatomyGraph";

export type AnatomySelection =
  | { kind: "transform"; stepKey: StepKey }
  | { kind: "none" };

interface Props {
  selection: AnatomySelection;
  steps: Record<string, TransformStep> | null;
  savingKey: string | null;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
  onClose: () => void;
}

/**
 * Right-side inspector panel for the Anatomy canvas.
 *
 * Only mounted when a transform node is selected — default Anatomy has no
 * side panels at all. Stream nodes open the left StreamSidebar instead.
 *
 * Hosts the implementation picker + parameter editor (lifted from the old
 * PipelineStepCard) plus the "Show me the math" formula disclosure.
 */
export function NodeDetailPanel({
  selection,
  steps,
  savingKey,
  onSelectTransform,
  onParamChange,
  onClose,
}: Props) {
  if (selection.kind !== "transform") return null;
  const step = steps?.[selection.stepKey];
  if (!step) return null;

  return (
    <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-black/[0.08] bg-white/45 p-4">
      <TransformDetail
        stepKey={selection.stepKey}
        step={step}
        saving={savingKey === selection.stepKey}
        onSelectTransform={onSelectTransform}
        onParamChange={onParamChange}
        onClose={onClose}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Transform detail (implementation picker + param editor)
// ---------------------------------------------------------------------------

function TransformDetail({
  stepKey,
  step,
  saving,
  onSelectTransform,
  onParamChange,
  onClose,
}: {
  stepKey: StepKey;
  step: TransformStep;
  saving: boolean;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
  onClose: () => void;
}) {
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

// ---------------------------------------------------------------------------
// Schema-driven param input (lifted verbatim from the old PipelineStepCard)
// ---------------------------------------------------------------------------

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
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-mm-text-dim">{param.name}</span>
        <input
          type="number"
          value={value != null ? String(value) : ""}
          step={param.type === "int" ? 1 : "any"}
          min={param.min ?? undefined}
          max={param.max ?? undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(param.name, param.default);
              return;
            }
            onChange(
              param.name,
              param.type === "int" ? parseInt(raw, 10) : parseFloat(raw),
            );
          }}
          className="form-input font-mono"
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-mm-text-dim">{param.name}</span>
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(param.name, e.target.value)}
        className="form-input font-mono"
      />
    </label>
  );
}
