import { useMemo } from "react";
import type { DataShapeDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { Field } from "./Field";

interface Props {
  value: DataShapeDraft;
  onChange: (next: DataShapeDraft) => void;
  state: SectionState;
  dimmed?: boolean;
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

export function DataShapeSection({ value, onChange, state, dimmed }: Props) {
  const schema = useMemo(() => parseCsv(value.sample_csv), [value.sample_csv]);

  const patch = <K extends keyof DataShapeDraft>(k: K, v: DataShapeDraft[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <SectionCard
      title="Data Shape"
      number={2}
      status={state.status}
      message={state.message}
      dimmed={dimmed}
    >
      <div className="grid gap-3">
        <Field
          type="textarea"
          label="Paste a sample (CSV with header row)"
          placeholder={"timestamp,symbol,expiry,raw_value\n2026-01-15T16:00:00Z,BTC,27MAR26,0.74"}
          rows={5}
          mono
          value={value.sample_csv}
          onChange={(v) => patch("sample_csv", v)}
        />

        {schema && (
          <div className="rounded-md border border-mm-border/40 bg-mm-bg-deep/60 p-2 text-[10px]">
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
                      : "border-mm-border/40 text-mm-text-dim"
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
            value={value.value_column}
            options={schema.numericColumns}
            onChange={(v) => patch("value_column", v)}
          />
        )}
      </div>
    </SectionCard>
  );
}
