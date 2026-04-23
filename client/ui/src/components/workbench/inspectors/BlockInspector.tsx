import { useCallback, useEffect, useState } from "react";
import { useFocus } from "../../../providers/FocusProvider";
import { fetchBlocks } from "../../../services/blockApi";
import type { BlockKey, BlockRow } from "../../../types";
import { POLL_INTERVAL_BLOCKS_MS } from "../../../constants";
import { blockKeyEquals, blockKeyOf, valColor } from "../../../utils";
import { Field } from "../../studio/sections/Field";
import { SnapshotTable } from "../../studio/brain/BlockDrawerParts";
import {
  draftFromBlock,
  type Draft,
  type DraftBlockConfig,
} from "../../studio/brain/blockDrawerState";
import { useSnapshotEditor } from "../../studio/brain/useSnapshotEditor";
import { useBlockDraftSubmit } from "../../studio/brain/useBlockDraftSubmit";

interface BlockInspectorProps {
  blockKey: BlockKey;
}

/**
 * Full-detail block inspector — replaces the old read-only summary +
 * separate BlockDrawer "inspect" mode. Everything that used to live in the
 * drawer (engine params, outputs, snapshot rows) renders here in the rail.
 *
 * Lookup is by the full composite `BlockKey`, not by `block_name` — the
 * same name is reused across dimensions (e.g. `ema_iv` on every
 * symbol/expiry it's attached to), so a name-only match would silently
 * show the first dim's row instead of the clicked one.
 *
 * Manual blocks are fully editable in place: change params + snapshot rows,
 * hit Save → posts a PATCH and re-runs the pipeline. Stream-sourced blocks
 * are read-only — they're driven by external snapshot ingestion via the
 * SDK, and the registry rejects PATCHes against them anyway.
 */
export function BlockInspector({ blockKey }: BlockInspectorProps) {
  const { clearFocus } = useFocus();
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch blocks on a poll. We could subscribe directly to the
  // EditableBlockTable's data but that requires a global cache — for one
  // inspector at a time, polling is simpler and the refresh interval
  // matches the table's.
  useEffect(() => {
    let aborted = false;
    const load = () => {
      fetchBlocks()
        .then((rows) => { if (!aborted) { setBlocks(rows); setError(null); } })
        .catch((err: unknown) => {
          if (!aborted) setError(err instanceof Error ? err.message : String(err));
        });
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_BLOCKS_MS);
    return () => { aborted = true; clearInterval(id); };
  }, []);

  const block = blocks?.find((b) => blockKeyEquals(blockKeyOf(b), blockKey)) ?? null;
  const isManual = block?.source === "manual";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-black/[0.06] px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Block {block && (
              <span
                className={`ml-1 rounded px-1 py-0.5 text-[8px] font-bold ${
                  isManual ? "bg-mm-warn/15 text-mm-warn" : "bg-mm-accent/10 text-mm-accent"
                }`}
              >
                {block.source}
              </span>
            )}
          </span>
          <span className="text-[13px] font-semibold text-mm-text">{blockKey.blockName}</span>
          <span className="text-[9px] text-mm-text-subtle">
            {blockKey.streamName} · {blockKey.symbol} · {blockKey.expiry}
            {block && ` · ${block.space_id}`}
          </span>
        </div>
        <button
          type="button"
          onClick={clearFocus}
          className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          title="Clear focus (Esc)"
        >
          ✕
        </button>
      </header>

      {error && <p className="px-3 py-2 text-[10px] text-mm-error">{error}</p>}

      {block == null ? (
        <p className="px-3 py-2 text-[11px] text-mm-text-dim">
          {blocks == null ? "Loading block…" : `Block "${blockKey.blockName}" no longer exists.`}
        </p>
      ) : (
        <BlockEditor block={block} isManual={isManual} />
      )}
    </div>
  );
}

/**
 * Editable / readonly block form. Hosts the same Field + SnapshotTable
 * components used by the create-mode BlockDrawer so the two surfaces stay
 * visually consistent.
 */
