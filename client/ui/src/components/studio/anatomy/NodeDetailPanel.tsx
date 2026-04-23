import type { TransformStep } from "../../../types";
import type { StepKey } from "./anatomyGraph";
import { StreamCanvas } from "../StreamCanvas";
import type { StreamDraftPrefill } from "../canvasState";
import { TransformDetail } from "./TransformDetail";

export type AnatomySelection =
  | { kind: "transform"; stepKey: StepKey }
  | { kind: "stream"; streamName: string }
  | { kind: "none" };

interface Props {
  selection: AnatomySelection;
  steps: Record<string, TransformStep> | null;
  savingKey: string | null;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
  onClose: () => void;
  /** Fired after a successful stream Activate. Parent (AnatomyCanvas) closes
   *  the panel and pans the DAG to the new stream node. */
  onStreamActivated?: (streamName: string) => void;
  /** Optional pre-filled values when deep-linking into a new stream form
   *  from the Notifications center. Applied only when `streamName === "new"`. */
  streamPrefill?: StreamDraftPrefill | null;
}

/**
 * Right-side inspector panel for the Anatomy canvas.
 *
 * Mounted whenever a stream or transform node is selected. For stream
 * nodes the panel hosts `<StreamCanvas/>`; for transform nodes it hosts
 * `<TransformDetail/>`. Click a node again, hit ✕, or click the pane to
 * close.
 */
export function NodeDetailPanel({
  selection,
  steps,
  savingKey,
  onSelectTransform,
  onParamChange,
  onClose,
  onStreamActivated,
  streamPrefill,
}: Props) {
  if (selection.kind === "none") return null;

  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-black/[0.08] bg-white/55">
      {selection.kind === "transform" && (
        <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
          {(() => {
            const step = steps?.[selection.stepKey];
            if (!step) {
              return <p className="text-[11px] text-mm-text-dim">Step not loaded.</p>;
            }
            return (
              <TransformDetail
                stepKey={selection.stepKey}
                step={step}
                saving={savingKey === selection.stepKey}
                onSelectTransform={onSelectTransform}
                onParamChange={onParamChange}
                onClose={onClose}
              />
            );
          })()}
        </div>
      )}

      {selection.kind === "stream" && (
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-3">
            <div className="min-w-0">
              <h3 className="zone-header">Stream</h3>
              <p className="mt-0.5 truncate font-mono text-[10px] text-mm-text-dim">{selection.streamName}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
              title="Close (Esc)"
            >
              ✕
            </button>
          </header>
          {/* flex-col here is load-bearing: StreamCanvas's top-level div
              uses `flex-1` to take its parent's height, and `flex-1` only
              works inside a flex container. Without this, StreamCanvas
              stayed at content height and its internal `overflow-y-auto`
              had nothing to scroll against. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* The `key` forces a remount when either the target stream or
                the prefill identity changes. StreamCanvas uses `useState`
                initializers for its draft + pending-name state, so without
                remounting a second "Register this stream" CTA from the
                Notifications panel would see stale draft values. */}
            <StreamCanvas
              key={`${selection.streamName}:${streamPrefill?.streamName ?? ""}`}
              streamName={selection.streamName}
              prefill={streamPrefill ?? null}
              onActivated={onStreamActivated}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
