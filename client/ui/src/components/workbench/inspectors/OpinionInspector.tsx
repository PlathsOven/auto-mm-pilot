/**
 * Inspector for a focused opinion.
 *
 * An opinion is the trader's belief — a data-driven stream or a
 * discretionary manual block. This view shows what matters to the trader:
 * the editable description, any Build-orchestrator concerns that surfaced
 * at commit, the live time series, and the concrete blocks this opinion
 * materialised into on the pipeline.
 *
 * Block-level debugging (per-dim numeric detail, engine params) is one
 * tab away in the Blocks tab of the OpinionsPanel — click a block-family
 * row there and the full BlockInspector opens.
 */
import { useCallback, useEffect, useState } from "react";
import { useFocus } from "../../../providers/FocusProvider";
import {
  fetchOpinions,
  patchOpinionActive,
  patchOpinionDescription,
} from "../../../services/opinionsApi";
import { fetchBlocks } from "../../../services/blockApi";
import type { BlockRow, Opinion } from "../../../types";
import { POLL_INTERVAL_BLOCKS_MS } from "../../../constants";
import { formatNullable, formatAge, valColor } from "../../../utils";
import { StreamTimeseriesView } from "./StreamTimeseriesView";

interface Props {
  name: string;
}

const OPINION_POLL_INTERVAL_MS = 4000;

