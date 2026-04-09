import { Fragment, useCallback, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type Row,
} from "@tanstack/react-table";
import type { RegisteredStream } from "../../types";
import { useRegisteredStreams } from "../../hooks/useRegisteredStreams";
import { deleteStream } from "../../services/streamApi";

const columnHelper = createColumnHelper<RegisteredStream>();

/**
 * Custom sort: PENDING streams first, then by stream_name. Triage workflow
 * cares about unconfigured streams — they should be impossible to miss.
 */
function statusSort(a: Row<RegisteredStream>, b: Row<RegisteredStream>): number {
  const av = a.original.status === "PENDING" ? 0 : 1;
  const bv = b.original.status === "PENDING" ? 0 : 1;
  if (av !== bv) return av - bv;
  return a.original.stream_name.localeCompare(b.original.stream_name);
}

function formatMapping(s: RegisteredStream): string {
  if (s.scale == null || s.offset == null || s.exponent == null) return "—";
  const scale = s.scale.toFixed(3);
  const offset = s.offset.toFixed(3);
  const exponent = s.exponent.toFixed(3);
  return `${scale} · raw^${exponent} + ${offset}`;
}

/**
 * Studio Streams table.
 *
 * Replaces the old 3-up card grid with a dense, sortable, filterable table
 * so architects can scan 20+ streams for outliers in a single glance.
 * Powered by `@tanstack/react-table` (already in package.json from the
 * deleted BlockTable era).
 */
interface Props {
  filter: string;
  onFilterChange: (value: string) => void;
  /** Row click + Configure action handler. Defaults to a no-op if not given. */
  onOpenStream?: (streamName: string) => void;
}

