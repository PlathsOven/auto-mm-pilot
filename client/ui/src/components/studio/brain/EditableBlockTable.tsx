import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBlocks } from "../../../services/blockApi";
import type { BlockRow } from "../../../types";
import {
  blockKeyEquals,
  blockKeyOf,
  blockKeyToString,
  formatNullable,
  safeGetItem,
  safeSetItem,
  valColor,
} from "../../../utils";
import { POLL_INTERVAL_BLOCKS_MS, BLOCKS_FOLLOW_FOCUS_KEY } from "../../../constants";
import { useFocus } from "../../../providers/FocusProvider";

/**
 * Block Inspector — family-grouped variant.
 *
 * Default row = one per (block_name, stream_name) family. The fair / var
 * summary shows the min…max across the family's dims so the trader can sanity
 * check at a glance; the chevron expands inline to per-dim rows for the
 * numeric drill-down. This was the user-journey improvement behind the
 * Opinions reframe — a single ema_iv opinion no longer duplicates into
 * 8 rows across symbols/expiries.
 *
 * Clicking a family row body sets `opinion` focus (the Opinions tab +
 * OpinionInspector are the deep-dive surface); clicking a dim row sets
 * `block` focus (engine-level inspection via the existing BlockInspector).
 *
 * Preserved from the pre-collapse variant:
 *  - symbol / expiry / stream / source filter dropdowns
 *  - global text filter (matches block / stream / symbol / expiry / space)
 *  - follow-focus auto-filter (cell / symbol / expiry / stream / block)
 *  - pipeline polling (POLL_INTERVAL_BLOCKS_MS)
 */

const ALL = "__all__";

interface Props {
  headerAction?: React.ReactNode;
  onRefresh?: () => void;
  refreshKey?: number;
  /** Per-dim row click — sets block focus so BlockInspector opens. */
  onRowClick?: (block: BlockRow) => void;
  /** Optional "edit this block" affordance (double-click + Edit btn). */
  onRowEdit?: (block: BlockRow) => void;
}

interface BlockFamily {
  key: string;                 // "stream|block"
  block_name: string;
  stream_name: string;
  source: "stream" | "manual";
  dims: BlockRow[];
  symbols: string[];
  expiries: string[];
  fair_min: number | null;
  fair_max: number | null;
  var_min: number | null;
  var_max: number | null;
}

