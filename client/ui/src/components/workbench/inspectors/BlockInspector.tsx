import { useEffect, useState } from "react";
import { useFocus } from "../../../providers/FocusProvider";
import { fetchBlocks } from "../../../services/blockApi";
import type { BlockRow } from "../../../types";
import { POLL_INTERVAL_BLOCKS_MS } from "../../../constants";
import { valColor } from "../../../utils";

interface BlockInspectorProps {
  name: string;
}

/**
 * Inspector view for a focused block.
 *
 * Read-only summary of the block's engine parameters and current outputs.
 * Editing still happens via the existing `<BlockDrawer/>` — opened from the
 * block table's explicit Edit button (or double-click), not from this panel,
 * so the inspector stays a pure read surface.
 */
export function BlockInspector({ name }: BlockInspectorProps) {
  const { clearFocus } = useFocus();
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;

    const load = () => {
      fetchBlocks()
        .then((rows) => {
          if (aborted) return;
          setBlocks(rows);
          setError(null);
        })
        .catch((err: unknown) => {
          if (aborted) return;
          setError(err instanceof Error ? err.message : String(err));
        });
    };

    load();
    const id = setInterval(load, POLL_INTERVAL_BLOCKS_MS);
    return () => { aborted = true; clearInterval(id); };
  }, []);

  const block = blocks?.find((b) => b.block_name === name) ?? null;
  const edge = block ? (block.fair ?? 0) - (block.market_fair ?? 0) : 0;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-2 border-b border-black/[0.06] pb-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">Block</span>
          <span className="text-[14px] font-semibold text-mm-text">{name}</span>
          {block && (
            <span className="text-[9px] text-mm-text-subtle">
              {block.symbol} · {block.expiry} · {block.space_id} · {block.source}
            </span>
          )}
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

      {error && <p className="text-[10px] text-mm-error">{error}</p>}

      {block == null ? (
        <p className="text-[11px] text-mm-text-dim">
          {blocks == null ? "Loading block…" : `Block "${name}" no longer exists.`}
        </p>
      ) : (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          <section className="grid grid-cols-2 gap-2">
            <Stat label="Edge" value={edge} decimals={4} colored />
            <Stat label="Variance" value={block.var ?? 0} decimals={4} />
            <Stat label="Fair" value={block.fair ?? 0} decimals={4} />
            <Stat label="Market Fair" value={block.market_fair ?? 0} decimals={4} />
          </section>

          <section className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Engine parameters
            </span>
            <ParamRow label="Stream" value={block.stream_name} />
            <ParamRow label="Annualised" value={block.annualized ? "yes" : "no"} />
            <ParamRow label="Size type" value={block.size_type} />
            <ParamRow label="Aggregation" value={block.aggregation_logic} />
            <ParamRow label="Temporal pos" value={block.temporal_position} />
            <ParamRow label="Decay end" value={block.decay_end_size_mult.toFixed(4)} />
            <ParamRow label="Decay rate (per min)" value={block.decay_rate_prop_per_min.toFixed(6)} />
            <ParamRow label="Var/Fair ratio" value={block.var_fair_ratio.toFixed(4)} />
            <ParamRow label="Scale" value={block.scale.toFixed(4)} />
            <ParamRow label="Offset" value={block.offset.toFixed(4)} />
            <ParamRow label="Exponent" value={block.exponent.toFixed(4)} />
          </section>

          <section className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Outputs
            </span>
            <ParamRow label="Target value" value={block.target_value.toFixed(4)} />
            <ParamRow label="Raw value" value={block.raw_value.toFixed(4)} />
            <ParamRow label="Market value" value={block.market_value?.toFixed(4) ?? "—"} />
            <ParamRow label="Target mkt value" value={block.target_market_value?.toFixed(4) ?? "—"} />
          </section>

          <section className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Timing
            </span>
            <ParamRow label="Start" value={block.start_timestamp ?? "—"} />
            <ParamRow label="Updated" value={block.updated_at ?? "—"} />
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  decimals,
  colored,
}: {
  label: string;
  value: number;
  decimals: number;
  colored?: boolean;
}) {
  return (
    <div className="glass-card flex flex-col gap-0.5 px-2.5 py-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
        {label}
      </span>
      <span className={`font-mono text-[12px] font-semibold tabular-nums ${colored ? valColor(value) : "text-mm-text"}`}>
        {colored && value > 0 ? "+" : ""}
        {value.toFixed(decimals)}
      </span>
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px]">
      <span className="text-mm-text-dim">{label}</span>
      <span className="font-mono tabular-nums text-mm-text">{value}</span>
    </div>
  );
}
