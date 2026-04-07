import { useState } from "react";
import { createManualBlock, type ManualBlockPayload } from "../../../services/blockApi";
import { useKeyboardShortcut } from "../../../hooks/useKeyboardShortcut";
import { Field } from "../sections/Field";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface DraftBlockConfig {
  annualized: boolean;
  size_type: "fixed" | "relative";
  aggregation_logic: "average" | "offset";
  temporal_position: "static" | "shifting";
  decay_end_size_mult: number;
  decay_rate_prop_per_min: number;
  var_fair_ratio: number;
}

interface Draft {
  stream_name: string;
  key_cols_raw: string;
  scale: number;
  offset: number;
  exponent: number;
  space_id: string;
  snapshot_csv: string;
  block: DraftBlockConfig;
}

const EMPTY_DRAFT: Draft = {
  stream_name: "",
  key_cols_raw: "symbol, expiry",
  scale: 1.0,
  offset: 0.0,
  exponent: 1.0,
  space_id: "",
  snapshot_csv:
    "timestamp,symbol,expiry,raw_value\n2026-01-15T16:00:00Z,BTC,27MAR26,0.74",
  block: {
    annualized: true,
    size_type: "fixed",
    aggregation_logic: "average",
    temporal_position: "shifting",
    decay_end_size_mult: 1.0,
    decay_rate_prop_per_min: 0.0,
    var_fair_ratio: 1.0,
  },
};

// Strict numeric — matches whole-string integers, decimals, scientific
// notation, with an optional leading sign. Critically rejects `"27MAR26"`
// which `parseFloat` would otherwise parse as `27`.
const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Parse pasted CSV into row objects suitable for /api/snapshots / /api/blocks.
 * Mirrors the parser in `studio/sections/PreviewSection.tsx`.
 */
function parseCsvToRows(csv: string): Record<string, unknown>[] {
  const lines = csv
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const cell = cells[i] ?? "";
      row[h] = NUMERIC_RE.test(cell) ? parseFloat(cell) : cell;
    });
    return row;
  });
}

/**
 * Manual block creation drawer — Studio → Brain → Block Inspector.
 *
 * Streams normally drip blocks into the pipeline via scheduled snapshots,
 * but the architect sometimes needs to drop a one-off block for a specific
 * dimension. This drawer wraps `POST /api/blocks` (already in
 * `blockApi.ts:createManualBlock`) with the full `ManualBlockPayload` form,
 * validated client-side and composed from shared `Field` primitives.
 */