export function EditableBlockTable({ headerAction, onRefresh, refreshKey, onRowClick, onRowEdit }: Props) {
  const { focus, setFocus } = useFocus();
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [symbolFilter, setSymbolFilter] = useState<string>(ALL);
  const [expiryFilter, setExpiryFilter] = useState<string>(ALL);
  const [streamFilter, setStreamFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [followFocus, setFollowFocus] = useState<boolean>(
    () => safeGetItem(BLOCKS_FOLLOW_FOCUS_KEY) !== "false",
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-filter to the focused dimension when "follow focus" is on.
  useEffect(() => {
    if (!followFocus) return;
    if (!focus) {
      setSymbolFilter(ALL);
      setExpiryFilter(ALL);
      setStreamFilter(ALL);
      return;
    }
    if (focus.kind === "cell") {
      setSymbolFilter(focus.symbol);
      setExpiryFilter(focus.expiry);
      setStreamFilter(ALL);
    } else if (focus.kind === "symbol") {
      setSymbolFilter(focus.symbol);
      setExpiryFilter(ALL);
      setStreamFilter(ALL);
    } else if (focus.kind === "expiry") {
      setSymbolFilter(ALL);
      setExpiryFilter(focus.expiry);
      setStreamFilter(ALL);
    } else if (focus.kind === "stream" || focus.kind === "opinion") {
      setSymbolFilter(ALL);
      setExpiryFilter(ALL);
      setStreamFilter(focus.name);
    } else if (focus.kind === "block") {
      setSymbolFilter(ALL);
      setExpiryFilter(ALL);
      setStreamFilter(ALL);
    }
  }, [focus, followFocus]);

  // Auto-expand the family containing a block-focused row so the dim stays visible.
  useEffect(() => {
    if (focus?.kind !== "block") return;
    const key = `${focus.key.streamName}|${focus.key.blockName}`;
    setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [focus]);

  const persistFollowFocus = useCallback((next: boolean) => {
    setFollowFocus(next);
    safeSetItem(BLOCKS_FOLLOW_FOCUS_KEY, String(next));
  }, []);

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
    const id = setInterval(refresh, POLL_INTERVAL_BLOCKS_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (refreshKey !== undefined) refresh();
  }, [refreshKey, refresh]);

  // Filter per-dim rows first, then group — this way a "BTC" filter hides
  // any dim that isn't BTC even if the family has other dims, and the
  // family rollup reflects the visible subset.
  const filteredDims = useMemo(() => {
    const q = globalFilter.trim().toLowerCase();
    return blocks.filter((b) => {
      if (symbolFilter !== ALL && b.symbol !== symbolFilter) return false;
      if (expiryFilter !== ALL && b.expiry !== expiryFilter) return false;
      if (streamFilter !== ALL && b.stream_name !== streamFilter) return false;
      if (sourceFilter !== ALL && b.source !== sourceFilter) return false;
      if (q && !matchesGlobalFilter(b, q)) return false;
      return true;
    });
  }, [blocks, symbolFilter, expiryFilter, streamFilter, sourceFilter, globalFilter]);

  const families = useMemo(() => groupIntoFamilies(filteredDims), [filteredDims]);

  // Stable sort: stream_name then block_name. Output-column sort isn't
  // exposed today (it was rarely used in the flat view and the range
  // summary makes it less useful here).
  const sortedFamilies = useMemo(() => {
    return [...families].sort((a, b) => {
      if (a.stream_name !== b.stream_name) {
        return a.stream_name.localeCompare(b.stream_name);
      }
      return a.block_name.localeCompare(b.block_name);
    });
  }, [families]);

  const { symbolOptions, expiryOptions, streamOptions, sourceCounts } = useMemo(() => {
    const syms = new Set<string>();
    const exps = new Set<string>();
    const streams = new Set<string>();
    let stream = 0;
    let manual = 0;
    for (const b of blocks) {
      syms.add(b.symbol);
      exps.add(b.expiry);
      if (b.stream_name) streams.add(b.stream_name);
      if (b.source === "manual") manual++;
      else stream++;
    }
    return {
      symbolOptions: Array.from(syms).sort(),
      expiryOptions: Array.from(exps).sort(),
      streamOptions: Array.from(streams).sort(),
      sourceCounts: { stream, manual },
    };
  }, [blocks]);

  const toggleFamily = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onFamilyClick = useCallback(
    (fam: BlockFamily) => {
      setFocus({ kind: "opinion", name: fam.stream_name });
    },
    [setFocus],
  );

  const totalFamilies = groupIntoFamilies(blocks).length;
  const filteredDimCount = filteredDims.length;
  const totalDimCount = blocks.length;
  const visibleLabel =
    filteredDimCount === totalDimCount
      ? `${sortedFamilies.length} families · ${totalDimCount} dims · ${sourceCounts.stream} stream + ${sourceCounts.manual} manual`
      : `${sortedFamilies.length} of ${totalFamilies} families · ${filteredDimCount} of ${totalDimCount} dims`;

  return (
    <section className="flex h-full min-h-0 flex-col p-3">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-[10px] text-mm-text-dim">{visibleLabel}</span>

        <select
          value={symbolFilter}
          onChange={(e) => { setSymbolFilter(e.target.value); persistFollowFocus(false); }}
          className="form-input ml-auto max-w-[110px]"
          title="Filter by symbol"
        >
          <option value={ALL}>All symbols</option>
          {symbolOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={expiryFilter}
          onChange={(e) => { setExpiryFilter(e.target.value); persistFollowFocus(false); }}
          className="form-input max-w-[120px]"
          title="Filter by expiry"
        >
          <option value={ALL}>All expiries</option>
          {expiryOptions.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
        <select
          value={streamFilter}
          onChange={(e) => { setStreamFilter(e.target.value); persistFollowFocus(false); }}
          className="form-input max-w-[140px]"
          title="Filter by stream"
        >
          <option value={ALL}>All streams</option>
          {streamOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); persistFollowFocus(false); }}
          className="form-input max-w-[100px]"
          title="Filter by source"
        >
          <option value={ALL}>All sources</option>
          <option value="stream">stream</option>
          <option value="manual">manual</option>
        </select>
        <label
          className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${
            followFocus
              ? "border-mm-accent/30 bg-mm-accent-soft text-mm-accent"
              : "border-black/[0.08] text-mm-text-dim hover:bg-black/[0.04]"
          }`}
          title="When on, the table auto-filters to the workbench focus"
        >
          <input
            type="checkbox"
            checked={followFocus}
            onChange={(e) => persistFollowFocus(e.target.checked)}
            className="accent-mm-accent"
          />
          <span>Follow focus</span>
        </label>

        <input
          type="text"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Filter…"
          className="form-input max-w-[140px]"
        />

        {headerAction}
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
          {error}
        </p>
      )}

      {loading && blocks.length === 0 ? (
        <p className="text-[11px] text-mm-text-dim">Loading blocks...</p>
      ) : sortedFamilies.length === 0 ? (
        <p className="text-[11px] text-mm-text-dim">No blocks match the current filters.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-black/[0.06]">
          <table className="w-full border-collapse text-[10px]">
            <thead className="sticky top-0 z-10 bg-black/[0.03] text-mm-text-dim">
              <tr>
                <th className="w-6 px-1 py-1 font-medium" />
                <th className="px-2 py-1 text-left font-medium">Block</th>
                <th className="px-2 py-1 text-left font-medium">Source</th>
                <th className="px-2 py-1 text-left font-medium">Stream</th>
                <th className="px-2 py-1 text-left font-medium">Dims</th>
                <th className="px-2 py-1 text-right font-medium">Fair</th>
                <th className="px-2 py-1 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {sortedFamilies.map((fam) => {
                const isExpanded = expanded.has(fam.key);
                return (
                  <FamilyRowGroup
                    key={fam.key}
                    family={fam}
                    expanded={isExpanded}
                    focus={focus}
                    onToggle={() => toggleFamily(fam.key)}
                    onFamilyClick={() => onFamilyClick(fam)}
                    onDimClick={onRowClick}
                    onDimEdit={onRowEdit}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FamilyRowGroup({
  family,
  expanded,
  focus,
  onToggle,
  onFamilyClick,
  onDimClick,
  onDimEdit,
}: {
  family: BlockFamily;
  expanded: boolean;
  focus: ReturnType<typeof useFocus>["focus"];
  onToggle: () => void;
  onFamilyClick: () => void;
  onDimClick?: (block: BlockRow) => void;
  onDimEdit?: (block: BlockRow) => void;
}) {
  const isFocused =
    focus?.kind === "opinion" && focus.name === family.stream_name;
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-black/[0.03] transition-colors ${
          isFocused ? "bg-mm-accent-soft" : "hover:bg-mm-accent/5"
        }`}
        onClick={onFamilyClick}
      >
        <td
          className="w-6 cursor-pointer px-1 py-1 text-center text-mm-text-dim"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={expanded ? "Collapse dims" : "Expand dims"}
        >
          {expanded ? "▾" : "▸"}
        </td>
        <td className="px-2 py-1 font-medium text-mm-text">{family.block_name}</td>
        <td className="px-2 py-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
              family.source === "manual" ? "bg-mm-warn/15 text-mm-warn" : "bg-mm-accent/10 text-mm-accent"
            }`}
          >
            {family.source}
          </span>
        </td>
        <td className="px-2 py-1 text-mm-text-dim">{family.stream_name}</td>
        <td className="px-2 py-1 text-mm-text-subtle">
          {formatDimsSummary(family)}
        </td>
        <td className="px-2 py-1 text-right font-mono tabular-nums">
          {formatRange(family.fair_min, family.fair_max)}
        </td>
        <td className="px-2 py-1 text-right font-mono tabular-nums">
          {formatRange(family.var_min, family.var_max)}
        </td>
      </tr>
      {expanded &&
        family.dims.map((dim) => {
          const dimFocused =
            focus?.kind === "block" && blockKeyEquals(focus.key, blockKeyOf(dim));
          const dimKey = `${blockKeyToString(blockKeyOf(dim))}|${dim.space_id}`;
          return (
            <tr
              key={dimKey}
              className={`border-t border-black/[0.02] transition-colors ${
                dimFocused ? "bg-mm-accent-soft" : "hover:bg-mm-accent/[0.06]"
              } ${onDimClick ? "cursor-pointer" : ""}`}
              onClick={() => onDimClick?.(dim)}
              onDoubleClick={(e) => {
                if (!onDimEdit) return;
                e.stopPropagation();
                onDimEdit(dim);
              }}
              title={onDimEdit ? "Click to inspect · double-click to edit" : undefined}
            >
              <td className="w-6 px-1 py-0.5" />
              <td className="px-2 py-0.5 text-mm-text-subtle">
                <span className="pl-3">{dim.symbol} · {dim.expiry}</span>
              </td>
              <td className="px-2 py-0.5 text-mm-text-subtle">{dim.space_id}</td>
              <td className="px-2 py-0.5 text-mm-text-subtle">
                <span className="font-mono">
                  γ={formatNullable(dim.var_fair_ratio, 3)}
                </span>
              </td>
              <td className="px-2 py-0.5 text-mm-text-subtle">
                {dim.market_value_source ?? "—"}
              </td>
              <td className={`px-2 py-0.5 text-right font-mono tabular-nums ${dim.fair != null ? valColor(dim.fair) : ""}`}>
                {formatNullable(dim.fair)}
              </td>
              <td className="px-2 py-0.5 text-right font-mono tabular-nums">
                {formatNullable(dim.var)}
              </td>
            </tr>
          );
        })}
    </>
  );
}

function matchesGlobalFilter(b: BlockRow, q: string): boolean {
  return (
    b.block_name.toLowerCase().includes(q) ||
    b.stream_name.toLowerCase().includes(q) ||
    b.symbol.toLowerCase().includes(q) ||
    b.expiry.toLowerCase().includes(q) ||
    b.space_id.toLowerCase().includes(q)
  );
}

function groupIntoFamilies(blocks: BlockRow[]): BlockFamily[] {
  const map = new Map<string, BlockFamily>();
  for (const b of blocks) {
    const key = `${b.stream_name}|${b.block_name}`;
    let fam = map.get(key);
    if (!fam) {
      fam = {
        key,
        block_name: b.block_name,
        stream_name: b.stream_name,
        source: b.source,
        dims: [],
        symbols: [],
        expiries: [],
        fair_min: null,
        fair_max: null,
        var_min: null,
        var_max: null,
      };
      map.set(key, fam);
    }
    fam.dims.push(b);
    if (!fam.symbols.includes(b.symbol)) fam.symbols.push(b.symbol);
    if (!fam.expiries.includes(b.expiry)) fam.expiries.push(b.expiry);
    if (b.fair != null) {
      fam.fair_min = fam.fair_min == null ? b.fair : Math.min(fam.fair_min, b.fair);
      fam.fair_max = fam.fair_max == null ? b.fair : Math.max(fam.fair_max, b.fair);
    }
    if (b.var != null) {
      fam.var_min = fam.var_min == null ? b.var : Math.min(fam.var_min, b.var);
      fam.var_max = fam.var_max == null ? b.var : Math.max(fam.var_max, b.var);
    }
  }
  for (const fam of map.values()) {
    fam.symbols.sort();
    fam.expiries.sort();
    fam.dims.sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      if (a.expiry !== b.expiry) return a.expiry.localeCompare(b.expiry);
      return a.space_id.localeCompare(b.space_id);
    });
  }
  return Array.from(map.values());
}

function formatDimsSummary(fam: BlockFamily): string {
  const symCount = fam.symbols.length;
  const expCount = fam.expiries.length;
  const total = fam.dims.length;
  if (total === 1) return `${fam.symbols[0]} · ${fam.expiries[0]}`;
  return `${symCount} ${plural("symbol", symCount)} × ${expCount} ${plural("expiry", expCount)} · ${total} ${plural("dim", total)}`;
}

function plural(word: string, n: number): string {
  if (n === 1) return word;
  if (word === "expiry") return "expiries";
  return `${word}s`;
}

function formatRange(lo: number | null, hi: number | null): string {
  if (lo == null && hi == null) return "—";
  if (lo == null || hi == null) return formatNullable(lo ?? hi);
  if (lo === hi) return formatNullable(lo);
  return `${formatNullable(lo)}…${formatNullable(hi)}`;
}
