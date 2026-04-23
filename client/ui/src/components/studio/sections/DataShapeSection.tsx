import { useMemo } from "react";
import { findConnector, useConnectorCatalog } from "../../../hooks/useConnectorCatalog";
import type { DataShapeDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";

interface Props {
  value: DataShapeDraft;
  onChange: (next: DataShapeDraft) => void;
  state: SectionState;
  /** Non-null when the stream is connector-fed — replaces the sample CSV
   *  panel with a read-only schema describing the connector's input shape. */
  connectorName?: string | null;
}

interface ParsedSchema {
  headers: string[];
  rowCount: number;
  numericColumns: string[];
}

function parseCsv(raw: string): ParsedSchema | null {
  const lines = raw
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
  const numericColumns = headers.filter((_h, idx) =>
    rows.every((r) => r[idx] !== undefined && r[idx] !== "" && !isNaN(parseFloat(r[idx]))),
  );
  return { headers, rowCount: rows.length, numericColumns };
}

export function DataShapeSection({ value, onChange, state, connectorName }: Props) {
  const { connectors } = useConnectorCatalog();
  const connector = findConnector(connectors, connectorName ?? null);
  const schema = useMemo(
    () => (connector ? null : parseCsv(value.sample_csv)),
    [connector, value.sample_csv],
  );

  const patch = <K extends keyof DataShapeDraft>(k: K, v: DataShapeDraft[K]) =>
    onChange({ ...value, [k]: v });

  if (connector) {
    return (
      <SectionCard
        title="Data Shape"
        number={2}
        status="valid"
      >
        <div className="grid gap-2 rounded-md border border-mm-accent/30 bg-mm-accent/[0.05] p-3 text-[10px]">
          <div className="flex items-baseline justify-between">
            <span className="text-mm-text-dim uppercase tracking-wider">Connector input schema</span>
            <span className="font-mono text-mm-accent">{connector.name}</span>
          </div>
          <p className="text-mm-text-dim">
            Push rows via <code className="font-mono">client.push_connector_input(...)</code>;
            the connector consumes them and emits <code className="font-mono">raw_value</code> server-side.
          </p>
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="font-mono text-mm-text-dim">timestamp</dt>
            <dd className="text-mm-text">ISO 8601 UTC</dd>
            {connector.input_key_cols.map((k) => (
              <FieldRow key={k} name={k} type="str" description="key column" />
            ))}
            {connector.input_value_fields.map((f) => (
              <FieldRow key={f.name} name={f.name} type={f.type} description={f.description} />
            ))}
          </dl>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Data Shape"
      number={2}
      status={state.status}
      message={state.message}
    >
      <div className="grid gap-3">
        <Field
          type="textarea"
          label="Paste a sample (CSV with header row)"
          required
          committable
          placeholder={"timestamp,symbol,expiry,raw_value,market_value\n2026-01-15T16:00:00Z,BTC,27MAR26,0.74,0.68"}
          rows={5}
          mono
          value={value.sample_csv}
          onChange={(v) => patch("sample_csv", v)}
        />

        {schema && (
          <div className="rounded-md border border-black/[0.06] bg-black/[0.03] p-2 text-[10px]">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-mm-text-dim">Schema preview</span>
              <span className="text-mm-text-dim">{schema.rowCount} row{schema.rowCount === 1 ? "" : "s"}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {schema.headers.map((h) => (
                <span
                  key={h}
                  className={`rounded border px-1.5 py-0.5 ${
                    schema.numericColumns.includes(h)
                      ? "border-mm-accent/40 bg-mm-accent/10 text-mm-accent"
                      : "border-black/[0.06] text-mm-text-dim"
                  }`}
                >
                  {h}
                </span>
              ))}
            </div>
          </div>
        )}

        {schema && schema.numericColumns.length > 0 && (
          <Field
            type="select"
            label="Value column"
            required
            value={value.value_column}
            options={schema.numericColumns}
            onChange={(v) => patch("value_column", v)}
          />
        )}
      </div>
    </SectionCard>
  );
}

function FieldRow({ name, type, description }: { name: string; type: string; description: string }) {
  return (
    <>
      <dt className="font-mono text-mm-text-dim">
        {name} <span className="text-[8px] text-mm-text-dim/70">({type})</span>
      </dt>
      <dd className="text-mm-text">{description}</dd>
    </>
  );
}
