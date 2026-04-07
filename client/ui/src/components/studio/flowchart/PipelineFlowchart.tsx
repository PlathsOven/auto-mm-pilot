import type { TransformStep } from "../../../types";
import { useMode } from "../../../providers/ModeProvider";
import { useRegisteredStreams } from "../../../hooks/useRegisteredStreams";
import { PipelineStepCard } from "../PipelineStepCard";
import { FlowSectionCard } from "./FlowSectionCard";
import { FlowArrow } from "./FlowArrow";

export const PIPELINE_ORDER = [
  "unit_conversion",
  "decay_profile",
  "temporal_fair_value",
  "variance",
  "aggregation",
  "position_sizing",
  "smoothing",
] as const;

export type StepKey = (typeof PIPELINE_ORDER)[number];

/**
 * Plain-language one-liner per step, rendered as `PipelineStepCard.subtitle`.
 * Previously lived as italic captions beneath each card in PipelineComposer.
 */
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
 * Human-readable data-flow label shown on the arrow BELOW each step.
 * The arrow below step N describes what flows out of N into N+1.
 */
const STEP_OUTPUT: Record<StepKey, string> = {
  unit_conversion: "target values",
  decay_profile: "decayed blocks",
  temporal_fair_value: "fair-value series",
  variance: "fair + variance",
  aggregation: "edge per dimension",
  position_sizing: "raw position",
  smoothing: "desired position",
};

const TOP_STREAM_CHIPS = 5;

interface Props {
  steps: Record<string, TransformStep>;
  activeKey: StepKey;
  savingKey: string | null;
  onSelectStep: (key: StepKey) => void;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
}

/**
 * System-diagram flowchart for the 7-step pipeline.
 *
 * Visual structure mirrors the pitch-deck `PositionManagementSlide`:
 *
 *   [Data Streams card] ─▶ [Dashed APT Pipeline box {7 steps}] ─▶ [Desired Positions card]
 *
 * Each step inside the dashed box is the existing `PipelineStepCard` —
 * expand behaviour, implementation picker, and parameter editor are
 * unchanged. The arrows carry data-flow labels; the top and bottom cards
 * link out to Studio Streams and Floor respectively.
 */
export function PipelineFlowchart({
  steps,
  activeKey,
  savingKey,
  onSelectStep,
  onSelectTransform,
  onParamChange,
}: Props) {
  const { setMode } = useMode();
  const { streams } = useRegisteredStreams();

  const topStreams = streams.slice(0, TOP_STREAM_CHIPS);
  const overflowCount = Math.max(0, streams.length - TOP_STREAM_CHIPS);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-stretch">
      {/* Top bracket: Data Streams */}
      <FlowSectionCard
        title="Data Streams"
        emphasis
        onClick={() => setMode("studio", "streams")}
      >
        {streams.length === 0 ? (
          <p className="text-center text-[10px] text-mm-text-dim">
            No streams registered. Open Studio Streams to create one.
          </p>
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5">
            {topStreams.map((s) => (
              <span
                key={s.stream_name}
                className="rounded-full border border-mm-accent/30 bg-mm-accent/5 px-2 py-0.5 text-[10px] text-mm-accent"
              >
                {s.stream_name}
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="rounded-full border border-mm-border/40 px-2 py-0.5 text-[10px] text-mm-text-dim">
                +{overflowCount} more
              </span>
            )}
          </div>
        )}
      </FlowSectionCard>

      <FlowArrow label="raw values" />

      {/* Dashed APT Pipeline box */}
      <FlowSectionCard dashed badge="APT Pipeline">
        <div className="mx-auto flex w-full max-w-[640px] flex-col">
          {PIPELINE_ORDER.map((key, idx) => {
            const step = steps[key];
            if (!step) return null;
            const isLast = idx === PIPELINE_ORDER.length - 1;
            return (
              <div key={key}>
                <div
                  onClick={() => onSelectStep(key)}
                  onFocus={() => onSelectStep(key)}
                >
                  <PipelineStepCard
                    stepKey={key}
                    stepNumber={idx + 1}
                    step={step}
                    active={activeKey === key}
                    saving={savingKey === key}
                    subtitle={PIPELINE_NARRATIVE[key]}
                    onSelectTransform={onSelectTransform}
                    onParamChange={onParamChange}
                  />
                </div>
                {!isLast && <FlowArrow label={STEP_OUTPUT[key]} />}
              </div>
            );
          })}
        </div>
      </FlowSectionCard>

      <FlowArrow label={STEP_OUTPUT.smoothing} />

      {/* Bottom bracket: Desired Positions */}
      <FlowSectionCard
        title="Desired Positions"
        emphasis
        onClick={() => setMode("floor")}
      >
        <p className="text-center text-[10px] text-mm-text-dim">
          View live positions in Floor →
        </p>
      </FlowSectionCard>
    </div>
  );
}