function BlockEditor({ block, isManual }: { block: BlockRow; isManual: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => draftFromBlock(block));
  // Re-sync the draft whenever the underlying block identity changes so
  // navigating between blocks doesn't show stale edits. Key on the full
  // composite — `block_name` alone collides across dimensions.
  useEffect(() => { setDraft(draftFromBlock(block)); }, [
    block.block_name, block.stream_name, block.symbol, block.expiry, block.start_timestamp,
  ]);

  const snapshotEditor = useSnapshotEditor(setDraft);

  // Use a no-op onSaved/onClose since we want to stay in the inspector after
  // saving (the parent's polling will refresh the data).
  const noOp = useCallback(() => { /* noop */ }, []);
  const { submitting, error, submit } = useBlockDraftSubmit(
    isManual ? "edit" : "inspect",
    noOp,
    noOp,
  );

  const patch = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  }, []);
  const patchBlock = useCallback(<K extends keyof DraftBlockConfig>(k: K, v: DraftBlockConfig[K]) => {
    setDraft((d) => ({ ...d, block: { ...d.block, [k]: v } }));
  }, []);

  const valid =
    isManual &&
    draft.stream_name.trim().length > 0 &&
    Number.isFinite(draft.scale) &&
    draft.scale !== 0 &&
    Number.isFinite(draft.offset) &&
    Number.isFinite(draft.exponent) &&
    draft.exponent !== 0 &&
    draft.snapshot_rows.length > 0 &&
    draft.block.var_fair_ratio > 0;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2 text-[10px]">
        {/* Outputs (always read-only). Market-implied value lives at the
            space + aggregate layer, not on individual blocks — see the
            CellInspector for space totals. */}
        <section className="grid grid-cols-2 gap-1.5">
          <Stat label="Fair" value={block.fair ?? 0} decimals={4} />
          <Stat label="Variance" value={block.var ?? 0} decimals={4} />
        </section>

        {/* Target mapping */}
        <section className="flex flex-col gap-2 border-t border-black/[0.05] pt-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Target mapping
          </span>
          <div className="grid grid-cols-3 gap-2">
            <Field type="number" label="scale" value={draft.scale} disabled={!isManual} onChange={(v) => patch("scale", v)} />
            <Field type="number" label="offset" value={draft.offset} disabled={!isManual} onChange={(v) => patch("offset", v)} />
            <Field type="number" label="exponent" value={draft.exponent} disabled={!isManual} onChange={(v) => patch("exponent", v)} />
          </div>
        </section>

        {/* Block shape */}
        <section className="flex flex-col gap-2 border-t border-black/[0.05] pt-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Block shape
          </span>
          <div className="grid grid-cols-2 gap-2">
            <Field
              type="toggle"
              label="Annualized"
              value={draft.block.annualized}
              disabled={!isManual}
              onChange={(v) => patchBlock("annualized", v)}
            />
            <Field
              type="select"
              label="Temporal position"
              value={draft.block.temporal_position}
              options={["static", "shifting"]}
              disabled={!isManual}
              onChange={(v) => patchBlock("temporal_position", v as "static" | "shifting")}
            />
            <Field
              type="number"
              label="decay_end_size_mult"
              value={draft.block.decay_end_size_mult}
              disabled={!isManual}
              onChange={(v) => patchBlock("decay_end_size_mult", v)}
            />
            <Field
              type="number"
              label="decay_rate_prop_per_min"
              value={draft.block.decay_rate_prop_per_min}
              disabled={!isManual}
              onChange={(v) => patchBlock("decay_rate_prop_per_min", v)}
            />
            <Field
              type="number"
              label="var_fair_ratio"
              value={draft.block.var_fair_ratio}
              disabled={!isManual}
              onChange={(v) => patchBlock("var_fair_ratio", v)}
            />
          </div>
        </section>

        {/* Snapshot rows */}
        <section className="flex flex-col gap-1.5 border-t border-black/[0.05] pt-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Snapshot rows
          </span>
          <SnapshotTable
            headers={draft.snapshot_headers}
            rows={draft.snapshot_rows}
            readOnly={!isManual}
            {...snapshotEditor}
          />
        </section>

        {error && (
          <p className="rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
            {error}
          </p>
        )}

        {!isManual && (
          <p className="text-[10px] text-mm-text-dim">
            Stream-sourced block — read-only. Edit via the SDK or push new snapshot rows on the client.
          </p>
        )}
      </div>

      {isManual && (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-black/[0.06] px-3 py-2">
          <button
            type="button"
            disabled={!valid || submitting}
            onClick={() => submit(draft)}
            className="btn-accent-gradient rounded-md px-3 py-1 text-[10px] font-semibold"
          >
            <span className="relative">{submitting ? "Saving…" : "Save changes"}</span>
          </button>
        </footer>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  decimals,
  colored,
}: {
  label: string;
  value: number | null;
  decimals: number;
  colored?: boolean;
}) {
  const isNull = value == null;
  return (
    <div className="glass-card flex flex-col gap-0.5 px-2 py-1">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">{label}</span>
      <span className={`font-mono text-[11px] font-semibold tabular-nums ${colored && !isNull ? valColor(value) : "text-mm-text"}`}>
        {isNull ? "—" : `${colored && value > 0 ? "+" : ""}${value.toFixed(decimals)}`}
      </span>
    </div>
  );
}
