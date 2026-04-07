import type { IdentityDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";

interface Props {
  value: IdentityDraft;
  onChange: (next: IdentityDraft) => void;
  state: SectionState;
  dimmed?: boolean;
}

export function IdentitySection({ value, onChange, state, dimmed }: Props) {
  return (
    <SectionCard
      title="Identity"
      number={1}
      status={state.status}
      message={state.message}
      dimmed={dimmed}
    >
      <div className="grid gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-mm-text-dim">Stream name (snake_case)</span>
          <input
            type="text"
            value={value.stream_name}
            onChange={(e) => onChange({ ...value, stream_name: e.target.value })}
            placeholder="e.g. rolling_realized_vol"
            className="form-input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-mm-text-dim">
            Key columns (comma-separated)
          </span>
          <input
            type="text"
            value={value.key_cols.join(", ")}
            onChange={(e) =>
              onChange({
                ...value,
                key_cols: e.target.value
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean),
              })
            }
            placeholder="symbol, expiry"
            className="form-input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-mm-text-dim">
            What's your idea? (used by the LLM co-pilot)
          </span>
          <textarea
            value={value.description}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            placeholder="One sentence describing what this stream is supposed to capture."
            rows={2}
            className="form-input resize-none"
          />
        </label>
      </div>
    </SectionCard>
  );
}
