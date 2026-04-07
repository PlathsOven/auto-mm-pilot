import { useCallback, useEffect, useState } from "react";
import { useTransforms } from "../../providers/TransformsProvider";
import { updateTransforms } from "../../services/transformApi";
import type { TransformStep } from "../../types";
import { PipelineStepCard } from "./PipelineStepCard";
import { BankrollEditor } from "./BankrollEditor";
import { MarketPricingEditor } from "./MarketPricingEditor";
import { LiveEquationStrip } from "../equation/LiveEquationStrip";

const PIPELINE_ORDER = [
  "unit_conversion",
  "decay_profile",
  "temporal_fair_value",
  "variance",
  "aggregation",
  "position_sizing",
  "smoothing",
] as const;

type StepKey = (typeof PIPELINE_ORDER)[number];

const PIPELINE_NARRATIVE: Record<StepKey, string> = {
  unit_conversion: "Map raw rows into the target space.",
  decay_profile: "Decide how a block's influence fades over time.",
  temporal_fair_value: "Compose blocks into a fair value time series.",
  variance: "Compute the uncertainty around fair value.",
  aggregation: "Combine multiple blocks contributing to the same dimension.",
  position_sizing: "Translate edge + variance + bankroll → desired position.",
  smoothing: "Stabilise the position over short-term noise.",
};

/**
 * Visual composer for the seven-step pipeline.
 *
 * Each step is a card with the currently-selected transform and a parameter
 * editor auto-generated from the introspected `TransformParam` schema.
 * Edits are debounced into a single PATCH /api/transforms call which the
 * server uses to re-run the pipeline. Floor positions update on the next
 * tick.
 *
 * Right-side sidebar holds the lifted Bankroll + Market Pricing editors.
 */
export function PipelineComposer() {
  const { steps, loading, error, refresh } = useTransforms();
  const [localSteps, setLocalSteps] = useState<Record<string, TransformStep> | null>(steps);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<StepKey>("position_sizing");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep local state in sync with provider
  useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  const persist = useCallback(
    async (stepKey: string, nextStep: TransformStep) => {
      setSavingKey(stepKey);
      setSaveError(null);
      try {
        const config: Record<string, unknown> = {
          [stepKey]: nextStep.selected,
          [`${stepKey}_params`]: nextStep.params,
        };
        const res = await updateTransforms(config);
        setLocalSteps(res.steps);
        refresh();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingKey(null);
      }
    },
    [refresh],
  );

  const onSelectTransform = useCallback(
    (stepKey: string, name: string) => {
      setLocalSteps((prev) => {
        if (!prev) return prev;
        const step = prev[stepKey];
        if (!step) return prev;
        const info = step.transforms.find((t) => t.name === name);
        const defaults: Record<string, unknown> = {};
        if (info) for (const p of info.params) defaults[p.name] = p.default;
        const nextStep: TransformStep = { ...step, selected: name, params: defaults };
        // Fire-and-forget save
        persist(stepKey, nextStep);
        return { ...prev, [stepKey]: nextStep };
      });
    },
    [persist],
  );

  const onParamChange = useCallback(
    (stepKey: string, paramName: string, value: unknown) => {
      setLocalSteps((prev) => {
        if (!prev) return prev;
        const step = prev[stepKey];
        if (!step) return prev;
        const nextStep: TransformStep = {
          ...step,
          params: { ...step.params, [paramName]: value },
        };
        persist(stepKey, nextStep);
        return { ...prev, [stepKey]: nextStep };
      });
    },
    [persist],
  );

  if (loading && !localSteps) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-mm-text-dim">Loading transforms…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-mm-error">{error}</p>
      </div>
    );
  }

  if (!localSteps) return null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Main composer */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="zone-header">Pipeline Composer</h2>
            <p className="mt-1 text-[11px] text-mm-text-dim">
              All seven transform steps in order. Edits re-run the pipeline live.
            </p>
          </div>
        </header>

        {/* Pipeline equation strip — responds to active position_sizing changes */}
        <LiveEquationStrip size="lg" />

        {/* Flow narrative */}
        <div className="mt-3 mb-3 rounded-lg border border-mm-border/40 bg-mm-bg-deep/40 p-3 text-[10px] leading-relaxed text-mm-text-dim">
          <span className="font-medium text-mm-accent">[raw data]</span> → unit_conversion → decay_profile → temporal_fair_value → variance → aggregation → position_sizing → smoothing → <span className="font-medium text-mm-accent">[desired position]</span>
        </div>

        {saveError && (
          <p className="mb-3 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
            {saveError}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {PIPELINE_ORDER.map((key, idx) => {
            const step = localSteps[key];
            if (!step) return null;
            return (
              <div
                key={key}
                onClick={() => setActiveKey(key)}
                onFocus={() => setActiveKey(key)}
              >
                <PipelineStepCard
                  stepKey={key}
                  stepNumber={idx + 1}
                  step={step}
                  active={activeKey === key}
                  saving={savingKey === key}
                  onSelectTransform={onSelectTransform}
                  onParamChange={onParamChange}
                />
                <p className="mt-1 px-3 text-[9px] italic text-mm-text-dim">
                  {PIPELINE_NARRATIVE[key]}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings sidebar */}
      <aside className="flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-mm-border/60 bg-mm-surface/40 p-4">
        <BankrollEditor />
        <MarketPricingEditor />
      </aside>
    </div>
  );
}