export function AddBlockDrawer({ open, onClose, onCreated }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useKeyboardShortcut("Escape", () => open && onClose(), { mod: false });

  if (!open) return null;

  const patch = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const patchBlock = <K extends keyof DraftBlockConfig>(k: K, v: DraftBlockConfig[K]) =>
    setDraft((d) => ({ ...d, block: { ...d.block, [k]: v } }));

  const valid =
    draft.stream_name.trim().length > 0 &&
    Number.isFinite(draft.scale) &&
    draft.scale !== 0 &&
    Number.isFinite(draft.offset) &&
    Number.isFinite(draft.exponent) &&
    draft.exponent !== 0 &&
    draft.snapshot_csv.trim().split("\n").filter(Boolean).length >= 2 &&
    draft.block.var_fair_ratio > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const key_cols = draft.key_cols_raw
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const snapshot_rows = parseCsvToRows(draft.snapshot_csv);
      if (snapshot_rows.length === 0) {
        throw new Error("Snapshot CSV has no data rows");
      }
      const payload: ManualBlockPayload = {
        stream_name: draft.stream_name.trim(),
        key_cols: key_cols.length > 0 ? key_cols : undefined,
        scale: draft.scale,
        offset: draft.offset,
        exponent: draft.exponent,
        block: {
          annualized: draft.block.annualized,
          size_type: draft.block.size_type,
          aggregation_logic: draft.block.aggregation_logic,
          temporal_position: draft.block.temporal_position,
          decay_end_size_mult: draft.block.decay_end_size_mult,
          decay_rate_prop_per_min: draft.block.decay_rate_prop_per_min,
          decay_profile: "linear",
          var_fair_ratio: draft.block.var_fair_ratio,
        },
        snapshot_rows,
        space_id: draft.space_id.trim() || undefined,
      };
      await createManualBlock(payload);
      onCreated();
      setDraft(EMPTY_DRAFT);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-[60px] z-50 flex h-[calc(100vh-60px)] w-[520px] flex-col border-l border-mm-border/60 bg-mm-surface shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-mm-border/40 px-4 py-3">
          <div>
            <h3 className="zone-header">Add Manual Block</h3>
            <p className="mt-0.5 text-[10px] text-mm-text-dim">
              Drop a one-off block into the pipeline without a stream.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <section className="flex flex-col gap-3">
            <Field
              type="text"
              label="Block / stream name"
              placeholder="e.g. manual_cpi_bump"
              value={draft.stream_name}
              onChange={(v) => patch("stream_name", v)}
            />
            <Field
              type="text"
              label="Key columns (comma-separated)"
              placeholder="symbol, expiry"
              value={draft.key_cols_raw}
              onChange={(v) => patch("key_cols_raw", v)}
            />
            <Field
              type="text"
              label="Space id (optional)"
              placeholder="leave blank to auto-compute"
              value={draft.space_id}
              onChange={(v) => patch("space_id", v)}
            />
          </section>

          <section className="flex flex-col gap-3 border-t border-mm-border/30 pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Target mapping
            </span>
            <div className="grid grid-cols-3 gap-3">
              <Field type="number" label="scale" value={draft.scale} onChange={(v) => patch("scale", v)} />
              <Field type="number" label="offset" value={draft.offset} onChange={(v) => patch("offset", v)} />
              <Field type="number" label="exponent" value={draft.exponent} onChange={(v) => patch("exponent", v)} />
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-mm-border/30 pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Block shape
            </span>
            <div className="grid grid-cols-2 gap-3">
              <Field
                type="toggle"
                label="Annualized"
                value={draft.block.annualized}
                onChange={(v) => patchBlock("annualized", v)}
              />
              <Field
                type="select"
                label="Size type"
                value={draft.block.size_type}
                options={["fixed", "relative"]}
                onChange={(v) => patchBlock("size_type", v as "fixed" | "relative")}
              />
              <Field
                type="select"
                label="Aggregation logic"
                value={draft.block.aggregation_logic}
                options={["average", "offset"]}
                onChange={(v) => patchBlock("aggregation_logic", v as "average" | "offset")}
              />
              <Field
                type="select"
                label="Temporal position"
                value={draft.block.temporal_position}
                options={["static", "shifting"]}
                onChange={(v) => patchBlock("temporal_position", v as "static" | "shifting")}
              />
              <Field
                type="number"
                label="decay_end_size_mult"
                value={draft.block.decay_end_size_mult}
                onChange={(v) => patchBlock("decay_end_size_mult", v)}
              />
              <Field
                type="number"
                label="decay_rate_prop_per_min"
                value={draft.block.decay_rate_prop_per_min}
                onChange={(v) => patchBlock("decay_rate_prop_per_min", v)}
              />
              <Field
                type="number"
                label="var_fair_ratio"
                value={draft.block.var_fair_ratio}
                onChange={(v) => patchBlock("var_fair_ratio", v)}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2 border-t border-mm-border/30 pt-3">
            <Field
              type="textarea"
              label="Snapshot rows (CSV with header)"
              placeholder={"timestamp,symbol,expiry,raw_value\n2026-01-15T16:00:00Z,BTC,27MAR26,0.74"}
              rows={6}
              mono
              value={draft.snapshot_csv}
              onChange={(v) => patch("snapshot_csv", v)}
            />
          </section>

          {error && (
            <p className="rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-mm-border/40 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || submitting}
            onClick={submit}
            className="rounded-lg bg-mm-accent px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Creating…" : "Create block"}
          </button>
        </footer>
      </aside>
    </>
  );
}
