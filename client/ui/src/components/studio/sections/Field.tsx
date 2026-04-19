import { useEffect, useRef, useState, type ReactNode } from "react";

interface BaseFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  /** When set, the label advertises the field's requirement:
   *  `true` → red asterisk; `false` → greyed "(optional)". When omitted
   *  the label renders plain (matches legacy call sites). */
  required?: boolean;
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
      <span className="text-[10px] font-medium text-mm-text-dim">
        {props.label}
        {props.required === true && (
          <span className="ml-0.5 text-mm-error" aria-hidden="true">*</span>
        )}
        {props.required === false && (
          <span className="ml-1 text-[9px] font-normal text-mm-text-dim/70">(optional)</span>
        )}
      </span>
      <FieldInput {...props} />
      {props.hint && !props.error && (
        <span className="text-[9px] text-mm-text-dim">{props.hint}</span>
      )}
      {props.error && <span className="text-[9px] text-mm-error">{props.error}</span>}
    </label>
  );
}

function FieldInput(props: FieldProps) {
  const disabled = props.disabled ?? false;
  const disabledCls = disabled ? "cursor-not-allowed opacity-50" : "";

  if (props.type === "toggle") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && props.onChange(!props.value)}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          props.value ? "bg-mm-accent" : "bg-mm-border"
        } ${disabledCls}`}
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
        disabled={disabled}
        onChange={(e) => props.onChange(e.target.value)}
        className={`form-input font-mono ${disabledCls}`}
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
    return <NumberInput {...props} disabledCls={disabledCls} />;
  }

  if (props.type === "textarea") {
    return (
      <textarea
        value={props.value}
        disabled={disabled}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 3}
        spellCheck={false}
        className={`form-input resize-y ${props.mono ? "font-mono" : ""} ${disabledCls}`}
      />
    );
  }

  return (
    <input
      type="text"
      value={props.value}
      disabled={disabled}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className={`form-input ${props.mono ? "font-mono" : ""} ${disabledCls}`}
    />
  );
}

/**
 * Number input with a local text buffer.
 *
 * The visible text is kept in component state so the user can freely clear
 * the field (empty string) or type a transient value like "-" or "1." while
 * editing — the parent draft is only updated when the text parses to a
 * finite number. On blur, an empty or unparseable value defaults to 0, so
 * downstream validation always sees a concrete number. That default "0" is
 * itself backspaceable because the text state is driven by the user, not
 * by the prop.
 */
function NumberInput(props: NumberFieldProps & { disabledCls: string }) {
  const [text, setText] = useState(() => formatNumberForInput(props.value));
  // Track the last value we emitted to the parent so we can distinguish an
  // external prop change (parent-driven reset) from the echo of our own
  // onChange — which would otherwise stomp the text the user is typing.
  const lastEmittedRef = useRef<number>(props.value);

  useEffect(() => {
    if (props.value === lastEmittedRef.current) return;
    if (Number.isFinite(props.value)) {
      const parsed = parseFloat(text);
      if (!Number.isFinite(parsed) || parsed !== props.value) {
        setText(formatNumberForInput(props.value));
      }
    }
    lastEmittedRef.current = props.value;
  }, [props.value, text]);

  const emit = (n: number) => {
    lastEmittedRef.current = n;
    props.onChange(n);
  };

  return (
    <input
      type="number"
      step={props.step ?? "any"}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = parseFloat(next);
        if (Number.isFinite(parsed)) emit(parsed);
      }}
      onBlur={() => {
        const parsed = parseFloat(text);
        if (!Number.isFinite(parsed)) {
          setText("0");
          emit(0);
        }
      }}
      className={`form-input font-mono ${props.disabledCls}`}
    />
  );
}

function formatNumberForInput(n: number): string {
  return Number.isFinite(n) ? String(n) : "";
}
