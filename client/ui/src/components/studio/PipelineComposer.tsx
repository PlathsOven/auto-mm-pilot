import { useCallback, useEffect, useState } from "react";
import { useTransforms } from "../../providers/TransformsProvider";
import { updateTransforms } from "../../services/transformApi";
import type { TransformStep } from "../../types";
import { BankrollEditor } from "./BankrollEditor";
import { MarketPricingEditor } from "./MarketPricingEditor";
import { LiveEquationStrip } from "../equation/LiveEquationStrip";
import {
  PipelineFlowchart,
  PIPELINE_ORDER,
  type StepKey,
} from "./flowchart/PipelineFlowchart";

/**
 * Visual composer for the seven-step pipeline.
 *
 * Owns the transforms cache + optimistic state machine; `PipelineFlowchart`
 * handles presentation. Edits flow through `PATCH /api/transforms` which
 * the server uses to re-run the pipeline. Floor positions update live on
 * the next WS tick.
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

  const onSelectStep = useCallback((key: StepKey) => {
    setActiveKey(key);
  }, []);

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

  // Ensure every pipeline step is present before rendering the flowchart —
  // guards against an in-flight /api/transforms response with a partial shape.
  const allPresent = PIPELINE_ORDER.every((k) => localSteps[k]);
  if (!allPresent) return null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Main composer */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        <header className="mb-4">
          <h2 className="zone-header">Pipeline Composer</h2>
          <p className="mt-1 text-[11px] text-mm-text-dim">
            Every data stream flows through the seven-step APT framework.
            Edits re-run the pipeline live.
          </p>
        </header>

        <LiveEquationStrip size="lg" />

        {saveError && (
          <p className="mt-3 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
            {saveError}
          </p>
        )}

        <div className="mt-4">
          <PipelineFlowchart
            steps={localSteps}
            activeKey={activeKey}
            savingKey={savingKey}
            onSelectStep={onSelectStep}
            onSelectTransform={onSelectTransform}
            onParamChange={onParamChange}
          />
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
