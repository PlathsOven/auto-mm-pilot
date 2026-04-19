import { useCallback } from "react";
import { useMode } from "../../providers/ModeProvider";
import { useNotifications } from "../../providers/NotificationsProvider";
import type { UnregisteredPushAttempt } from "../../types";
import {
  UnregisteredPushCard,
  inferKeyColsFromExampleRow,
} from "./UnregisteredPushCard";
import { SilentStreamCard } from "./SilentStreamCard";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Slide-over notifications panel.
 *
 * Entries + hydration + dismissal come from `<NotificationsProvider/>` so
 * the unregistered list is shared with the Anatomy → Streams list banner.
 * "Register this stream" deep-links into Anatomy with the form pre-filled;
 * silent-stream "Open stream" deep-links into Anatomy on the existing
 * stream so the operator can inspect / fix the feed.
 */
export function NotificationsCenter({ open, onClose }: Props) {
  const { navigate } = useMode();
  const {
    unregistered,
    silentStreams,
    dismissUnregistered,
    dismissSilentStream,
  } = useNotifications();

  const totalCount = unregistered.length + silentStreams.length;

  const handleRegister = useCallback(
    (entry: UnregisteredPushAttempt) => {
      const params = new URLSearchParams({
        stream: "new",
        prefillName: entry.streamName,
        prefillKeyCols: inferKeyColsFromExampleRow(entry.exampleRow).join(","),
        prefillRow: JSON.stringify(entry.exampleRow),
      });
      navigate(`anatomy?${params.toString()}`);
      onClose();
    },
    [navigate, onClose],
  );

  const handleOpenStream = useCallback(
    (streamName: string) => {
      const params = new URLSearchParams({ stream: streamName });
      navigate(`anatomy?${params.toString()}`);
      onClose();
    },
    [navigate, onClose],
  );

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-[420px] flex-col overflow-hidden border-l border-black/[0.08] bg-white/95 shadow-xl"
        role="dialog"
        aria-label="Notifications"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3">
          <div>
            <h3 className="zone-header">Notifications</h3>
            <p className="mt-0.5 text-[10px] text-mm-text-dim">
              {totalCount === 0
                ? "No pending items."
                : `${totalCount} pending item${totalCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {totalCount === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="text-[11px] text-mm-text-dim">
                You're all caught up.
              </span>
              <span className="text-[10px] text-mm-text-subtle">
                Notifications appear here when a feeder pushes data for a stream that
                hasn't been registered yet, or when a registered stream's snapshots
                stop carrying market_value.
              </span>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {unregistered.map((e) => (
                <UnregisteredPushCard
                  key={`u:${e.streamName}`}
                  entry={e}
                  onRegister={() => handleRegister(e)}
                  onDismiss={() => { void dismissUnregistered(e.streamName); }}
                />
              ))}
              {silentStreams.map((e) => (
                <SilentStreamCard
                  key={`s:${e.streamName}`}
                  entry={e}
                  onOpenStream={handleOpenStream}
                  onDismiss={() => { void dismissSilentStream(e.streamName); }}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
