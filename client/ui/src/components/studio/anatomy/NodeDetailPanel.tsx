import { useCallback, useState } from "react";
import type { TransformStep, UnregisteredPushAttempt } from "../../../types";
import type { StepKey } from "./anatomyGraph";
import { StreamCanvas } from "../StreamCanvas";
import { StreamTable } from "../StreamTable";
import { NewStreamMenu } from "../NewStreamMenu";
import type { StreamDraftPrefill } from "../canvasState";
import { TransformDetail } from "./TransformDetail";
import { useNotifications } from "../../../providers/NotificationsProvider";
import { useMode } from "../../../providers/ModeProvider";
import {
  UnregisteredPushCard,
  inferKeyColsFromExampleRow,
} from "../../notifications/UnregisteredPushCard";

export type AnatomySelection =
  | { kind: "transform"; stepKey: StepKey }
  | { kind: "stream"; streamName: string }
  | { kind: "list" }
  | { kind: "none" };

interface Props {
  selection: AnatomySelection;
  steps: Record<string, TransformStep> | null;
  savingKey: string | null;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
  onClose: () => void;
  /** When the panel is in `list` mode and the user opens a specific stream
   *  from the table, the parent updates `selection` to the stream variant. */
  onOpenStream: (streamName: string) => void;
  /** Switch the panel to the streams-list view (used by the in-editor
   *  "All streams" back button). */
  onShowList: () => void;
  /** Fired after a successful stream Activate. Parent (AnatomyCanvas) jumps
   *  to the Streams list and pans the DAG to the new node for clear
   *  "it worked" feedback. */
  onStreamActivated?: (streamName: string) => void;
  /** Optional pre-filled values when deep-linking into a new stream form
   *  from the Notifications center. Applied only when `streamName === "new"`. */
  streamPrefill?: StreamDraftPrefill | null;
}

/**
 * Unified right-side inspector panel for the Anatomy canvas.
 *
 * Mounted whenever any node is selected — stream, transform, or otherwise.
 * Earlier the anatomy view had two competing sidebars (left for streams,
 * right for transforms); this single panel keeps the visual model
 * consistent: click a node → panel opens with that node's editor, click
 * the same node again or hit ✕ to close.
 *
 * For stream nodes the panel hosts the existing `<StreamCanvas/>` editor
 * (the same one the legacy left sidebar mounted), so stream configuration
 * lives in the same surface as transform configuration.
 */
export function NodeDetailPanel({
  selection,
  steps,
  savingKey,
  onSelectTransform,
  onParamChange,
  onClose,
  onOpenStream,
  onShowList,
  onStreamActivated,
  streamPrefill,
}: Props) {
  const [streamFilter, setStreamFilter] = useState("");
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
              <button
                type="button"
                onClick={onShowList}
                className="mb-1 flex items-center gap-1 text-[10px] text-mm-text-dim transition-colors hover:text-mm-accent"
                title="Back to all streams"
              >
                ← All streams
              </button>
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
              templateId={null}
              prefill={streamPrefill ?? null}
              onActivated={onStreamActivated}
            />
          </div>
        </div>
      )}

      {selection.kind === "list" && (
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3">
            <div>
              <h3 className="zone-header">Streams</h3>
              <p className="mt-0.5 text-[10px] text-mm-text-dim">Every data source feeding the pipeline.</p>
            </div>
            <div className="flex items-center gap-2">
              <NewStreamMenu
                onOpenBlank={() => onOpenStream("new")}
                onOpenTemplate={(_id) => onOpenStream("new")}
              />
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
          </header>
          <div className="border-b border-black/[0.06] px-4 py-3">
            <input
              type="text"
              value={streamFilter}
              onChange={(e) => setStreamFilter(e.target.value)}
              placeholder="Filter by name or key column…"
              className="form-input w-full"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <UnregisteredStreamsBanner />
            <StreamTable filter={streamFilter} onFilterChange={setStreamFilter} onOpenStream={onOpenStream} />
          </div>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Unregistered streams banner — mirrors the Notifications center inline so
// the user can register the next pending stream without leaving the list.
// ---------------------------------------------------------------------------

function UnregisteredStreamsBanner() {
  const { unregistered, dismissUnregistered } = useNotifications();
  const { navigate } = useMode();

  const handleRegister = useCallback(
    (entry: UnregisteredPushAttempt) => {
      const params = new URLSearchParams({
        stream: "new",
        prefillName: entry.streamName,
        prefillKeyCols: inferKeyColsFromExampleRow(entry.exampleRow).join(","),
        prefillRow: JSON.stringify(entry.exampleRow),
      });
      navigate(`anatomy?${params.toString()}`);
    },
    [navigate],
  );

  if (unregistered.length === 0) return null;

  return (
    <section className="mb-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-mm-warn">
          Unregistered streams
        </h4>
        <span className="text-[9px] text-mm-text-dim">
          Register each to feed the pipeline.
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {unregistered.map((e) => (
          <UnregisteredPushCard
            key={e.streamName}
            entry={e}
            compact
            onRegister={() => handleRegister(e)}
            onDismiss={() => { void dismissUnregistered(e.streamName); }}
          />
        ))}
      </ul>
    </section>
  );
}

