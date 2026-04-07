import { useTransforms } from "../../../providers/TransformsProvider";
import type { AggregationDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";

interface Props {
  value: AggregationDraft;
  onChange: (next: AggregationDraft) => void;
  state: SectionState;
  dimmed?: boolean;
}

const EXPLANATIONS = {
  average:
    "Blends with other estimates of the same quantity. Use when this stream is one of several views on the same fair value.",
  offset:
    "Stacks as an independent additive layer on top of existing fair value. Use when this stream contributes new information not captured by other streams.",
};

export function AggregationSection({ value, onChange, state, dimmed }: Props) {
  const { steps } = useTransforms();
  const aggName = steps?.aggregation?.selected ?? "average_offset";
  const isSumAll = aggName === "sum_all";

  return (
    <SectionCard
      title="Aggregation"
      number={5}
      status={state.status}
      message={state.message}
      dimmed={dimmed}
      mathDisclosure={
        <p>
          Active <code className="text-mm-accent">aggregation</code> = <strong>{aggName}</strong>.
          Determines how multiple blocks contributing to the same risk dimension are combined.
        </p>
      }
    >
      {isSumAll && (
        <p className="mb-3 rounded-md border border-mm-warn/40 bg-mm-warn/10 p-2 text-[10px] text-mm-warn">
          The global aggregation transform is currently <code>sum_all</code>, which ignores per-block
          aggregation logic. Switch to <code>average_offset</code> in Studio Pipeline to use this section.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {(["average", "offset"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={isSumAll}
            onClick={() => onChange({ aggregation_logic: opt })}
            className={`rounded-md border p-3 text-left transition-colors ${
              value.aggregation_logic === opt
                ? "border-mm-accent/60 bg-mm-accent/10"
                : "border-mm-border/40 bg-mm-bg/40 hover:border-mm-border/80"
            } ${isSumAll ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <div className="text-xs font-semibold text-mm-text capitalize">{opt}</div>
            <div className="mt-1 text-[10px] text-mm-text-dim">{EXPLANATIONS[opt]}</div>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}
