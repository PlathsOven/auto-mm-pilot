import { useCallback, useEffect, useState } from "react";
import { useKeyboardShortcut } from "../../../hooks/useKeyboardShortcut";
import { Field } from "../sections/Field";
import type { BlockRow } from "../../../types";
import {
  type DrawerMode,
  type Draft,
  type DraftBlockConfig,
  EMPTY_DRAFT,
  nextKey,
  draftFromBlock,
  draftFromCommandParams,
} from "./blockDrawerState";
import { SnapshotTable, ReadOnlyField } from "./BlockDrawerParts";
import { useSnapshotEditor } from "./useSnapshotEditor";
import { useBlockDraftSubmit } from "./useBlockDraftSubmit";

// Re-export so existing imports from this file keep working
export type { DrawerMode } from "./blockDrawerState";

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

/**
 * Unified block drawer — handles create, edit, and inspect modes.
 *
 * - **create:** Empty form, calls POST /api/blocks.
 * - **edit:** Pre-populated from the selected manual block, calls PATCH.
 * - **inspect:** Read-only view of a stream-sourced block.
 */
export function BlockDrawer({ open, mode, block, initialParams, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const { submitting, error, submit, clearError } = useBlockDraftSubmit(mode, onSaved, onClose);
  const snapshotEditor = useSnapshotEditor(setDraft);

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
    clearError();
  }, [open, mode, block, initialParams, clearError]);

  useKeyboardShortcut("Escape", () => open && onClose(), { mod: false });

  const patch = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  }, []);

  const patchBlock = useCallback(<K extends keyof DraftBlockConfig>(k: K, v: DraftBlockConfig[K]) => {
    setDraft((d) => ({ ...d, block: { ...d.block, [k]: v } }));
  }, []);

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
              <Field type="text" label="Space id" value={draft.space_id} onChange={() => {}} />
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
              {...snapshotEditor}
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
              onClick={() => submit(draft)}
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
