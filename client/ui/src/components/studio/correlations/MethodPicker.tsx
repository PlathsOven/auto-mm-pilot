import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ExpiryCorrelationMethodSchema,
} from "../../../types";
import { listExpiryCorrelationMethods } from "../../../services/correlationsApi";

interface Props {
  /** Current expiry universe (lex-sorted, canonical ISO). Apply disabled when
   *  fewer than 2 distinct expiries — the calculator needs at least one pair. */
  expiries: string[];
  /** Hook-provided callback — runs the method server-side and overwrites the
   *  draft slot. ``null`` → picker doesn't render (symbols matrix). */
  applyMethod: (
    methodName: string,
    params: Record<string, number>,
    expiries: string[],
  ) => Promise<void>;
}

function defaultParams(schema: ExpiryCorrelationMethodSchema): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of schema.params) out[p.name] = p.default;
  return out;
}

// Range-slider step resolution. Fine enough for the α-blend (0..1) to feel
// continuous, coarse enough that the numeric readout doesn't spam decimals.
const SLIDER_STEP_FRACTION = 100;

/**
 * Sits above the expiry MatrixGrid. Lets the trader pick a calculator from
 * the server-side library, tune its params via sliders, and fill the draft
 * matrix with one click. Existing Confirm / Discard gate promotion.
 */
export function MethodPicker({ expiries, applyMethod }: Props) {
  const [methods, setMethods] = useState<ExpiryCorrelationMethodSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>("");
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listExpiryCorrelationMethods();
        if (cancelled) return;
        setMethods(r.methods);
        if (r.methods.length > 0) {
          setSelectedName(r.methods[0].name);
          setParamValues(defaultParams(r.methods[0]));
        }
      } catch (e) {
        if (!cancelled) {
          setCatalogError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => methods.find((m) => m.name === selectedName) ?? null,
    [methods, selectedName],
  );

  const handleSelect = useCallback(
    (name: string) => {
      setSelectedName(name);
      const schema = methods.find((m) => m.name === name);
      if (schema) setParamValues(defaultParams(schema));
    },
    [methods],
  );

  const handleParamChange = useCallback((name: string, value: number) => {
    setParamValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleApply = useCallback(async () => {
    if (!selected) return;
    setApplying(true);
    setApplyError(null);
    try {
      await applyMethod(selected.name, paramValues, expiries);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [applyMethod, selected, paramValues, expiries]);

  const applyDisabled = applying || !selected || expiries.length < 2;

  if (loading) {
    return (
      <div className="rounded-md border border-black/5 bg-white/30 px-3 py-2">
        <p className="text-[10px] italic text-mm-text-dim">Loading calculator library…</p>
      </div>
    );
  }

  if (catalogError) {
    return (
      <div className="rounded-md border border-red-400/40 bg-red-50/60 px-3 py-2">
        <p className="text-[10px] text-red-700">Calculator library unavailable: {catalogError}</p>
      </div>
    );
  }

  if (methods.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-black/5 bg-white/30 px-3 py-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Calculator
          <select
            value={selectedName}
            onChange={(e) => handleSelect(e.currentTarget.value)}
            className="rounded border border-black/10 bg-white/60 px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-mm-text"
          >
            {methods.map((m) => (
              <option key={m.name} value={m.name}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={applyDisabled}
          className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-500/20 disabled:opacity-40"
          title={
            expiries.length < 2
              ? "Need at least two distinct expiries"
              : applying
                ? "Applying…"
                : "Overwrite the draft with this calculator's output"
          }
        >
          {applying ? "Applying…" : "Apply to draft"}
        </button>
      </div>

      {selected && (
        <p className="text-[10px] leading-snug text-mm-text-dim">{selected.description}</p>
      )}

      {selected?.params.map((p) => {
        const v = paramValues[p.name] ?? p.default;
        const step = (p.max - p.min) / SLIDER_STEP_FRACTION;
        return (
          <div key={p.name} className="flex items-center gap-2">
            <label
              htmlFor={`calc-param-${p.name}`}
              className="min-w-[180px] text-[10px] text-mm-text-dim"
            >
              {p.label}
            </label>
            <input
              id={`calc-param-${p.name}`}
              type="range"
              min={p.min}
              max={p.max}
              step={step}
              value={v}
              onChange={(e) => handleParamChange(p.name, Number(e.currentTarget.value))}
              className="flex-1 accent-indigo-500"
            />
            <span className="min-w-[40px] text-right font-mono text-[10px] text-mm-text">
              {v.toFixed(2)}
            </span>
          </div>
        );
      })}

      {applyError && (
        <p className="rounded border border-red-400/40 bg-red-50/60 px-2 py-1 text-[10px] text-red-700">
          {applyError}
        </p>
      )}
    </div>
  );
}
