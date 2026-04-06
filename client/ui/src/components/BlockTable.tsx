import { useState, useEffect, useCallback, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
  type ColumnOrderState,
  type VisibilityState,
} from "@tanstack/react-table";
import type { BlockRow } from "../types";
import { fetchBlocks, createManualBlock, updateBlock, type ManualBlockPayload, type UpdateBlockPayload } from "../services/blockApi";

const POLL_INTERVAL_MS = 5000;

const columnHelper = createColumnHelper<BlockRow>();

// ---------------------------------------------------------------------------
// Column definitions — grouped by category
// ---------------------------------------------------------------------------

const columns = [
  // Source
  columnHelper.accessor("block_name", {
    header: "Block",
    cell: (info) => (
      <span className="font-medium text-mm-text">{info.getValue()}</span>
    ),
    size: 160,
  }),
  columnHelper.accessor("stream_name", {
    header: "Stream",
    cell: (info) => info.getValue(),
    size: 120,
  }),
  columnHelper.accessor("symbol", {
    header: "Symbol",
    cell: (info) => info.getValue(),
    size: 70,
  }),
  columnHelper.accessor("expiry", {
    header: "Expiry",
    cell: (info) => {
      const v = info.getValue();
      if (!v) return "—";
      try {
        return new Date(v).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
      } catch {
        return v;
      }
    },
    size: 100,
  }),
  columnHelper.accessor("source", {
    header: "Source",
    cell: (info) => (
      <span
        className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
          info.getValue() === "manual"
            ? "bg-amber-500/20 text-amber-400"
            : "bg-mm-accent/15 text-mm-accent"
        }`}
      >
        {info.getValue()}
      </span>
    ),
    size: 70,
  }),
  columnHelper.accessor("space_id", {
    header: "Space",
    size: 100,
  }),

  // Engine parameters
  columnHelper.accessor("annualized", {
    header: "Ann.",
    cell: (info) => (info.getValue() ? "Yes" : "No"),
    size: 50,
  }),
  columnHelper.accessor("size_type", {
    header: "Size Type",
    size: 70,
  }),
  columnHelper.accessor("aggregation_logic", {
    header: "Agg. Logic",
    size: 80,
  }),
  columnHelper.accessor("temporal_position", {
    header: "Temporal",
    size: 80,
  }),
  columnHelper.accessor("scale", {
    header: "Scale",
    cell: (info) => info.getValue().toFixed(4),
    size: 70,
  }),
  columnHelper.accessor("offset", {
    header: "Offset",
    cell: (info) => info.getValue().toFixed(4),
    size: 70,
  }),
  columnHelper.accessor("exponent", {
    header: "Exp.",
    cell: (info) => info.getValue().toFixed(2),
    size: 60,
  }),
  columnHelper.accessor("decay_end_size_mult", {
    header: "Decay End",
    cell: (info) => info.getValue().toFixed(2),
    size: 80,
  }),
  columnHelper.accessor("decay_rate_prop_per_min", {
    header: "Decay Rate",
    cell: (info) => info.getValue().toFixed(4),
    size: 85,
  }),
  columnHelper.accessor("var_fair_ratio", {
    header: "Var/Fair",
    cell: (info) => info.getValue().toFixed(4),
    size: 75,
  }),

  // Output values
  columnHelper.accessor("raw_value", {
    header: "Raw Value",
    cell: (info) => info.getValue().toFixed(6),
    size: 90,
  }),
  columnHelper.accessor("target_value", {
    header: "Target Value",
    cell: (info) => info.getValue().toFixed(6),
    size: 100,
  }),
  columnHelper.accessor("target_market_value", {
    header: "Mkt Value",
    cell: (info) => info.getValue()?.toFixed(6) ?? "—",
    size: 90,
  }),
  columnHelper.accessor("fair", {
    header: "Fair",
    cell: (info) => {
      const v = info.getValue();
      return v != null ? v.toFixed(6) : "—";
    },
    size: 80,
  }),
  columnHelper.accessor("market_fair", {
    header: "Mkt Fair",
    cell: (info) => {
      const v = info.getValue();
      return v != null ? v.toFixed(6) : "—";
    },
    size: 80,
  }),
  columnHelper.accessor("var", {
    header: "Variance",
    cell: (info) => {
      const v = info.getValue();
      return v != null ? v.toFixed(6) : "—";
    },
    size: 80,
  }),

  // Timing
  columnHelper.accessor("updated_at", {
    header: "Updated",
    cell: (info) => {
      const v = info.getValue();
      if (!v) return "—";
      try {
        return new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } catch {
        return v;
      }
    },
    size: 90,
  }),
];

// ---------------------------------------------------------------------------
// New-row form defaults
// ---------------------------------------------------------------------------

interface NewBlockDraft {
  stream_name: string;
  scale: string;
  offset: string;
  exponent: string;
  annualized: boolean;
  size_type: "fixed" | "relative";
  aggregation_logic: "average" | "offset";
  temporal_position: "static" | "shifting";
  decay_end_size_mult: string;
  decay_rate_prop_per_min: string;
  var_fair_ratio: string;
  // Snapshot: minimal row for manual entry
  symbol: string;
  expiry: string;
  raw_value: string;
  timestamp: string;
  // Optional space_id override (blank = auto-computed)
  space_id: string;
}

const EMPTY_DRAFT: NewBlockDraft = {
  stream_name: "",
  scale: "1",
  offset: "0",
  exponent: "1",
  annualized: true,
  size_type: "fixed",
  aggregation_logic: "average",
  temporal_position: "shifting",
  decay_end_size_mult: "1",
  decay_rate_prop_per_min: "0",
  var_fair_ratio: "1",
  symbol: "",
  expiry: "",
  raw_value: "",
  timestamp: new Date().toISOString().slice(0, 16),
  space_id: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockTable() {
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<NewBlockDraft>({ ...EMPTY_DRAFT });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Inline edit state
  const [editingStream, setEditingStream] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string | boolean>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Fetch blocks
  const loadBlocks = useCallback(async () => {
    try {
      const data = await fetchBlocks();
      setBlocks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlocks();
    const id = setInterval(loadBlocks, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadBlocks]);

  // Table instance
  const table = useReactTable({
    data: blocks,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // Column groups for visibility dropdown
  const columnGroups = useMemo(
    () => [
      {
        label: "Source",
        ids: ["block_name", "stream_name", "symbol", "expiry", "source", "space_id"],
      },
      {
        label: "Engine Params",
        ids: [
          "annualized", "size_type", "aggregation_logic", "temporal_position",
          "scale", "offset", "exponent",
          "decay_end_size_mult", "decay_rate_prop_per_min", "var_fair_ratio",
        ],
      },
      {
        label: "Outputs",
        ids: ["raw_value", "target_value", "target_market_value", "fair", "market_fair", "var"],
      },
      {
        label: "Timing",
        ids: ["updated_at"],
      },
    ],
    [],
  );

  // Submit manual block
  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    if (!draft.stream_name.trim()) {
      setSubmitError("Stream name is required");
      return;
    }
    if (!draft.symbol.trim() || !draft.expiry.trim() || !draft.raw_value.trim()) {
      setSubmitError("Symbol, expiry, and raw value are required");
      return;
    }

    setSubmitting(true);
    try {
      const payload: ManualBlockPayload = {
        stream_name: draft.stream_name.trim(),
        key_cols: ["symbol", "expiry"],
        scale: parseFloat(draft.scale) || 1,
        offset: parseFloat(draft.offset) || 0,
        exponent: parseFloat(draft.exponent) || 1,
        block: {
          annualized: draft.annualized,
          size_type: draft.size_type,
          aggregation_logic: draft.aggregation_logic,
          temporal_position: draft.temporal_position,
          decay_end_size_mult: parseFloat(draft.decay_end_size_mult) || 1,
          decay_rate_prop_per_min: parseFloat(draft.decay_rate_prop_per_min) || 0,
          decay_profile: "linear",
          var_fair_ratio: parseFloat(draft.var_fair_ratio) || 1,
        },
        snapshot_rows: [
          {
            symbol: draft.symbol.trim(),
            expiry: new Date(draft.expiry).toISOString(),
            timestamp: new Date(draft.timestamp).toISOString(),
            raw_value: parseFloat(draft.raw_value),
          },
        ],
        ...(draft.space_id.trim() ? { space_id: draft.space_id.trim() } : {}),
      };

      const newBlock = await createManualBlock(payload);
      setBlocks((prev) => [...prev, newBlock]);
      setDraft({ ...EMPTY_DRAFT });
      setShowForm(false);
      // Polling will refresh with real computed values once the background pipeline finishes
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Try to extract the "detail" field from a JSON error body like '422: {"detail":"..."}'
      let detail = raw;
      const jsonStart = raw.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(raw.slice(jsonStart));
          if (parsed.detail) detail = parsed.detail;
        } catch { /* keep raw */ }
      }
      setSubmitError(detail);
    } finally {
      setSubmitting(false);
    }
  }, [draft, loadBlocks]);

  // Patch a draft field
  const patchDraft = useCallback(
    <K extends keyof NewBlockDraft>(key: K, value: NewBlockDraft[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Start editing an existing row
  const startEdit = useCallback((block: BlockRow) => {
    setEditingStream(block.stream_name);
    setEditDraft({
      scale: String(block.scale),
      offset: String(block.offset),
      exponent: String(block.exponent),
      annualized: block.annualized,
      size_type: block.size_type,
      aggregation_logic: block.aggregation_logic,
      temporal_position: block.temporal_position,
      decay_end_size_mult: String(block.decay_end_size_mult),
      decay_rate_prop_per_min: String(block.decay_rate_prop_per_min),
      var_fair_ratio: String(block.var_fair_ratio),
      raw_value: String(block.raw_value),
    });
    setEditError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingStream(null);
    setEditDraft({});
    setEditError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingStream) return;
    setSaving(true);
    setEditError(null);
    try {
      const payload: UpdateBlockPayload = {
        scale: parseFloat(editDraft.scale as string) || undefined,
        offset: parseFloat(editDraft.offset as string),
        exponent: parseFloat(editDraft.exponent as string) || undefined,
        block: {
          annualized: editDraft.annualized === true || editDraft.annualized === "true",
          size_type: (editDraft.size_type as "fixed" | "relative") || "fixed",
          aggregation_logic: (editDraft.aggregation_logic as "average" | "offset") || "average",
          temporal_position: (editDraft.temporal_position as "static" | "shifting") || "shifting",
          decay_end_size_mult: parseFloat(editDraft.decay_end_size_mult as string) || 1,
          decay_rate_prop_per_min: parseFloat(editDraft.decay_rate_prop_per_min as string) || 0,
          decay_profile: "linear",
          var_fair_ratio: parseFloat(editDraft.var_fair_ratio as string) || 1,
        },
      };
      await updateBlock(editingStream, payload);
      setEditingStream(null);
      setEditDraft({});
      await loadBlocks();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let detail = raw;
      const jsonStart = raw.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(raw.slice(jsonStart));
          if (parsed.detail) detail = parsed.detail;
        } catch { /* keep raw */ }
      }
      setEditError(detail);
    } finally {
      setSaving(false);
    }
  }, [editingStream, editDraft, loadBlocks]);

  const patchEdit = useCallback((key: string, value: string | boolean) => {
    setEditDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="flex h-full flex-col p-3">
      {/* Toolbar */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="zone-header">Block Configuration</h2>
          <span className="text-[10px] text-mm-text-dim">
            {blocks.length} block{blocks.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Global filter */}
          <input
            type="text"
            placeholder="Filter..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-32 rounded-md border border-mm-border/60 bg-mm-bg px-2 py-1 text-[10px] text-mm-text outline-none placeholder:text-mm-text-dim/50 focus:border-mm-accent/60 focus:ring-1 focus:ring-mm-accent/20"
          />

          {/* Column visibility dropdown */}
          <ColumnVisibilityDropdown
            table={table}
            groups={columnGroups}
          />

          {/* Edit save/cancel */}
          {editingStream && (
            <>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="rounded-md bg-mm-accent/20 px-2.5 py-1 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="rounded-md px-2.5 py-1 text-[10px] font-medium text-mm-text-dim transition-colors hover:text-mm-text"
              >
                Cancel
              </button>
            </>
          )}

          {/* Add manual block / Create+Cancel */}
          {!editingStream && showForm ? (
            <>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-md bg-mm-accent/20 px-2.5 py-1 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30 disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => { setShowForm(false); setSubmitError(null); }}
                disabled={submitting}
                className="rounded-md px-2.5 py-1 text-[10px] font-medium text-mm-text-dim transition-colors hover:text-mm-text"
              >
                Cancel
              </button>
            </>
          ) : !editingStream ? (
            <button
              onClick={() => setShowForm(true)}
              className="rounded-md bg-mm-border/30 px-2.5 py-1 text-[10px] font-medium text-mm-text-dim transition-colors hover:bg-mm-border/50 hover:text-mm-text"
            >
              + Manual Block
            </button>
          ) : null}
        </div>
      </div>

      {(error || (submitError && showForm) || editError) && (
        <div className="mb-2 rounded-md bg-mm-error/10 px-3 py-1.5 text-[10px] text-mm-error">
          {editError ?? (submitError && showForm ? submitError : error)}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead className="sticky top-0 z-10 bg-mm-surface">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-mm-border/40">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="whitespace-nowrap px-2 py-1.5 text-left text-[9px] font-medium text-mm-text-dim select-none"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        className="flex items-center gap-1 transition-colors hover:text-mm-text"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{
                          asc: " ↑",
                          desc: " ↓",
                        }[header.column.getIsSorted() as string] ?? ""}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {loading && blocks.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="px-3 py-8 text-center text-xs text-mm-text-dim"
                >
                  Loading blocks...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 && !showForm ? (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="px-3 py-8 text-center text-xs text-mm-text-dim"
                >
                  No blocks available. Start streams or add a manual block.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const block = row.original;
                const isEditing = editingStream === block.stream_name;
                return isEditing ? (
                  <EditRow
                    key={row.id}
                    editDraft={editDraft}
                    patchEdit={patchEdit}
                    visibleColumns={table.getVisibleLeafColumns().map((c) => c.id)}
                    original={block}
                  />
                ) : (
                  <tr
                    key={row.id}
                    className="border-b border-mm-border/20 transition-colors hover:bg-mm-accent/5 cursor-pointer"
                    onDoubleClick={() => startEdit(block)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="whitespace-nowrap px-2 py-1.5 text-[10px] tabular-nums text-mm-text"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}

            {/* Inline editable draft row */}
            {showForm && (
              <DraftRow
                draft={draft}
                patchDraft={patchDraft}
                visibleColumns={table.getVisibleLeafColumns().map((c) => c.id)}
              />
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Column visibility dropdown
// ---------------------------------------------------------------------------

function ColumnVisibilityDropdown({
  table,
  groups,
}: {
  table: ReturnType<typeof useReactTable<BlockRow>>;
  groups: { label: string; ids: string[] }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-mm-border/30 px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-mm-border/50 hover:text-mm-text"
      >
        Columns {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-64 w-48 overflow-auto rounded-lg border border-mm-border/60 bg-mm-surface py-1 shadow-xl shadow-black/30">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-mm-text-dim">
                {g.label}
              </div>
              {g.ids.map((id) => {
                const col = table.getColumn(id);
                if (!col) return null;
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-0.5 text-[10px] text-mm-text transition-colors hover:bg-mm-accent/10"
                  >
                    <input
                      type="checkbox"
                      checked={col.getIsVisible()}
                      onChange={col.getToggleVisibilityHandler()}
                      className="h-3 w-3 accent-mm-accent"
                    />
                    {typeof col.columnDef.header === "string"
                      ? col.columnDef.header
                      : id}
                  </label>
                );
              })}
            </div>
          ))}
          <div className="border-t border-mm-border/40 px-3 py-1">
            <button
              onClick={() => table.toggleAllColumnsVisible(true)}
              className="text-[9px] text-mm-accent transition-colors hover:text-mm-accent/80"
            >
              Show All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline editable draft row — renders one <tr> with inputs per visible column
// ---------------------------------------------------------------------------

/** Maps column IDs to the draft field they edit and the input config */
const DRAFT_CELL_MAP: Record<
  string,
  | { kind: "text"; field: keyof NewBlockDraft; placeholder?: string }
  | { kind: "number"; field: keyof NewBlockDraft; step?: string; placeholder?: string }
  | { kind: "datetime"; field: keyof NewBlockDraft }
  | { kind: "select"; field: keyof NewBlockDraft; options: { value: string; label: string }[] }
  | { kind: "readonly"; text: string }
> = {
  block_name: { kind: "text", field: "stream_name", placeholder: "stream_name" },
  stream_name: { kind: "text", field: "stream_name", placeholder: "my_stream" },
  symbol: { kind: "text", field: "symbol", placeholder: "BTC" },
  expiry: { kind: "datetime", field: "expiry" },
  source: { kind: "readonly", text: "manual" },
  space_id: { kind: "text", field: "space_id", placeholder: "auto" },
  annualized: {
    kind: "select", field: "annualized",
    options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }],
  },
  size_type: {
    kind: "select", field: "size_type",
    options: [{ value: "fixed", label: "fixed" }, { value: "relative", label: "relative" }],
  },
  aggregation_logic: {
    kind: "select", field: "aggregation_logic",
    options: [{ value: "average", label: "average" }, { value: "offset", label: "offset" }],
  },
  temporal_position: {
    kind: "select", field: "temporal_position",
    options: [{ value: "shifting", label: "shifting" }, { value: "static", label: "static" }],
  },
  scale: { kind: "number", field: "scale", step: "any" },
  offset: { kind: "number", field: "offset", step: "any" },
  exponent: { kind: "number", field: "exponent", step: "any" },
  decay_end_size_mult: { kind: "number", field: "decay_end_size_mult", step: "any" },
  decay_rate_prop_per_min: { kind: "number", field: "decay_rate_prop_per_min", step: "any" },
  var_fair_ratio: { kind: "number", field: "var_fair_ratio", step: "any" },
  raw_value: { kind: "number", field: "raw_value", step: "any", placeholder: "0.5" },
  target_value: { kind: "readonly", text: "—" },
  target_market_value: { kind: "readonly", text: "—" },
  fair: { kind: "readonly", text: "—" },
  market_fair: { kind: "readonly", text: "—" },
  var: { kind: "readonly", text: "—" },
  updated_at: { kind: "datetime", field: "timestamp" },
};

function DraftRow({
  draft,
  patchDraft,
  visibleColumns,
}: {
  draft: NewBlockDraft;
  patchDraft: <K extends keyof NewBlockDraft>(key: K, value: NewBlockDraft[K]) => void;
  visibleColumns: string[];
}) {
  const cellCls = "form-input !py-0.5 !px-1.5 !text-[9px]";

  return (
    <tr className="border-b border-amber-500/30 bg-amber-500/5">
      {visibleColumns.map((colId) => {
        const cfg = DRAFT_CELL_MAP[colId];

        if (!cfg || cfg.kind === "readonly") {
          return (
            <td
              key={colId}
              className="whitespace-nowrap px-2 py-1 text-[9px] text-mm-text-dim italic"
            >
              {cfg?.kind === "readonly" ? cfg.text : "—"}
            </td>
          );
        }

        if (cfg.kind === "text") {
          return (
            <td key={colId} className="px-1 py-1">
              <input
                type="text"
                value={draft[cfg.field] as string}
                onChange={(e) => patchDraft(cfg.field, e.target.value as never)}
                placeholder={cfg.placeholder}
                className={cellCls}
              />
            </td>
          );
        }

        if (cfg.kind === "number") {
          return (
            <td key={colId} className="px-1 py-1">
              <input
                type="number"
                step={cfg.step}
                value={draft[cfg.field] as string}
                onChange={(e) => patchDraft(cfg.field, e.target.value as never)}
                placeholder={cfg.placeholder}
                className={cellCls}
              />
            </td>
          );
        }

        if (cfg.kind === "datetime") {
          return (
            <td key={colId} className="px-1 py-1">
              <input
                type="datetime-local"
                value={draft[cfg.field] as string}
                onChange={(e) => patchDraft(cfg.field, e.target.value as never)}
                className={cellCls}
              />
            </td>
          );
        }

        if (cfg.kind === "select") {
          const raw = draft[cfg.field];
          const selectVal = typeof raw === "boolean" ? String(raw) : (raw as string);
          return (
            <td key={colId} className="px-1 py-1">
              <select
                value={selectVal}
                onChange={(e) => {
                  const v = cfg.field === "annualized" ? (e.target.value === "true") : e.target.value;
                  patchDraft(cfg.field, v as never);
                }}
                className={cellCls}
              >
                {cfg.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </td>
          );
        }

        return <td key={colId} />;
      })}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Inline edit row for existing blocks — editable engine params, read-only outputs
// ---------------------------------------------------------------------------

/** Column IDs that are editable when editing an existing block */
const EDITABLE_COLS: Record<
  string,
  | { kind: "number"; field: string; step?: string }
  | { kind: "select"; field: string; options: { value: string; label: string }[] }
> = {
  scale: { kind: "number", field: "scale", step: "any" },
  offset: { kind: "number", field: "offset", step: "any" },
  exponent: { kind: "number", field: "exponent", step: "any" },
  annualized: {
    kind: "select", field: "annualized",
    options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }],
  },
  size_type: {
    kind: "select", field: "size_type",
    options: [{ value: "fixed", label: "fixed" }, { value: "relative", label: "relative" }],
  },
  aggregation_logic: {
    kind: "select", field: "aggregation_logic",
    options: [{ value: "average", label: "average" }, { value: "offset", label: "offset" }],
  },
  temporal_position: {
    kind: "select", field: "temporal_position",
    options: [{ value: "shifting", label: "shifting" }, { value: "static", label: "static" }],
  },
  decay_end_size_mult: { kind: "number", field: "decay_end_size_mult", step: "any" },
  decay_rate_prop_per_min: { kind: "number", field: "decay_rate_prop_per_min", step: "any" },
  var_fair_ratio: { kind: "number", field: "var_fair_ratio", step: "any" },
  raw_value: { kind: "number", field: "raw_value", step: "any" },
};

/** Columns whose original value is shown as read-only text during edit */
function formatOriginal(colId: string, block: BlockRow): string {
  const v = block[colId as keyof BlockRow];
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toFixed(6);
  if (colId === "expiry") {
    try { return new Date(v as string).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }); } catch { /* fall through */ }
  }
  if (colId === "updated_at") {
    try { return new Date(v as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { /* fall through */ }
  }
  return String(v);
}

function EditRow({
  editDraft,
  patchEdit,
  visibleColumns,
  original,
}: {
  editDraft: Record<string, string | boolean>;
  patchEdit: (key: string, value: string | boolean) => void;
  visibleColumns: string[];
  original: BlockRow;
}) {
  const cellCls = "form-input !py-0.5 !px-1.5 !text-[9px]";

  return (
    <tr className="border-b border-mm-accent/30 bg-mm-accent/5">
      {visibleColumns.map((colId) => {
        const cfg = EDITABLE_COLS[colId];

        if (!cfg) {
          return (
            <td
              key={colId}
              className="whitespace-nowrap px-2 py-1 text-[10px] text-mm-text"
            >
              {colId === "source" ? (
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                  original.source === "manual" ? "bg-amber-500/20 text-amber-400" : "bg-mm-accent/15 text-mm-accent"
                }`}>{original.source}</span>
              ) : colId === "block_name" ? (
                <span className="font-medium">{original.block_name}</span>
              ) : formatOriginal(colId, original)}
            </td>
          );
        }

        if (cfg.kind === "number") {
          return (
            <td key={colId} className="px-1 py-1">
              <input
                type="number"
                step={cfg.step}
                value={editDraft[cfg.field] as string ?? ""}
                onChange={(e) => patchEdit(cfg.field, e.target.value)}
                className={cellCls}
              />
            </td>
          );
        }

        if (cfg.kind === "select") {
          const raw = editDraft[cfg.field];
          const selectVal = typeof raw === "boolean" ? String(raw) : (raw as string);
          return (
            <td key={colId} className="px-1 py-1">
              <select
                value={selectVal}
                onChange={(e) => {
                  const v = cfg.field === "annualized" ? (e.target.value === "true") : e.target.value;
                  patchEdit(cfg.field, v);
                }}
                className={cellCls}
              >
                {cfg.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </td>
          );
        }

        return <td key={colId} />;
      })}
    </tr>
  );
}
