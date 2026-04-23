import { useConnectorCatalog } from "../../../hooks/useConnectorCatalog";
import type { IdentityDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";

interface Props {
  value: IdentityDraft;
  onChange: (next: IdentityDraft) => void;
  state: SectionState;
  /** Currently-selected connector machine id, or null for a user-fed stream. */
  connectorName: string | null;
  /** Fired when the user picks a different connector (or clears the picker). */
  onConnectorChange: (next: string | null) => void;
}

/** Sentinel for "user-fed stream" in the connector dropdown. */
const NO_CONNECTOR = "";

export function IdentitySection({
  value,
  onChange,
  state,
  connectorName,
  onConnectorChange,
}: Props) {
  const { connectors, loading: catalogLoading } = useConnectorCatalog();
  const patch = <K extends keyof IdentityDraft>(k: K, v: IdentityDraft[K]) =>
    onChange({ ...value, [k]: v });

  const hasConnectors = connectors.length > 0;

  return (
    <SectionCard
      title="Identity"
      number={1}
      status={state.status}
      message={state.message}
    >
      <div className="grid gap-3">
        {hasConnectors && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-mm-text-dim">
              Connector
              <span className="ml-1 text-[9px] font-normal text-mm-text-dim/70">(optional)</span>
            </span>
            <select
              value={connectorName ?? NO_CONNECTOR}
              onChange={(e) => {
                const next = e.target.value;
                onConnectorChange(next === NO_CONNECTOR ? null : next);
              }}
              disabled={catalogLoading}
              className="form-input font-mono"
            >
              <option value={NO_CONNECTOR}>None — user-fed stream</option>
              {connectors.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.display_name}
                </option>
              ))}
            </select>
            <span className="text-[9px] text-mm-text-dim">
              {connectorName
                ? "A connector pre-fills sections 3–6 from its recommended defaults; push inputs via the SDK."
                : "Pick a connector to compute raw_value server-side, or leave blank to push pre-computed values."}
            </span>
          </label>
        )}
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
