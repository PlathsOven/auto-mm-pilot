import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { TRACK_COLORS, TRACK_TOP_PCT, type TrackKey } from "../anatomyGraph";

export interface TransformLaneBoundary {
  from: string;
  to: string;
}

export interface TransformNodeData {
  stepNumber: number;
  label: string;
  selectedImpl: string;
  subtitle: string;
  saving: boolean;
  laneBoundary?: TransformLaneBoundary;
  inTracks?: readonly TrackKey[];
  outTracks?: readonly TrackKey[];
  [key: string]: unknown;
}

/**
 * Custom React Flow node for a pipeline transform step.
 *
 * Click-to-select routes through AnatomyCanvas → NodeDetailPanel.
 *
 * Multiple handles per side render the fair / var / market tracks that
 * run in parallel through the pipeline; positions are driven by
 * `inTracks` / `outTracks` (see NODE_TRACKS in anatomyGraph.ts), and
 * each handle picks up its track colour so the tracks stay
 * distinguishable at typical zoom. A node with empty tracks on a side
 * falls back to a single default (centred) handle.
 *
 * Optional `laneBoundary` renders a two-tone chip naming the split
 * ("raw → calc" / "calc → target") when the node straddles a lane.
 */
export const TransformNode = memo(function TransformNode({
  data,
  selected,
}: NodeProps) {
  const {
    stepNumber,
    label,
    selectedImpl,
    subtitle,
    saving,
    laneBoundary,
    inTracks = [],
    outTracks = [],
  } = data as TransformNodeData;

  return (
    <div
      // Fixed height keeps the per-track handles at the same absolute y
      // across every node so the parallel track wires stay parallel.
      className={`relative flex h-[140px] w-[240px] flex-col gap-1.5 rounded-xl border bg-black/[0.05] p-3 shadow-sm transition-colors ${
        selected
          ? "border-mm-accent/70 ring-2 ring-mm-accent/40 ring-offset-2 ring-offset-mm-bg-deep"
          : "border-black/[0.08] hover:border-mm-accent/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mm-bg-deep text-[10px] font-semibold text-mm-accent">
          {stepNumber}
        </span>
        <h4 className="truncate text-xs font-semibold text-mm-text">{label}</h4>
        {saving && <span className="ml-auto text-[9px] text-mm-text-dim">saving…</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-block rounded bg-mm-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-mm-accent">
          {selectedImpl}
        </span>
        {laneBoundary && (
          <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white/70 px-1.5 py-0.5 font-mono text-[9px] text-mm-text-dim">
            <span>{laneBoundary.from}</span>
            <span aria-hidden>→</span>
            <span>{laneBoundary.to}</span>
          </span>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-mm-text-dim">{subtitle}</p>

      {/* Target (input) handles */}
      {inTracks.length === 0 ? (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
        />
      ) : (
        inTracks.map((track) => (
          <Handle
            key={`in-${track}`}
            id={track}
            type="target"
            position={Position.Left}
            style={{
              top: `${TRACK_TOP_PCT[track]}%`,
              background: TRACK_COLORS[track],
              borderColor: TRACK_COLORS[track],
            }}
            className="!h-2 !w-2"
          />
        ))
      )}

      {/* Source (output) handles */}
      {outTracks.length === 0 ? (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
        />
      ) : (
        outTracks.map((track) => (
          <Handle
            key={`out-${track}`}
            id={track}
            type="source"
            position={Position.Right}
            style={{
              top: `${TRACK_TOP_PCT[track]}%`,
              background: TRACK_COLORS[track],
              borderColor: TRACK_COLORS[track],
            }}
            className="!h-2 !w-2"
          />
        ))
      )}
    </div>
  );
});