export function StreamTable({ filter, onFilterChange, onOpenStream }: Props) {
  const { streams, loading, error, refresh } = useRegisteredStreams();
  const [sorting, setSorting] = useState<SortingState>([{ id: "status", desc: false }]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  const openCanvas = useCallback(
    (streamName: string) => onOpenStream?.(streamName),
    [onOpenStream],
  );

  const handleDelete = useCallback(
    async (streamName: string) => {
      try {
        await deleteStream(streamName);
        await refresh();
        setMutationError(null);
      } catch (err) {
        setMutationError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const toggleExpand = useCallback(
    (streamName: string) =>
      setExpanded((prev) => ({ ...prev, [streamName]: !prev[streamName] })),
    [],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("stream_name", {
        id: "name",
        header: "Name",
        cell: (info) => {
          const s = info.row.original;
          const isExpanded = !!expanded[s.stream_name];
          return (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(s.stream_name);
                }}
                className="rounded p-0.5 text-[8px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? "▾" : "▸"}
              </button>
              <span className="truncate font-medium text-mm-text">{info.getValue()}</span>
            </div>
          );
        },
        size: 200,
      }),
      columnHelper.accessor("status", {
        id: "status",
        header: "Status",
        cell: (info) => {
          const status = info.getValue();
          return (
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase ${
                status === "READY"
                  ? "bg-mm-accent/15 text-mm-accent"
                  : "bg-mm-warn/15 text-mm-warn"
              }`}
            >
              {status}
            </span>
          );
        },
        sortingFn: statusSort,
        size: 80,
      }),
      columnHelper.accessor((row) => row.key_cols.join(", "), {
        id: "keys",
        header: "Keys",
        cell: (info) => (
          <span className="font-mono text-[10px] text-mm-text-dim">
            {info.getValue()}
          </span>
        ),
        size: 140,
      }),
      columnHelper.display({
        id: "mapping",
        header: "Mapping",
        cell: (info) => {
          const s = info.row.original;
          if (s.status === "PENDING") {
            return (
              <span className="italic text-mm-text-dim/70">not configured yet</span>
            );
          }
          return (
            <span className="font-mono text-[10px] text-mm-text">
              {formatMapping(s)}
            </span>
          );
        },
        size: 200,
      }),
      columnHelper.display({
        id: "temporal",
        header: "Temporal",
        cell: (info) => {
          const s = info.row.original;
          if (s.status === "PENDING" || !s.block) return "";
          return <span className="text-[10px]">{s.block.temporal_position}</span>;
        },
        size: 90,
      }),
      columnHelper.display({
        id: "confidence",
        header: "Confidence",
        cell: (info) => {
          const s = info.row.original;
          if (s.status === "PENDING" || !s.block) return "";
          return (
            <span className="font-mono tabular-nums text-[10px]">
              {s.block.var_fair_ratio.toFixed(3)}
            </span>
          );
        },
        size: 100,
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => {
          const s = info.row.original;
          if (s.status === "PENDING") {
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openCanvas(s.stream_name);
                }}
                className="whitespace-nowrap text-[10px] font-medium text-mm-accent hover:underline"
              >
                Configure →
              </button>
            );
          }
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(s.stream_name);
              }}
              className="rounded p-1 text-[10px] text-mm-text-dim transition-colors hover:bg-mm-error/10 hover:text-mm-error"
              title="Delete stream"
            >
              ✕
            </button>
          );
        },
        size: 90,
      }),
    ],
    [expanded, openCanvas, handleDelete, toggleExpand],
  );

  const table = useReactTable({
    data: streams,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: onFilterChange,
    globalFilterFn: (row, _id, value) => {
      const q = String(value).toLowerCase();
      if (!q) return true;
      const s = row.original;
      return (
        s.stream_name.toLowerCase().includes(q) ||
        s.key_cols.some((k) => k.toLowerCase().includes(q))
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (loading && streams.length === 0) {
    return <p className="text-[11px] text-mm-text-dim">Loading…</p>;
  }

  if (streams.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-mm-border/60 p-6 text-center">
        <p className="text-[11px] text-mm-text-dim">
          No streams yet. Use <strong>+ New stream</strong> to create one.
        </p>
      </div>
    );
  }

  const displayError = error ?? mutationError;

  return (
    <div>
      {displayError && (
        <p className="mb-3 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
          {displayError}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-mm-border/40">
        <table className="w-full border-collapse text-[11px]">
          <thead className="bg-mm-bg-deep/60 text-mm-text-dim">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() }}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={`px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider ${
                        canSort ? "cursor-pointer select-none hover:text-mm-text" : ""
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="text-[8px] text-mm-text-dim">
                            {sortDir === "asc" ? "▲" : sortDir === "desc" ? "▼" : ""}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const s = row.original;
              const isExpanded = !!expanded[s.stream_name];
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => openCanvas(s.stream_name)}
                    className="cursor-pointer border-t border-mm-border/20 transition-colors hover:bg-mm-accent/5"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-3 py-2 align-middle"
                        style={{ width: cell.column.getSize() }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {isExpanded && (
                    <tr className="border-t border-mm-border/10 bg-mm-bg-deep/30">
                      <td colSpan={row.getVisibleCells().length} className="px-6 py-3">
                        <ExpandedRow stream={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded row — shows the rest of the block config
// ---------------------------------------------------------------------------

function ExpandedRow({ stream }: { stream: RegisteredStream }) {
  if (stream.status === "PENDING" || !stream.block) {
    return (
      <p className="text-[10px] italic text-mm-text-dim">
        Stream is pending — open in canvas to configure.
      </p>
    );
  }
  const b = stream.block;
  const rows: [string, string][] = [
    ["aggregation_logic", b.aggregation_logic],
    ["annualized", b.annualized ? "yes" : "no"],
    ["size_type", b.size_type],
    ["decay_profile", b.decay_profile],
    ["decay_end_size_mult", b.decay_end_size_mult.toFixed(3)],
    ["decay_rate_prop_per_min", b.decay_rate_prop_per_min.toFixed(6)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[10px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2">
          <dt className="text-mm-text-dim">{k}</dt>
          <dd className="font-mono tabular-nums text-mm-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

