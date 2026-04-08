import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBlocks } from "../../../services/blockApi";
import type { BlockRow } from "../../../types";
import { valColor } from "../../../utils";

const POLL_INTERVAL_MS = 5000;

type SortKey = "block" | "fair" | "var" | "edge";

interface Props {
  /** Slot rendered on the right of the header — used by BrainPage to host the "Add manual block" button. */
  headerAction?: React.ReactNode;
  /** Fires whenever the block list refreshes so parents can chain actions. */
  onRefresh?: () => void;
  /** Forces a refresh when this key changes (parent incrementing it after a mutation). */
  refreshKey?: number;
}

/**
 * Block inspector for Studio → Brain.
 *
 * Read-only today; Group E will add inline editing for `source === "manual"`
 * rows and wire the "Add manual block" button via `headerAction`. Stream-
 * sourced blocks stay read-only because they'll be overwritten on the next
 * stream snapshot.
 */
export function EditableBlockTable({ headerAction, onRefresh, refreshKey }: Props) {
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("fair");

  const refresh = useCallback(async () => {
    try {
      const data = await fetchBlocks();
      setBlocks(data);
      setError(null);
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Parent can force a refresh after a mutation
  useEffect(() => {
    if (refreshKey !== undefined) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = blocks;
    if (q) {
      list = list.filter(
        (b) =>
          b.block_name.toLowerCase().includes(q) ||
          b.stream_name.toLowerCase().includes(q) ||
          b.symbol.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      const af = a.fair ?? 0;
      const bf = b.fair ?? 0;
      const av = a.var ?? 0;
      const bv = b.var ?? 0;
      const ae = (a.fair ?? 0) - (a.market_fair ?? 0);
      const be = (b.fair ?? 0) - (b.market_fair ?? 0);
      switch (sortKey) {
        case "block":
          return a.block_name.localeCompare(b.block_name);
        case "fair":
          return Math.abs(bf) - Math.abs(af);
        case "var":
          return bv - av;
        case "edge":
          return Math.abs(be) - Math.abs(ae);
      }
    });
  }, [blocks, filter, sortKey]);

  return (
    <section className="rounded-xl border border-mm-border/60 bg-mm-bg/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="zone-header">Block Inspector</h3>
        <span className="text-[10px] text-mm-text-dim">({blocks.length} total)</span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="form-input ml-auto max-w-xs"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="form-input max-w-[120px]"
        >
          <option value="fair">|fair|</option>
          <option value="edge">|edge|</option>
          <option value="var">variance</option>
          <option value="block">name</option>
        </select>
        {headerAction}
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
          {error}
        </p>
      )}

      {loading && blocks.length === 0 ? (
        <p className="text-[11px] text-mm-text-dim">Loading blocks…</p>
      ) : (
        <div className="overflow-auto rounded-lg border border-mm-border/40">
          <table className="w-full border-collapse text-[10px]">
            <thead className="bg-mm-bg-deep/60 text-mm-text-dim">
              <tr>
                <Th>Block</Th>
                <Th>Source</Th>
                <Th>Stream</Th>
                <Th>Symbol</Th>
                <Th>Expiry</Th>
                <Th>Space</Th>
                <Th align="right">Fair</Th>
                <Th align="right">Market Fair</Th>
                <Th align="right">Edge</Th>
                <Th align="right">Variance</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => {
                const fair = b.fair ?? 0;
                const marketFair = b.market_fair ?? 0;
                const edge = fair - marketFair;
                const variance = b.var ?? 0;
                return (
                  <tr
                    key={b.block_name}
                    className="border-t border-mm-border/20 transition-colors hover:bg-mm-accent/5"
                  >
                    <Td className="font-medium text-mm-text">{b.block_name}</Td>
                    <Td>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                          b.source === "manual"
                            ? "bg-mm-warn/15 text-mm-warn"
                            : "bg-mm-accent/10 text-mm-accent"
                        }`}
                      >
                        {b.source}
                      </span>
                    </Td>
                    <Td>{b.stream_name}</Td>
                    <Td>{b.symbol}</Td>
                    <Td>{b.expiry}</Td>
                    <Td>{b.space_id}</Td>
                    <Td align="right" className="font-mono tabular-nums">{fair.toFixed(4)}</Td>
                    <Td align="right" className="font-mono tabular-nums">{marketFair.toFixed(4)}</Td>
                    <Td align="right" className={`font-mono tabular-nums ${valColor(edge)}`}>
                      {edge >= 0 ? "+" : ""}
                      {edge.toFixed(4)}
                    </Td>
                    <Td align="right" className="font-mono tabular-nums">{variance.toFixed(4)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-2 py-1.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  align = "left",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <td className={`px-2 py-1.5 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}
