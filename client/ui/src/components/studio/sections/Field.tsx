import type { ReactNode } from "react";

interface BaseFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
}

type TextFieldProps = BaseFieldProps & {
  type?: "text" | "textarea";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
};

type NumberFieldProps = BaseFieldProps & {
  type: "number";
  value: number;
  onChange: (v: number) => void;
  step?: number | "any";
  min?: number;
  max?: number;
};

type SelectFieldProps = BaseFieldProps & {
  type: "select";
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
};

type ToggleFieldProps = BaseFieldProps & {
  type: "toggle";
  value: boolean;
  onChange: (v: boolean) => void;
};

export type FieldProps =
  | TextFieldProps
  | NumberFieldProps
  | SelectFieldProps
  | ToggleFieldProps;

/**
 * Shared form field primitive for Stream Canvas sections.
 *
 * Provides a single visual treatment (label + input + hint + error) across
 * text, textarea, number, select, and toggle. Replaces the hand-rolled
 * `NumericField`, `SelectField`, `ToggleField` helpers that were duplicated
 * across TargetMappingSection and BlockShapeSection.
 */
export function Field(props: FieldProps) {
  return (
    <label className={`flex ${props.type === "toggle" ? "items-center justify-between rounded-md border border-black/[0.06] bg-black/[0.03] px-2 py-1.5" : "flex-col gap-1"}`}>
      <span className="text-[10px] font-medium text-mm-text-dim">{props.label}</span>
      <FieldInput {...props} />
      {props.hint && !props.error && (
        <span className="text-[9px] text-mm-text-dim">{props.hint}</span>
      )}
      {props.error && <span className="text-[9px] text-mm-error">{props.error}</span>}
    </label>
  );
}

function FieldInput(props: FieldProps) {
  if (props.type === "toggle") {
    return (
      <button
        type="button"
        onClick={() => props.onChange(!props.value)}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          props.value ? "bg-mm-accent" : "bg-mm-border"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
            props.value ? "translate-x-[14px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    );
  }

  if (props.type === "select") {
    return (
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="form-input font-mono"
      >
        {props.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (props.type === "number") {
    return (
      <input
        type="number"
        step={props.step ?? "any"}
        min={props.min}
        max={props.max}
        value={Number.isFinite(props.value) ? props.value : ""}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          props.onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        className="form-input font-mono"
      />
    );
  }

  if (props.type === "textarea") {
    return (
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 3}
        spellCheck={false}
        className={`form-input resize-y ${props.mono ? "font-mono" : ""}`}
      />
    );
  }

  return (
    <input
      type="text"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className={`form-input ${props.mono ? "font-mono" : ""}`}
    />
  );
}
