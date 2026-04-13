import { useCallback, useEffect, useState } from "react";
import {
  createManualBlock,
  updateBlock,
  type ManualBlockPayload,
  type UpdateBlockPayload,
} from "../../../services/blockApi";
import { useKeyboardShortcut } from "../../../hooks/useKeyboardShortcut";
import { Field } from "../sections/Field";
import type { BlockRow } from "../../../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrawerMode = "create" | "edit" | "inspect";

interface Props {
  open: boolean;
  mode: DrawerMode;
  /** Pre-populated block when mode is "edit" or "inspect". */
  block: BlockRow | null;
  /** Pre-populate create mode from engine-command params (from LLM chat). */
  initialParams?: Record<string, unknown> | null;
  onClose: () => void;
  /** Fires after a successful create or update so the parent can refresh. */
  onSaved: () => void;
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

interface SnapshotRowDraft {
  /** Unique client-side key for React list rendering. */
  _key: number;
  [col: string]: unknown;
}

interface Draft {
  stream_name: string;
  key_cols_raw: string;
  scale: number;
  offset: number;
  exponent: number;
  space_id: string;
  block: DraftBlockConfig;
  snapshot_headers: string[];
  snapshot_rows: SnapshotRowDraft[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

let _nextKey = 1;
function nextKey(): number {
  return _nextKey++;
}

const DEFAULT_HEADERS = ["timestamp", "symbol", "expiry", "raw_value", "market_price"];

function emptyRow(headers: string[]): SnapshotRowDraft {
  const row: SnapshotRowDraft = { _key: nextKey() };
  for (const h of headers) row[h] = "";
  return row;
}

const EMPTY_DRAFT: Draft = {
  stream_name: "",
  key_cols_raw: "symbol, expiry",
  scale: 1.0,
  offset: 0.0,
  exponent: 1.0,
  space_id: "",
  block: {
    annualized: true,
    size_type: "fixed",
    aggregation_logic: "average",
    temporal_position: "shifting",
    decay_end_size_mult: 1.0,
    decay_rate_prop_per_min: 0.0,
    var_fair_ratio: 1.0,
  },
  snapshot_headers: [...DEFAULT_HEADERS],
  snapshot_rows: [
    {
      _key: nextKey(),
      timestamp: "2026-01-15T16:00:00Z",
      symbol: "BTC",
      expiry: "27MAR26",
      raw_value: "0.74",
      market_price: "",
    },
  ],
};

// Strict numeric — matches integers, decimals, scientific notation.
// Rejects strings like "27MAR26" which parseFloat would partly parse.
const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

function draftFromBlock(b: BlockRow): Draft {
  // We don't have the original snapshot rows from the server in BlockRow,
  // so we start with a single row pre-filled from the block's known values.
  const headers = [...DEFAULT_HEADERS];
  const row: SnapshotRowDraft = {
    _key: nextKey(),
    timestamp: b.start_timestamp ?? new Date().toISOString(),
    symbol: b.symbol,
    expiry: b.expiry,
    raw_value: String(b.raw_value),
    market_price: b.market_price != null ? String(b.market_price) : "",
  };
  return {
    stream_name: b.stream_name,
    key_cols_raw: "symbol, expiry",
    scale: b.scale,
    offset: b.offset,
    exponent: b.exponent,
    space_id: b.space_id,
    block: {
      annualized: b.annualized,
      size_type: b.size_type,
      aggregation_logic: b.aggregation_logic,
      temporal_position: b.temporal_position,
      decay_end_size_mult: b.decay_end_size_mult,
      decay_rate_prop_per_min: b.decay_rate_prop_per_min,
      var_fair_ratio: b.var_fair_ratio,
    },
    snapshot_headers: headers,
    snapshot_rows: [row],
  };
}

/**
 * Build a draft from engine-command params (emitted by the LLM in opinion mode).
 * Falls back to EMPTY_DRAFT defaults for any missing fields.
 */
function draftFromCommandParams(params: Record<string, unknown>): Draft {
  const blk = (params.block ?? {}) as Record<string, unknown>;
  const keyCols = params.key_cols as string[] | undefined;
  const rawRows = params.snapshot_rows as Record<string, unknown>[] | undefined;

  // Determine snapshot headers from the first row (if provided)
  const firstRow = rawRows?.[0];
  const headers = firstRow
    ? Object.keys(firstRow).filter((k) => k !== "_key")
    : [...DEFAULT_HEADERS];

  // Add start_timestamp header if any row has it and it's not already present
  if (!headers.includes("start_timestamp") && rawRows?.some((r) => "start_timestamp" in r)) {
    headers.push("start_timestamp");
  }

  const rows: SnapshotRowDraft[] = rawRows
    ? rawRows.map((r) => {
        const row: SnapshotRowDraft = { _key: nextKey() };
        for (const h of headers) {
          row[h] = r[h] != null ? String(r[h]) : "";
        }
        return row;
      })
    : [emptyRow(headers)];

  return {
    stream_name: (params.stream_name as string) ?? "",
    key_cols_raw: keyCols?.join(", ") ?? "symbol, expiry",
    scale: typeof params.scale === "number" ? params.scale : 1.0,
    offset: typeof params.offset === "number" ? params.offset : 0.0,
    exponent: typeof params.exponent === "number" ? params.exponent : 1.0,
    space_id: (params.space_id as string) ?? "",
    block: {
      annualized: typeof blk.annualized === "boolean" ? blk.annualized : EMPTY_DRAFT.block.annualized,
      size_type: (blk.size_type as "fixed" | "relative") ?? EMPTY_DRAFT.block.size_type,
      aggregation_logic: (blk.aggregation_logic as "average" | "offset") ?? EMPTY_DRAFT.block.aggregation_logic,
      temporal_position: (blk.temporal_position as "static" | "shifting") ?? EMPTY_DRAFT.block.temporal_position,
      decay_end_size_mult: typeof blk.decay_end_size_mult === "number" ? blk.decay_end_size_mult : EMPTY_DRAFT.block.decay_end_size_mult,
      decay_rate_prop_per_min: typeof blk.decay_rate_prop_per_min === "number" ? blk.decay_rate_prop_per_min : EMPTY_DRAFT.block.decay_rate_prop_per_min,
      var_fair_ratio: typeof blk.var_fair_ratio === "number" ? blk.var_fair_ratio : EMPTY_DRAFT.block.var_fair_ratio,
    },
    snapshot_headers: headers,
    snapshot_rows: rows,
  };
}

// ---------------------------------------------------------------------------
// Snapshot table sub-component
// ---------------------------------------------------------------------------

function SnapshotTable({
  headers,
  rows,
  readOnly,
  onHeaderChange,
  onAddHeader,
  onRemoveHeader,
  onCellChange,
  onAddRow,
  onRemoveRow,
}: {
  headers: string[];
  rows: SnapshotRowDraft[];
  readOnly: boolean;
  onHeaderChange: (idx: number, val: string) => void;
  onAddHeader: () => void;
  onRemoveHeader: (idx: number) => void;
  onCellChange: (rowIdx: number, col: string, val: string) => void;
  onAddRow: () => void;
  onRemoveRow: (rowIdx: number) => void;
}) {
  return (
    <div className="overflow-auto rounded-lg border border-black/[0.06]">
      <table className="w-full border-collapse text-[10px]">
        <thead className="bg-black/[0.03]">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-1.5 py-1 text-left">
                {readOnly ? (
                  <span className="font-medium text-mm-text-dim">{h}</span>
                ) : (
                  <div className="flex items-center gap-0.5">
                    <input
                      type="text"
                      value={h}
                      onChange={(e) => onHeaderChange(i, e.target.value)}
                      className="w-full min-w-[60px] rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[10px] font-medium text-mm-text-dim hover:border-black/[0.08] focus:border-mm-accent/40 focus:outline-none"
                    />
                    {headers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemoveHeader(i)}
                        className="shrink-0 text-[9px] text-mm-text-dim/50 hover:text-mm-error"
                        title="Remove column"
                      >
                        x
                      </button>
                    )}
                  </div>
                )}
              </th>
            ))}
            {!readOnly && (
              <th className="w-16 px-1.5 py-1">
                <button
                  type="button"
                  onClick={onAddHeader}
                  className="text-[9px] text-mm-accent hover:underline"
                  title="Add column"
                >
                  + col
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row._key} className="border-t border-black/[0.03]">
              {headers.map((h) => (
                <td key={h} className="px-1.5 py-0.5">
                  {readOnly ? (
                    <span className="font-mono text-[10px]">{String(row[h] ?? "")}</span>
                  ) : (
                    <input
                      type="text"
                      value={String(row[h] ?? "")}
                      onChange={(e) => onCellChange(ri, h, e.target.value)}
                      className="w-full min-w-[60px] rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[10px] hover:border-black/[0.08] focus:border-mm-accent/40 focus:outline-none"
                    />
                  )}
                </td>
              ))}
              {!readOnly && (
                <td className="px-1.5 py-0.5 text-center">
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveRow(ri)}
                      className="text-[9px] text-mm-text-dim/50 hover:text-mm-error"
                      title="Remove row"
                    >
                      x
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          onClick={onAddRow}
          className="w-full border-t border-black/[0.03] py-1 text-[9px] text-mm-accent hover:bg-mm-accent/5"
        >
          + Add row
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Unified block drawer — handles create, edit, and inspect modes.
 *
 * - **create:** Empty form, calls POST /api/blocks.
 * - **edit:** Pre-populated from the selected manual block, calls PATCH.
 * - **inspect:** Read-only view of a stream-sourced block.
 */
export function BlockDrawer({ open, mode, block, initialParams, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft when the drawer opens or the block changes
  useEffect(() => {
    if (!open) return;
    if (mode === "create" && initialParams) {
      setDraft(draftFromCommandParams(initialParams));
    } else if (mode === "create") {
      setDraft({ ...EMPTY_DRAFT, snapshot_rows: [{ ...EMPTY_DRAFT.snapshot_rows[0], _key: nextKey() }] });
    } else if (block) {
      setDraft(draftFromBlock(block));
    }
    setError(null);
  }, [open, mode, block, initialParams]);

  useKeyboardShortcut("Escape", () => open && onClose(), { mod: false });

  // -- Patch helpers --

  const patch = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  }, []);

  const patchBlock = useCallback(<K extends keyof DraftBlockConfig>(k: K, v: DraftBlockConfig[K]) => {
    setDraft((d) => ({ ...d, block: { ...d.block, [k]: v } }));
  }, []);

  // -- Snapshot table callbacks --

  const onHeaderChange = useCallback((idx: number, val: string) => {
    setDraft((d) => {
      const old = d.snapshot_headers[idx];
      const headers = [...d.snapshot_headers];
      headers[idx] = val;
      // Rename key in every row
      const rows = d.snapshot_rows.map((r) => {
        const nr = { ...r };
        if (old in nr) {
          nr[val] = nr[old];
          delete nr[old];
        }
        return nr;
      });
      return { ...d, snapshot_headers: headers, snapshot_rows: rows };
    });
  }, []);

  const onAddHeader = useCallback(() => {
    setDraft((d) => {
      const name = `col_${d.snapshot_headers.length}`;
      return {
        ...d,
        snapshot_headers: [...d.snapshot_headers, name],
        snapshot_rows: d.snapshot_rows.map((r) => ({ ...r, [name]: "" })),
      };
    });
  }, []);

  const onRemoveHeader = useCallback((idx: number) => {
    setDraft((d) => {
      const col = d.snapshot_headers[idx];
      const headers = d.snapshot_headers.filter((_, i) => i !== idx);
      const rows = d.snapshot_rows.map((r) => {
        const nr = { ...r };
        delete nr[col];
        return nr;
      });
      return { ...d, snapshot_headers: headers, snapshot_rows: rows };
    });
  }, []);

  const onCellChange = useCallback((rowIdx: number, col: string, val: string) => {
    setDraft((d) => {
      const rows = [...d.snapshot_rows];
      rows[rowIdx] = { ...rows[rowIdx], [col]: val };
      return { ...d, snapshot_rows: rows };
    });
  }, []);

  const onAddRow = useCallback(() => {
    setDraft((d) => ({
      ...d,
      snapshot_rows: [...d.snapshot_rows, emptyRow(d.snapshot_headers)],
    }));
  }, []);

  const onRemoveRow = useCallback((idx: number) => {
    setDraft((d) => ({
      ...d,
      snapshot_rows: d.snapshot_rows.filter((_, i) => i !== idx),
    }));
  }, []);

  // -- Validation --

  const readOnly = mode === "inspect";
  const canEdit = mode === "create" || mode === "edit";

  const valid =
    canEdit &&
    draft.stream_name.trim().length > 0 &&
    Number.isFinite(draft.scale) &&
    draft.scale !== 0 &&
    Number.isFinite(draft.offset) &&
    Number.isFinite(draft.exponent) &&
    draft.exponent !== 0 &&
    draft.snapshot_rows.length > 0 &&
    draft.block.var_fair_ratio > 0;

  // -- Submit --

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const key_cols = draft.key_cols_raw
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);

      // Convert snapshot rows: strip _key, coerce numeric cells, omit empty
      const snapshot_rows = draft.snapshot_rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const h of draft.snapshot_headers) {
          const cell = String(r[h] ?? "");
          if (cell === "") continue; // omit empty cells so server defaults apply
          out[h] = NUMERIC_RE.test(cell) ? parseFloat(cell) : cell;
        }
        return out;
      });

      if (mode === "create") {
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
      } else {
        // edit mode — PATCH
        const payload: UpdateBlockPayload = {
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
        };
        await updateBlock(draft.stream_name, payload);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const title =
    mode === "create"
      ? "Add Manual Block"
      : mode === "edit"
        ? `Edit Block: ${block?.block_name ?? ""}`
        : `Inspect Block: ${block?.block_name ?? ""}`;

  const subtitle =
    mode === "create"
      ? "Drop a one-off block into the pipeline without a stream."
      : mode === "edit"
        ? "Modify this manual block's parameters and snapshot."
        : "Read-only view of a stream-sourced block.";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        className="fixed right-0 top-[56px] z-50 flex h-[calc(100vh-56px)] w-[560px] flex-col border-l border-black/[0.06] bg-white/80 shadow-xl shadow-black/[0.06]"
        style={{ backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
          <div>
            <h3 className="zone-header">{title}</h3>
            <p className="mt-0.5 text-[10px] text-mm-text-dim">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            title="Close (Esc)"
          >
            &#x2715;
          </button>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* Identity */}
          <section className="flex flex-col gap-3">
            <Field
              type="text"
              label="Block / stream name"
              placeholder="e.g. manual_cpi_bump"
              value={draft.stream_name}
              onChange={(v) => patch("stream_name", v)}
              {...(mode !== "create" ? { hint: "Name is fixed after creation" } : {})}
            />
            {mode === "create" && (
              <Field
                type="text"
                label="Key columns (comma-separated)"
                placeholder="symbol, expiry"
                value={draft.key_cols_raw}
                onChange={(v) => patch("key_cols_raw", v)}
              />
            )}
            {mode !== "create" && (
              <Field
                type="text"
                label="Space id"
                value={draft.space_id}
                onChange={() => {}}
              />
            )}
            {mode === "create" && (
              <Field
                type="text"
                label="Space id (optional)"
                placeholder="leave blank to auto-compute"
                value={draft.space_id}
                onChange={(v) => patch("space_id", v)}
              />
            )}
          </section>

          {/* Target mapping */}
          <section className="flex flex-col gap-3 border-t border-black/[0.04] pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Target mapping
            </span>
            <div className="grid grid-cols-3 gap-3">
              <Field type="number" label="scale" value={draft.scale} onChange={(v) => canEdit ? patch("scale", v) : undefined} />
              <Field type="number" label="offset" value={draft.offset} onChange={(v) => canEdit ? patch("offset", v) : undefined} />
              <Field type="number" label="exponent" value={draft.exponent} onChange={(v) => canEdit ? patch("exponent", v) : undefined} />
            </div>
          </section>

          {/* Block shape */}
          <section className="flex flex-col gap-3 border-t border-black/[0.04] pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Block shape
            </span>
            <div className="grid grid-cols-2 gap-3">
              <Field
                type="toggle"
                label="Annualized"
                value={draft.block.annualized}
                onChange={(v) => canEdit ? patchBlock("annualized", v) : undefined}
              />
              <Field
                type="select"
                label="Size type"
                value={draft.block.size_type}
                options={["fixed", "relative"]}
                onChange={(v) => canEdit ? patchBlock("size_type", v as "fixed" | "relative") : undefined}
              />
              <Field
                type="select"
                label="Aggregation logic"
                value={draft.block.aggregation_logic}
                options={["average", "offset"]}
                onChange={(v) => canEdit ? patchBlock("aggregation_logic", v as "average" | "offset") : undefined}
              />
              <Field
                type="select"
                label="Temporal position"
                value={draft.block.temporal_position}
                options={["static", "shifting"]}
                onChange={(v) => canEdit ? patchBlock("temporal_position", v as "static" | "shifting") : undefined}
              />
              <Field
                type="number"
                label="decay_end_size_mult"
                value={draft.block.decay_end_size_mult}
                onChange={(v) => canEdit ? patchBlock("decay_end_size_mult", v) : undefined}
              />
              <Field
                type="number"
                label="decay_rate_prop_per_min"
                value={draft.block.decay_rate_prop_per_min}
                onChange={(v) => canEdit ? patchBlock("decay_rate_prop_per_min", v) : undefined}
              />
              <Field
                type="number"
                label="var_fair_ratio"
                value={draft.block.var_fair_ratio}
                onChange={(v) => canEdit ? patchBlock("var_fair_ratio", v) : undefined}
              />
            </div>
          </section>

          {/* Output values (inspect/edit only) */}
          {mode !== "create" && block && (
            <section className="flex flex-col gap-3 border-t border-black/[0.04] pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
                Output values (read-only)
              </span>
              <div className="grid grid-cols-3 gap-3">
                <ReadOnlyField label="fair" value={block.fair} />
                <ReadOnlyField label="market_fair" value={block.market_fair} />
                <ReadOnlyField label="edge" value={block.fair != null && block.market_fair != null ? block.fair - block.market_fair : null} />
                <ReadOnlyField label="variance" value={block.var} />
                <ReadOnlyField label="target_value" value={block.target_value} />
                <ReadOnlyField label="raw_value" value={block.raw_value} />
                <ReadOnlyField label="market_value" value={block.market_value} />
                <ReadOnlyField label="target_mkt_value" value={block.target_market_value} />
              </div>
            </section>
          )}

          {/* Snapshot rows */}
          <section className="flex flex-col gap-2 border-t border-black/[0.04] pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Snapshot rows
            </span>
            <SnapshotTable
              headers={draft.snapshot_headers}
              rows={draft.snapshot_rows}
              readOnly={readOnly}
              onHeaderChange={onHeaderChange}
              onAddHeader={onAddHeader}
              onRemoveHeader={onRemoveHeader}
              onCellChange={onCellChange}
              onAddRow={onAddRow}
              onRemoveRow={onRemoveRow}
            />
          </section>

          {error && (
            <p className="rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-black/[0.06] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {canEdit && (
            <button
              type="button"
              disabled={!valid || submitting}
              onClick={submit}
              className="rounded-lg bg-mm-accent px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting
                ? mode === "create"
                  ? "Creating..."
                  : "Saving..."
                : mode === "create"
                  ? "Create block"
                  : "Save changes"}
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small helper for read-only numeric fields in the output section
// ---------------------------------------------------------------------------

function ReadOnlyField({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-mm-text-dim">{label}</span>
      <span className="font-mono text-[11px] tabular-nums">
        {value != null ? value.toFixed(4) : "—"}
      </span>
    </div>
  );
}
