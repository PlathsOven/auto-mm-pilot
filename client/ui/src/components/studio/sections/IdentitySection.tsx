import type { IdentityDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";

interface Props {
  value: IdentityDraft;
  onChange: (next: IdentityDraft) => void;
  state: SectionState;
}

export function IdentitySection({ value, onChange, state }: Props) {
  const patch = <K extends keyof IdentityDraft>(k: K, v: IdentityDraft[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <SectionCard
      title="Identity"
      number={1}
      status={state.status}
      message={state.message}
    >
      <div className="grid gap-3">
        <Field
          type="text"
          label="Stream name (snake_case)"
          required
          committable
          placeholder="e.g. rolling_realized_vol"
          value={value.stream_name}
          onChange={(v) => patch("stream_name", v)}
        />
        <Field
          type="text"
          label="Key columns (comma-separated)"
          required
          committable
          placeholder="symbol, expiry"
          value={value.key_cols.join(", ")}
          onChange={(v) =>
            patch(
              "key_cols",
              v.split(",").map((c) => c.trim()).filter(Boolean),
            )
          }
        />
        <Field
          type="textarea"
          label="What's your idea?"
          required={false}
          committable
          placeholder="One sentence describing what this stream is supposed to capture."
          rows={2}
          value={value.description}
          onChange={(v) => patch("description", v)}
        />
      </div>
    </SectionCard>
  );
}
