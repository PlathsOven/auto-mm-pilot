import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

interface BaseFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  /** When set, the label advertises the field's requirement:
   *  `true` → red asterisk; `false` → greyed "(optional)". When omitted
   *  the label renders plain (matches legacy call sites). */
  required?: boolean;
  /** When true, keystrokes are held in a local buffer and only emitted on
   *  commit (Enter for single-line, ↵ button for textarea). Blur and Escape
   *  revert the buffer. Empty/invalid number commits are no-ops so the input
   *  can be fully backspaced without saving. Default false preserves the
   *  legacy instant-commit behavior for existing consumers. */
  committable?: boolean;
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
    if (props.committable) {
      return <CommittableNumber {...props} disabledCls={disabledCls} />;
    }
    return <LegacyNumberInput {...props} disabledCls={disabledCls} />;
  }

  if (props.type === "textarea") {
    if (props.committable) {
      return <CommittableTextarea {...props} disabledCls={disabledCls} />;
    }
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

  if (props.committable) {
    return <CommittableText {...props} disabledCls={disabledCls} />;
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

// ---------------------------------------------------------------------------
// Commit-on-confirm primitives.
//
// Shared pattern: a local `buffer` mirrors what the user has typed. The
// parent's `value` is only overwritten on commit (Enter for single-line
// inputs; the inline ↵ button for textarea — Enter in textarea stays a
// newline). Blur and Escape revert the buffer to the last committed `value`
// so abandoned edits disappear. Empty/unparseable number buffers are no-ops
// on commit so the field can be fully backspaced without writing 0.
//
// Exported so the anatomy side panel's transform-parameter editor can share
// the same pattern without re-implementing it.
// ---------------------------------------------------------------------------

interface CommittableTextPrimitiveProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  className?: string;
}

export function CommittableText(
  props: CommittableTextPrimitiveProps & { disabledCls?: string },
) {
  const { value, onChange } = props;
  const [buffer, setBuffer] = useState(value);
  const lastSyncedRef = useRef(value);

  useEffect(() => {
    if (value !== lastSyncedRef.current) {
      setBuffer(value);
      lastSyncedRef.current = value;
    }
  }, [value]);

  const isDirty = buffer !== value;

  const commit = () => {
    if (!isDirty) return;
    lastSyncedRef.current = buffer;
    onChange(buffer);
  };

  const revert = () => {
    setBuffer(value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      revert();
    }
  };

  return (
    <input
      type="text"
      value={buffer}
      disabled={props.disabled}
      placeholder={props.placeholder}
      onChange={(e) => setBuffer(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={revert}
      className={`form-input ${props.mono ? "font-mono" : ""} ${isDirty ? "ring-1 ring-mm-accent/60" : ""} ${props.disabledCls ?? ""} ${props.className ?? ""}`}
    />
  );
}

interface CommittableNumberPrimitiveProps {
  value: number;
  onChange: (v: number) => void;
  step?: number | "any";
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}

export function CommittableNumber(
  props: CommittableNumberPrimitiveProps & { disabledCls?: string },
) {
  const { value, onChange } = props;
  const [buffer, setBuffer] = useState(() => formatNumberForInput(value));
  const lastSyncedRef = useRef(value);

  useEffect(() => {
    if (value !== lastSyncedRef.current) {
      setBuffer(formatNumberForInput(value));
      lastSyncedRef.current = value;
    }
  }, [value]);

  const canonical = formatNumberForInput(value);
  const isDirty = buffer !== canonical;
  const parsed = parseFloat(buffer);

  const commit = () => {
    if (!isDirty) return;
    if (!Number.isFinite(parsed)) return;
    lastSyncedRef.current = parsed;
    onChange(parsed);
  };

  const revert = () => {
    setBuffer(canonical);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      revert();
    }
  };

  return (
    <input
      type="number"
      step={props.step ?? "any"}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      value={buffer}
      onChange={(e) => setBuffer(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={revert}
      className={`form-input font-mono ${isDirty ? "ring-1 ring-mm-accent/60" : ""} ${props.disabledCls ?? ""} ${props.className ?? ""}`}
    />
  );
}

interface CommittableTextareaPrimitiveProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  disabled?: boolean;
}

export function CommittableTextarea(
  props: CommittableTextareaPrimitiveProps & { disabledCls?: string },
) {
  const { value, onChange } = props;
  const [buffer, setBuffer] = useState(value);
  const lastSyncedRef = useRef(value);

  useEffect(() => {
    if (value !== lastSyncedRef.current) {
      setBuffer(value);
      lastSyncedRef.current = value;
    }
  }, [value]);

  const isDirty = buffer !== value;

  const commit = () => {
    if (!isDirty) return;
    lastSyncedRef.current = buffer;
    onChange(buffer);
  };

  const revert = () => {
    setBuffer(value);
  };

  return (
    <div className="relative">
      <textarea
        value={buffer}
        disabled={props.disabled}
        placeholder={props.placeholder}
        rows={props.rows ?? 3}
        spellCheck={false}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            revert();
          }
        }}
        onBlur={revert}
        className={`form-input resize-y ${props.mono ? "font-mono" : ""} ${isDirty ? "ring-1 ring-mm-accent/60" : ""} ${props.disabledCls ?? ""}`}
      />
      {isDirty && !props.disabled && (
        <button
          type="button"
          // mousedown preventDefault keeps focus on the textarea so the
          // onBlur-revert handler doesn't fire before the click commits.
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className="absolute bottom-1.5 right-1.5 rounded-md bg-mm-accent px-1.5 py-0.5 text-[9px] font-medium text-white shadow-sm transition-colors hover:opacity-90"
          title="Confirm"
        >
          ↵ Save
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy instant-commit number input retained for BlockDrawer / BlockInspector
// which rely on the original draft-on-keystroke behavior. New call sites
// should set `committable` on <Field/> instead.
// ---------------------------------------------------------------------------

function LegacyNumberInput(props: NumberFieldProps & { disabledCls: string }) {
  const [text, setText] = useState(() => formatNumberForInput(props.value));
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