export function OpinionInspector({ name }: Props) {
  const { clearFocus } = useFocus();
  const [opinion, setOpinion] = useState<Opinion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState(false);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const all = await fetchOpinions();
        if (aborted) return;
        const match = all.find((o) => o.name === name) ?? null;
        setOpinion(match);
        setError(null);
      } catch (err) {
        if (aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    load();
    const id = setInterval(load, OPINION_POLL_INTERVAL_MS);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, [name]);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const all = await fetchBlocks();
        if (aborted) return;
        setBlocks(all.filter((b) => b.stream_name === name));
      } catch {
        // Block fetch failing is non-fatal for the inspector — the main
        // opinion metadata still renders.
      }
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_BLOCKS_MS);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, [name]);

  const onToggleActive = useCallback(async () => {
    if (!opinion) return;
    setTogglePending(true);
    try {
      const updated = await patchOpinionActive(name, !opinion.active);
      setOpinion(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglePending(false);
    }
  }, [name, opinion]);

  const onDescriptionSave = useCallback(
    async (next: string) => {
      try {
        const updated = await patchOpinionDescription(name, next.trim() ? next : null);
        setOpinion(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [name],
  );

  if (opinion == null && error == null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[11px] text-mm-text-dim">Loading opinion…</p>
      </div>
    );
  }

  if (opinion == null) {
    return (
      <div className="flex h-full flex-col">
        <InspectorHeader
          title="Opinion"
          subtitle={name}
          onClear={clearFocus}
        />
        <div className="p-3">
          <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">
            {error ?? "Opinion no longer exists."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-black/[0.06] px-3 pb-2 pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Opinion
            <span
              className={`ml-1 rounded px-1 py-0.5 text-[8px] font-bold uppercase ${
                opinion.kind === "stream"
                  ? "bg-mm-accent/10 text-mm-accent"
                  : "bg-mm-warn/15 text-mm-warn"
              }`}
            >
              {opinion.kind === "stream" ? "Data" : "View"}
            </span>
            {!opinion.active && (
              <span className="ml-1 rounded bg-mm-text-dim/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-mm-text-dim">
                Inactive
              </span>
            )}
          </span>
          <span className="text-[13px] font-semibold text-mm-text">{opinion.name}</span>
          <span className="text-[9px] text-mm-text-subtle">
            {opinion.block_count} block{opinion.block_count === 1 ? "" : "s"}
            {opinion.last_update ? ` · updated ${formatAge(Date.now() - new Date(opinion.last_update).getTime())}` : " · no data yet"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleActive}
            disabled={togglePending}
            className={`whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-wait disabled:opacity-50 ${
              opinion.active
                ? "border border-mm-error/30 text-mm-error hover:bg-mm-error/10"
                : "border border-mm-accent/30 text-mm-accent hover:bg-mm-accent/10"
            }`}
            title={
              opinion.active
                ? "Hide from pipeline (data is preserved)"
                : "Include in pipeline"
            }
          >
            {opinion.active ? "Deactivate" : "Reactivate"}
          </button>
          <button
            type="button"
            onClick={clearFocus}
            className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            title="Clear focus (Esc)"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {error && (
          <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">
            {error}
          </p>
        )}

        <DescriptionCard
          description={opinion.description}
          originalPhrasing={opinion.original_phrasing}
          onSave={onDescriptionSave}
        />

        {opinion.has_concerns && <ConcernsCard />}

        <section className="flex min-h-[320px] flex-col gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Live data
          </span>
          <StreamTimeseriesView streamName={name} />
        </section>

        <BlocksSummary blocks={blocks} />
      </div>
    </div>
  );
}

function InspectorHeader({
  title,
  subtitle,
  onClear,
}: {
  title: string;
  subtitle: string;
  onClear: () => void;
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-2 border-b border-black/[0.06] px-3 pb-2 pt-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
          {title}
        </span>
        <span className="text-[13px] font-semibold text-mm-text">{subtitle}</span>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
        title="Clear focus (Esc)"
      >
        ✕
      </button>
    </header>
  );
}

function DescriptionCard({
  description,
  originalPhrasing,
  onSave,
}: {
  description: string | null;
  originalPhrasing: string | null;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? "");

  useEffect(() => {
    setDraft(description ?? "");
  }, [description]);

  const hasExplicitDescription = description != null && description.trim().length > 0;
  const displayText = hasExplicitDescription
    ? description
    : originalPhrasing ?? null;

  const commit = useCallback(() => {
    setEditing(false);
    if (draft !== (description ?? "")) onSave(draft);
  }, [draft, description, onSave]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(description ?? "");
  }, [description]);

  if (editing) {
    return (
      <section className="flex flex-col gap-1 rounded-md border border-mm-accent/30 bg-white/80 px-3 py-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Description
        </span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={originalPhrasing ?? "What's this opinion about?"}
          autoFocus
          className="min-h-[48px] resize-y rounded border border-black/[0.08] bg-white px-2 py-1 text-[12px] text-mm-text focus:border-mm-accent focus:outline-none focus:ring-1 focus:ring-mm-accent/40"
        />
        <span className="text-[9px] text-mm-text-subtle">
          ⌘↵ to save · Esc to cancel{originalPhrasing ? " · Build-orchestrator phrasing preserved" : ""}
        </span>
      </section>
    );
  }

  return (
    <section
      className="flex cursor-pointer flex-col gap-1 rounded-md border border-black/[0.06] bg-white/40 px-3 py-2 transition-colors hover:bg-white/60"
      onClick={() => setEditing(true)}
      title="Click to edit the description"
    >
      <span className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
        <span>Description</span>
        <span className="text-mm-text-subtle">click to edit</span>
      </span>
      {displayText ? (
        <p
          className={`text-[12px] ${hasExplicitDescription ? "text-mm-text" : "italic text-mm-text-subtle"}`}
        >
          {hasExplicitDescription ? displayText : `"${displayText}"`}
        </p>
      ) : (
        <p className="text-[12px] italic text-mm-text-subtle">
          No description. Click to add one.
        </p>
      )}
      {hasExplicitDescription && originalPhrasing && (
        <p className="text-[10px] italic text-mm-text-subtle">
          Originally: &ldquo;{originalPhrasing}&rdquo;
        </p>
      )}
    </section>
  );
}

function ConcernsCard() {
  return (
    <section className="rounded-md border border-amber-400/40 bg-amber-50/60 px-3 py-2">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-800">
        Concerns raised at commit
      </span>
      <p className="mt-0.5 text-[11px] text-amber-900">
        The Build orchestrator's critique flagged framework concerns on this
        opinion — see the Build-intent card in the Blocks tab for details.
      </p>
    </section>
  );
}

function BlocksSummary({ blocks }: { blocks: BlockRow[] }) {
  if (blocks.length === 0) {
    return (
      <section className="flex flex-col gap-1 rounded-md border border-black/[0.06] bg-white/40 px-3 py-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Blocks
        </span>
        <p className="text-[11px] italic text-mm-text-subtle">
          No blocks have materialised yet. Push a snapshot or wait for the next pipeline tick.
        </p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-1 rounded-md border border-black/[0.06] bg-white/40 px-3 py-2">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
        Blocks ({blocks.length})
      </span>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead className="text-mm-text-dim">
            <tr>
              <th className="px-1.5 py-0.5 text-left font-medium">Symbol</th>
              <th className="px-1.5 py-0.5 text-left font-medium">Expiry</th>
              <th className="px-1.5 py-0.5 text-left font-medium">Space</th>
              <th className="px-1.5 py-0.5 text-right font-medium">Fair</th>
              <th className="px-1.5 py-0.5 text-right font-medium">Var</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={`${b.symbol}|${b.expiry}|${b.space_id}|${b.block_name}`} className="border-t border-black/[0.04]">
                <td className="px-1.5 py-0.5 text-mm-text">{b.symbol}</td>
                <td className="px-1.5 py-0.5 text-mm-text">{b.expiry}</td>
                <td className="px-1.5 py-0.5 text-mm-text-subtle">{b.space_id}</td>
                <td className={`px-1.5 py-0.5 text-right font-mono tabular-nums ${b.fair != null ? valColor(b.fair) : ""}`}>
                  {formatNullable(b.fair)}
                </td>
                <td className="px-1.5 py-0.5 text-right font-mono tabular-nums">
                  {formatNullable(b.var)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
