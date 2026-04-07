import { useState } from "react";
import type { TransformParam, TransformStep } from "../../types";

interface Props {
  stepKey: string;
  stepNumber: number;
  step: TransformStep;
  active: boolean;
  saving: boolean;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
}

/**
 * One step in the visual pipeline composer.
 *
 * Renders the step number, name, currently-selected transform, and an
 * inline parameter editor auto-generated from the transform's introspected
 * `TransformParam` schema (the same schema previously used by
 * `TransformConfigPanel`, now lifted into this card).
 */
export function PipelineStepCard({
  stepKey,
  stepNumber,
  step,
  active,
  saving,
  onSelectTransform,
  onParamChange,
}: Props) {
  const [expanded, setExpanded] = useState(active);
  const selected = step.transforms.find((t) => t.name === step.selected);

  return (
    <article
      className={`flex flex-col gap-2 rounded-xl border bg-mm-bg/40 p-3 transition-colors ${
        active
          ? "border-mm-accent/60 ring-1 ring-mm-accent/30"
          : "border-mm-border/60 hover:border-mm-border"
      }`}
    >
      <header
        className="flex cursor-pointer items-start gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mm-bg-deep text-[10px] font-semibold text-mm-accent">
          {stepNumber}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-xs font-semibold text-mm-text">{step.label}</h4>
            <span className="rounded bg-mm-accent/15 px-1.5 py-0.5 text-[9px] font-mono text-mm-accent">
              {step.selected}
            </span>
            {saving && <span className="text-[9px] text-mm-text-dim">saving…</span>}
          </div>
          <p className="mt-0.5 truncate font-mono text-[9px] text-mm-text-dim">
            {step.contract}
          </p>
        </div>
        <span className="text-[10px] text-mm-text-dim">{expanded ? "▲" : "▼"}</span>
      </header>

      {expanded && (
        <div className="border-t border-mm-border/30 pt-2">
          {/* Implementation picker */}
          <label className="mb-2 flex items-center gap-2">
            <span className="w-24 text-[10px] font-medium text-mm-text-dim">Implementation</span>
            <select
              value={step.selected}
              onChange={(e) => onSelectTransform(stepKey, e.target.value)}
              className="form-input flex-1 font-mono"
            >
              {step.transforms.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {selected?.description && (
            <p className="mb-2 text-[10px] text-mm-text-dim">{selected.description}</p>
          )}

          {/* Auto-rendered parameter editor */}
          {selected && selected.params.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {selected.params.map((param: TransformParam) => (
                <ParamInput
                  key={param.name}
                  param={param}
                  value={step.params[param.name] ?? param.default}
                  onChange={(name, val) => onParamChange(stepKey, name, val)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Schema-driven param input (lifted from TransformConfigPanel)
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
      <label className="flex items-center gap-2 rounded-md border border-mm-border/40 bg-mm-bg/40 px-2 py-1.5">
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
