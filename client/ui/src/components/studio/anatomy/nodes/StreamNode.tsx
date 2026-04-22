import { memo, useCallback, useRef, useState, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BlockConfigPayload, RegisteredStreamStatus } from "../../../../types";
import { deleteStream, setStreamActive } from "../../../../services/streamApi";
import { useRegisteredStreams } from "../../../../hooks/useRegisteredStreams";

export interface StreamNodeData {
  streamName: string;
  status: RegisteredStreamStatus;
  keyCols: string[];
  active: boolean;
  scale: number | null;
  offset: number | null;
  exponent: number | null;
  block: BlockConfigPayload | null;
  selected?: boolean;
  [key: string]: unknown;
}

const STATUS_DOT: Record<RegisteredStreamStatus, string> = {
  PENDING: "bg-mm-warn",
  READY: "bg-mm-accent",
};

const STATUS_TEXT: Record<RegisteredStreamStatus, string> = {
  PENDING: "text-mm-warn",
  READY: "text-mm-accent",
};

// Hover popover card width — used to clamp within viewport.
const POPOVER_WIDTH = 280;
const POPOVER_MARGIN = 8;
const POPOVER_OFFSET = 8;

/**
 * Custom React Flow node for a registered stream feeding the pipeline.
 *
 * Draggable, clickable, and linked via an edge to `unit_conversion`. Click
 * selection is handled by React Flow's `onNodeClick`; AnatomyCanvas opens
 * the StreamCanvas drawer on click. Hovering surfaces every configured
 * detail that doesn't fit on the card face (mapping, confidence, block
 * shape, active toggle, delete).
 */
export const StreamNode = memo(function StreamNode({
  data,
  selected,
}: NodeProps) {
  const { streamName, status, keyCols } = data as StreamNodeData;
  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`flex w-[200px] flex-col gap-1 rounded-xl border bg-black/[0.05] p-3 shadow-sm transition-colors ${
        selected
          ? "border-mm-accent/70 ring-2 ring-mm-accent/40"
          : "border-black/[0.08] hover:border-mm-accent/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
        <span className="truncate text-[11px] font-semibold text-mm-text">{streamName}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className={`text-[9px] font-medium uppercase ${STATUS_TEXT[status]}`}>
          {status}
        </span>
        <span className="truncate text-[9px] font-mono text-mm-text-dim">
          {keyCols.join(", ")}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
      />
      {hovered && (
        <StreamHoverPopover
          data={data as StreamNodeData}
          anchorRef={rootRef}
        />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Hover popover
// ---------------------------------------------------------------------------

function formatMapping(scale: number | null, offset: number | null, exponent: number | null): string {
  if (scale == null || offset == null || exponent == null) return "—";
  return `${scale.toFixed(3)} · raw^${exponent.toFixed(3)} + ${offset.toFixed(3)}`;
}

interface PopoverProps {
  data: StreamNodeData;
  anchorRef: RefObject<HTMLDivElement | null>;
}

/**
 * Portal-rendered popover showing every stream detail that doesn't fit on
 * the node card. Positioned right of the anchor with fixed coordinates so
 * it escapes the React Flow viewport transform (which would otherwise
 * scale the popup along with the canvas).
 *
 * Actions (active toggle, delete) stop propagation so the surrounding
 * stream-node click — which opens the edit form — doesn't also fire.
 */
function StreamHoverPopover({ data, anchorRef }: PopoverProps) {
  const { refresh } = useRegisteredStreams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggleActive = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await setStreamActive(data.streamName, !data.active);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, data.active, data.streamName, refresh],
  );

  const handleDelete = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await deleteStream(data.streamName);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, data.streamName, refresh],
  );

  const rect = anchorRef.current?.getBoundingClientRect();
  if (!rect || typeof document === "undefined") return null;

  // Prefer placing the popover to the right of the node; flip to the left
  // if it would overflow the viewport.
  let left = rect.right + POPOVER_OFFSET;
  if (left + POPOVER_WIDTH + POPOVER_MARGIN > window.innerWidth) {
    left = rect.left - POPOVER_WIDTH - POPOVER_OFFSET;
  }
  left = Math.max(POPOVER_MARGIN, left);
  const top = Math.max(POPOVER_MARGIN, Math.min(rect.top, window.innerHeight - 260));

  const blockRows: [string, string][] = data.block
    ? [
        ["annualized", data.block.annualized ? "yes" : "no"],
        ["temporal", data.block.temporal_position],
        ["confidence", data.block.var_fair_ratio.toFixed(3)],
        ["decay end mult", data.block.decay_end_size_mult.toFixed(3)],
        ["decay rate/min", data.block.decay_rate_prop_per_min.toFixed(6)],
      ]
    : [];

  return createPortal(
    <div
      className="fixed z-[120] rounded-lg border border-white/50 bg-white/90 p-3 shadow-elev-3 ring-1 ring-black/[0.06] backdrop-blur-glass24"
      style={{ top, left, width: POPOVER_WIDTH }}
      // Don't intercept the pointer — let the underlying node own hover so
      // the popover disappears cleanly when the cursor leaves the card.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mb-2 flex items-baseline justify-between border-b border-black/[0.06] pb-1.5">
        <span className="truncate text-[11px] font-semibold text-mm-text">{data.streamName}</span>
        <span className={`text-[9px] font-medium uppercase ${STATUS_TEXT[data.status]}`}>
          {data.status}
        </span>
      </div>

      <dl className="flex flex-col gap-1 text-[10px]">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-mm-text-dim">mapping</dt>
          <dd className="font-mono tabular-nums text-mm-text">
            {data.status === "PENDING"
              ? <span className="italic text-mm-text-dim/70">not configured</span>
              : formatMapping(data.scale, data.offset, data.exponent)}
          </dd>
        </div>
        {blockRows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <dt className="text-mm-text-dim">{k}</dt>
            <dd className="font-mono tabular-nums text-mm-text">{v}</dd>
          </div>
        ))}
      </dl>

      {data.status !== "PENDING" && (
        <div className="mt-2.5 flex items-center justify-between border-t border-black/[0.06] pt-2">
          <button
            type="button"
            role="switch"
            aria-checked={data.active}
            onClick={handleToggleActive}
            disabled={busy}
            className="flex items-center gap-1.5 text-[10px] text-mm-text-dim transition-colors hover:text-mm-text disabled:opacity-50"
            title={data.active ? "Deactivate stream" : "Reactivate stream"}
          >
            <span
              className={`relative inline-flex h-[12px] w-[22px] items-center rounded-full transition-colors ${
                data.active ? "bg-mm-accent" : "bg-mm-text-dim/30"
              }`}
            >
              <span
                className={`inline-block h-[8px] w-[8px] transform rounded-full bg-white shadow-sm transition-transform ${
                  data.active ? "translate-x-[12px]" : "translate-x-[2px]"
                }`}
              />
            </span>
            <span>{data.active ? "active" : "inactive"}</span>
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded p-1 text-[10px] text-mm-text-dim transition-colors hover:bg-mm-error/10 hover:text-mm-error disabled:opacity-50"
            title="Delete stream"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-mm-error/40 bg-mm-error/10 p-1.5 text-[10px] text-mm-error">
          {error}
        </p>
      )}
    </div>,
    document.body,
  );
}
