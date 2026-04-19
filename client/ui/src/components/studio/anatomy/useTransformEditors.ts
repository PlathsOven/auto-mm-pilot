import { useCallback, useState } from "react";
import { updateTransforms } from "../../../services/transformApi";
import { useTransforms } from "../../../providers/TransformsProvider";
import type { TransformStep } from "../../../types";

export interface TransformEditorState {
  savingKey: string | null;
  saveError: string | null;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
}

/**
 * State machine for editing a transform step's selected implementation and
 * its params. Lifted from the old inline AnatomyCanvas implementation so the
 * canvas component can focus on graph rendering + routing node clicks.
 *
 * Every persist goes through `/api/transforms` and `refresh()` is called on
 * success so other TransformsProvider consumers see the update.
 */
export function useTransformEditors(): TransformEditorState {
  const { setSteps, refresh } = useTransforms();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
        setSteps(res.steps);
        refresh();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingKey(null);
      }
    },
    [refresh, setSteps],
  );

  const onSelectTransform = useCallback(
    (stepKey: string, name: string) => {
      setSteps((prev) => {
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
    [persist, setSteps],
  );

  const onParamChange = useCallback(
    (stepKey: string, paramName: string, value: unknown) => {
      setSteps((prev) => {
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
    [persist, setSteps],
  );

  return { savingKey, saveError, onSelectTransform, onParamChange };
}
