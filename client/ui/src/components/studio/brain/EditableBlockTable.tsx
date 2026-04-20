import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { fetchBlocks } from "../../../services/blockApi";
import type { BlockRow } from "../../../types";
import { valColor, formatNullable } from "../../../utils";
import { POLL_INTERVAL_BLOCKS_MS, BLOCKS_FOLLOW_FOCUS_KEY } from "../../../constants";
import { useFocus } from "../../../providers/FocusProvider";

const col = createColumnHelper<BlockRow>();

/** fair − market_fair, with nulls treated as 0. Shared by cell + sortingFn. */
function edgeOf(row: BlockRow): number {
  return (row.fair ?? 0) - (row.market_fair ?? 0);
}

/** All column definitions. The `id` doubles as the visibility key. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack column helper produces heterogeneous accessor types
const ALL_COLUMNS: ColumnDef<BlockRow, any>[] = [
  col.accessor("block_name", {
    header: "Block",
    cell: (info) => <span className="font-medium text-mm-text">{info.getValue()}</span>,
  }),
  col.accessor("source", {
    header: "Source",
    cell: (info) => {
      const v = info.getValue();
      return (
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
            v === "manual" ? "bg-mm-warn/15 text-mm-warn" : "bg-mm-accent/10 text-mm-accent"
          }`}
        >
          {v}
        </span>
      );
    },
    enableSorting: false,
    filterFn: (row, _id, value: string) => row.original.source === value,
  }),
  // Filter functions are explicit lambdas (not the "equals" string preset)
  // so the comparison stays correct even when the column is hidden — the
  // string preset depends on TanStack resolving the column's accessor at
  // filter time, which silently no-ops when the row's getValue() returns
  // undefined for hidden columns in some setups.
  col.accessor("stream_name", {
    header: "Stream",
    filterFn: (row, _id, value: string) => row.original.stream_name === value,
  }),
  col.accessor("symbol", {
    header: "Symbol",
    filterFn: (row, _id, value: string) => row.original.symbol === value,
  }),
  col.accessor("expiry", {
    header: "Expiry",
    filterFn: (row, _id, value: string) => row.original.expiry === value,
  }),
  col.accessor("space_id", { header: "Space" }),
  col.accessor("fair", {
    header: "Fair",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
    sortingFn: "basic",
  }),
  col.accessor("market_fair", {
    header: "Mkt Fair",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
    sortingFn: "basic",
  }),
  col.display({
    id: "edge",
    header: "Edge",
    cell: ({ row }) => {
      const edge = edgeOf(row.original);
      return (
        <span className={`font-mono tabular-nums ${valColor(edge)}`}>
          {edge >= 0 ? "+" : ""}
          {edge.toFixed(4)}
        </span>
      );
    },
    sortingFn: (a, b) => Math.abs(edgeOf(a.original)) - Math.abs(edgeOf(b.original)),
  }),
  col.accessor("var", {
    header: "Variance",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
    sortingFn: "basic",
  }),
  // Engine parameters (hidden by default)
  col.accessor("annualized", {
    header: "Annualized",
    cell: (info) => (info.getValue() ? "yes" : "no"),
  }),
  col.accessor("size_type", { header: "Size Type" }),
  col.accessor("aggregation_logic", { header: "Aggregation" }),
  col.accessor("temporal_position", { header: "Temporal Pos" }),
  col.accessor("decay_end_size_mult", {
    header: "Decay End",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  col.accessor("decay_rate_prop_per_min", {
    header: "Decay Rate",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue(), 6)}</span>,
  }),
  col.accessor("var_fair_ratio", {
    header: "Var/Fair Ratio",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  col.accessor("scale", {
    header: "Scale",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  col.accessor("offset", {
    header: "Offset",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  col.accessor("exponent", {
    header: "Exponent",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  // Output values (hidden by default)
  col.accessor("target_value", {
    header: "Target Value",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  col.accessor("raw_value", {
    header: "Raw Value",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  col.accessor("market_value", {
    header: "Market Value",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  col.accessor("target_market_value", {
    header: "Target Mkt Value",
    cell: (info) => <span className="font-mono tabular-nums">{formatNullable(info.getValue())}</span>,
  }),
  // Timing (hidden by default)
  col.accessor("start_timestamp", { header: "Start TS" }),
  col.accessor("updated_at", { header: "Updated" }),
];

/** Columns visible by default — everything else starts hidden. */
const DEFAULT_VISIBLE = new Set([
  "block_name",
  "source",
  "stream_name",
  "symbol",
  "expiry",
  "space_id",
  "fair",
  "market_fair",
  "edge",
  "var",
]);

