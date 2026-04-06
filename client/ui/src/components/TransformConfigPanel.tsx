import { useState, useEffect, useCallback } from "react";
import type { TransformStep, TransformParam, TransformInfo } from "../types";
import { fetchTransforms, updateTransforms } from "../services/transformApi";

const POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// ParamInput — renders the correct input widget for a single parameter
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
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(param.name, e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-700 bg-[#161b22] text-indigo-500 focus:ring-indigo-500/30"
        />
        <span className="text-xs text-gray-300">{param.name}</span>
      </label>
    );
  }

  if (param.type === "str" && param.options && param.options.length > 0) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-gray-400">{param.name}</span>
        <select
          value={String(value ?? param.default ?? "")}
          onChange={(e) => onChange(param.name, e.target.value)}
          className="rounded border border-gray-700 bg-[#161b22] px-2 py-1 font-mono text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
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
        <span className="text-[10px] font-medium text-gray-400">{param.name}</span>
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
            onChange(param.name, param.type === "int" ? parseInt(raw, 10) : parseFloat(raw));
          }}
          className="rounded border border-gray-700 bg-[#161b22] px-2 py-1 font-mono text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
        />
      </label>
    );
  }

  // str without options
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-gray-400">{param.name}</span>
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(param.name, e.target.value)}
        className="rounded border border-gray-700 bg-[#161b22] px-2 py-1 font-mono text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// StepSection — one collapsible block per pipeline step
// ---------------------------------------------------------------------------

function StepSection({
  stepKey,
  step,
  onSelectTransform,
  onParamChange,
}: {
  stepKey: string;
  step: TransformStep;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
}) {
  const selectedInfo: TransformInfo | undefined = step.transforms.find(
    (t) => t.name === step.selected,
  );

  return (
    <div className="border border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-200">{step.label}</h3>
        <select
          value={step.selected}
          onChange={(e) => onSelectTransform(stepKey, e.target.value)}
          className="rounded border border-gray-700 bg-[#161b22] px-2 py-1 text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
        >
          {step.transforms.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {selectedInfo && selectedInfo.description && (
        <p className="mb-2 text-[10px] text-gray-500">{selectedInfo.description}</p>
      )}

      {selectedInfo && selectedInfo.params.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {selectedInfo.params.map((param: TransformParam) => (
            <div key={param.name}>
              <ParamInput
                param={param}
                value={step.params[param.name] ?? param.default}
                onChange={(name, val) => onParamChange(stepKey, name, val)}
              />
              {param.description && (
                <p className="mt-0.5 text-[9px] text-gray-600">{param.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TransformConfigPanel — main exported component
// ---------------------------------------------------------------------------

export function TransformConfigPanel() {
  const [steps, setSteps] = useState<Record<string, TransformStep>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Fetch transforms on mount + poll
  useEffect(() => {
    let cancelled = false;

    const doFetch = () => {
      fetchTransforms()
        .then((res) => {
          if (cancelled) return;
          setSteps(res.steps);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    };

    doFetch();
    const interval = setInterval(doFetch, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const onSelectTransform = useCallback((stepKey: string, name: string) => {
    setSteps((prev) => {
      const step = prev[stepKey];
      if (!step) return prev;
      const info = step.transforms.find((t) => t.name === name);
      const defaults: Record<string, unknown> = {};
      if (info) {
        for (const p of info.params) {
          defaults[p.name] = p.default;
        }
      }
      return {
        ...prev,
        [stepKey]: { ...step, selected: name, params: defaults },
      };
    });
  }, []);

  const onParamChange = useCallback((stepKey: string, paramName: string, value: unknown) => {
    setSteps((prev) => {
      const step = prev[stepKey];
      if (!step) return prev;
      return {
        ...prev,
        [stepKey]: {
          ...step,
          params: { ...step.params, [paramName]: value },
        },
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const config: Record<string, unknown> = {};
      for (const [key, step] of Object.entries(steps)) {
        config[key] = { selected: step.selected, params: step.params };
      }
      const res = await updateTransforms(config);
      setSteps(res.steps);
      setToast({ message: "Configuration saved", type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to save",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [steps]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500 animate-pulse">
        Loading transforms...
      </div>
    );
  }

  const stepKeys = Object.keys(steps);

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-gray-300 overflow-hidden">
      {/* Toast notification */}
      {toast && (
        <div
          className={`mx-4 mt-2 rounded px-3 py-1.5 text-xs font-medium ${
            toast.type === "success"
              ? "bg-green-900/40 text-green-300 border border-green-800/50"
              : "bg-red-900/40 text-red-300 border border-red-800/50"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Scrollable step list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {stepKeys.map((key) => (
          <StepSection
            key={key}
            stepKey={key}
            step={steps[key]}
            onSelectTransform={onSelectTransform}
            onParamChange={onParamChange}
          />
        ))}
      </div>

      {/* Save footer */}
      <div className="p-3 border-t border-gray-800">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>
    </div>
  );
}