function buildDefaultVisibility(): VisibilityState {
  const vis: VisibilityState = {};
  for (const c of ALL_COLUMNS) {
    // TanStack column defs store the accessor key or an explicit id
    const raw = c as unknown as Record<string, unknown>;
    const id = (raw.accessorKey as string | undefined) ?? (raw.id as string | undefined);
    if (id) vis[id] = DEFAULT_VISIBLE.has(id);
  }
  return vis;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  headerAction?: React.ReactNode;
  onRefresh?: () => void;
  refreshKey?: number;
  /** Single-click handler — Phase 1 sets workbench focus. */
  onRowClick?: (block: BlockRow) => void;
  /** Optional separate handler for "edit this block" (double-click + Edit btn). */
  onRowEdit?: (block: BlockRow) => void;
}

/**
 * Block Inspector for Studio -> Brain.
 *
 * TanStack Table with column visibility toggle, multi-column sort,
 * global filter, and row click to open the detail drawer.
 */
const ALL = "__all__";

export function EditableBlockTable({ headerAction, onRefresh, refreshKey, onRowClick, onRowEdit }: Props) {
  const { focus } = useFocus();
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "fair", desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(buildDefaultVisibility);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState<string>(ALL);
  const [expiryFilter, setExpiryFilter] = useState<string>(ALL);
  const [streamFilter, setStreamFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [followFocus, setFollowFocus] = useState<boolean>(() => {
    try { return localStorage.getItem(BLOCKS_FOLLOW_FOCUS_KEY) !== "false"; } catch { return true; }
  });

  // Auto-filter to the focused dimension when "follow focus" is on. Reverting
  // is the same gesture: click the same focus again to unfocus, or toggle
  // "follow focus" off to keep the manual filter selection.
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
    } else if (focus.kind === "stream") {
      setSymbolFilter(ALL);
      setExpiryFilter(ALL);
      setStreamFilter(focus.name);
    } else if (focus.kind === "block") {
      // Block focus highlights a single row; clear axis filters so the row
      // is visible in context.
      setSymbolFilter(ALL);
      setExpiryFilter(ALL);
      setStreamFilter(ALL);
    }
  }, [focus, followFocus]);

  const persistFollowFocus = useCallback((next: boolean) => {
    setFollowFocus(next);
    try { localStorage.setItem(BLOCKS_FOLLOW_FOCUS_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const out: ColumnFiltersState = [];
    if (symbolFilter !== ALL) out.push({ id: "symbol", value: symbolFilter });
    if (expiryFilter !== ALL) out.push({ id: "expiry", value: expiryFilter });
    if (streamFilter !== ALL) out.push({ id: "stream_name", value: streamFilter });
    if (sourceFilter !== ALL) out.push({ id: "source", value: sourceFilter });
    return out;
  }, [symbolFilter, expiryFilter, streamFilter, sourceFilter]);

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

  const columns = useMemo(() => ALL_COLUMNS, []);

  const table = useReactTable({
    data: blocks,
    columns,
    state: { globalFilter, sorting, columnVisibility, columnFilters },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    // No-op handler — required by TanStack when columnFilters is provided
    // in `state`, even though our filters are driven entirely by the
    // dropdowns above (the table never asks to mutate them itself).
    onColumnFiltersChange: () => {},
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _colId, filterValue: string) => {
      const q = filterValue.toLowerCase();
      const o = row.original;
      return (
        o.block_name.toLowerCase().includes(q) ||
        o.stream_name.toLowerCase().includes(q) ||
        o.symbol.toLowerCase().includes(q) ||
        o.expiry.toLowerCase().includes(q) ||
        o.space_id.toLowerCase().includes(q)
      );
    },
  });

  // Distinct symbol + expiry + stream values for the filter dropdowns +
  // source counts.
  const { symbolOptions, expiryOptions, streamOptions, sourceCounts, visibleCount } = useMemo(() => {
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
      visibleCount: table.getFilteredRowModel().rows.length,
    };
  }, [blocks, table]);

  return (
    <section className="flex h-full min-h-0 flex-col p-3">
      {/* Header row */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <h3 className="zone-header">Block Inspector</h3>
        <span className="text-[10px] text-mm-text-dim" title={`${sourceCounts.stream} stream + ${sourceCounts.manual} manual = ${blocks.length} total`}>
          {visibleCount === blocks.length
            ? `${blocks.length} total · ${sourceCounts.stream} stream + ${sourceCounts.manual} manual`
            : `${visibleCount} of ${blocks.length} (${sourceCounts.stream} stream + ${sourceCounts.manual} manual)`}
        </span>

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

        {/* Column visibility toggle */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setColMenuOpen((o) => !o)}
            className="form-input flex items-center gap-1 text-[10px]"
            title="Toggle columns"
          >
            Columns
            <span className="text-[8px]">{colMenuOpen ? "\u25B2" : "\u25BC"}</span>
          </button>
          {colMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-black/[0.08] bg-white p-2 shadow-lg">
                <label className="mb-1 flex items-center gap-2 border-b border-black/[0.06] pb-1.5 text-[10px] font-semibold text-mm-text">
                  <input
                    type="checkbox"
                    checked={table.getIsAllColumnsVisible()}
                    ref={(el) => {
                      if (el) el.indeterminate = !table.getIsAllColumnsVisible() && table.getIsSomeColumnsVisible();
                    }}
                    onChange={table.getToggleAllColumnsVisibilityHandler()}
                    className="accent-mm-accent"
                  />
                  {table.getIsAllColumnsVisible() ? "Deselect all" : "Select all"}
                </label>
                {table.getAllLeafColumns().map((column) => (
                  <label key={column.id} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                      className="accent-mm-accent"
                    />
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {headerAction}
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
          {error}
        </p>
      )}

      {loading && blocks.length === 0 ? (
        <p className="text-[11px] text-mm-text-dim">Loading blocks...</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-black/[0.06]">
          <table className="w-full border-collapse text-[10px]">
            <thead className="bg-black/[0.03] text-mm-text-dim">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className={`cursor-pointer select-none px-2 py-1 font-medium text-left ${
                        header.column.getCanSort() ? "hover:text-mm-text" : ""
                      }`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " \u2191", desc: " \u2193" }[
                          header.column.getIsSorted() as string
                        ] ?? ""}
                      </span>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const isFocused = focus?.kind === "block" && focus.name === row.original.block_name;
                return (
                <tr
                  key={row.original.block_name}
                  className={`border-t border-black/[0.03] transition-colors ${
                    isFocused ? "bg-mm-accent-soft" : "hover:bg-mm-accent/5"
                  } ${onRowClick ? "cursor-pointer" : ""}`}
                  onClick={() => onRowClick?.(row.original)}
                  onDoubleClick={(e) => {
                    if (!onRowEdit) return;
                    e.stopPropagation();
                    onRowEdit(row.original);
                  }}
                  title={onRowEdit ? "Click to inspect · double-click to edit" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-2 py-1">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
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
