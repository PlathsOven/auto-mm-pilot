import { useCallback, useEffect, useMemo, useState } from "react";
import { useMode } from "../../providers/ModeProvider";
import { useWebSocket } from "../../providers/WebSocketProvider";
import {
  dismissUnregisteredPush,
  fetchUnregisteredPushes,
} from "../../services/notificationsApi";
import type { UnregisteredPushAttempt } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

const RESERVED_COLS = new Set(["timestamp", "raw_value", "market_value"]);

/**
 * Slide-over notifications panel.
 *
 * Source of truth: the WS tick payload (`payload.unregisteredPushes`). We
 * hydrate once from `GET /api/notifications/unregistered` on first open
 * so the list is populated before the first tick arrives, then track the
 * WS payload thereafter. Dismissing calls the server to remove the entry
 * from the shared store; other tabs / devices stop seeing it on the next
 * tick.
 *
 * The "Register this stream" CTA deep-links into Anatomy:
 *   #anatomy?stream=new&prefillName=<name>&prefillKeyCols=<csv>&prefillRow=<json>
 * `AnatomyCanvas` parses those params and passes them through to
 * `StreamCanvas`, which merges them into the initial `StreamDraft`.
 */
export function NotificationsCenter({ open, onClose }: Props) {
  const { payload } = useWebSocket();
  const { navigate } = useMode();
  const [hydrated, setHydrated] = useState<UnregisteredPushAttempt[] | null>(null);

  // Hydrate once on first open so the panel is populated before the next tick.
  useEffect(() => {
    if (!open || hydrated !== null) return;
    const controller = new AbortController();
    fetchUnregisteredPushes(controller.signal)
      .then(setHydrated)
      .catch(() => setHydrated([]));
    return () => controller.abort();
  }, [open, hydrated]);

  // WS payload is the live source once we have one; fall back to the
  // hydrate result until the first tick arrives.
  const entries: UnregisteredPushAttempt[] = useMemo(
    () => payload?.unregisteredPushes ?? hydrated ?? [],
    [payload, hydrated],
  );

  const handleDismiss = useCallback(async (streamName: string) => {
    try {
      await dismissUnregisteredPush(streamName);
      // Optimistically drop from hydrated cache too — the WS tick will
      // converge to empty on the next broadcast.
      setHydrated((prev) => (prev ? prev.filter((e) => e.streamName !== streamName) : prev));
    } catch {
      // Surface silently — the server list is authoritative on the next tick.
    }
  }, []);

  const handleRegister = useCallback(
    (entry: UnregisteredPushAttempt) => {
      const inferredKeyCols = Object.keys(entry.exampleRow).filter(
        (k) => !RESERVED_COLS.has(k),
      );
      const params = new URLSearchParams({
        stream: "new",
        prefillName: entry.streamName,
        prefillKeyCols: inferredKeyCols.join(","),
        prefillRow: JSON.stringify(entry.exampleRow),
      });
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
              {entries.length === 0
                ? "No pending items."
                : `${entries.length} unregistered stream${entries.length === 1 ? "" : "s"}`}
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
          {entries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="text-[11px] text-mm-text-dim">
                You're all caught up.
              </span>
              <span className="text-[10px] text-mm-text-subtle">
                Notifications appear here when a feeder pushes data for a stream that
                hasn't been registered yet.
              </span>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {entries.map((e) => (
                <UnregisteredPushCard
                  key={e.streamName}
                  entry={e}
                  onRegister={() => handleRegister(e)}
                  onDismiss={() => handleDismiss(e.streamName)}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

function UnregisteredPushCard({
  entry,
  onRegister,
  onDismiss,
}: {
  entry: UnregisteredPushAttempt;
  onRegister: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="rounded-lg border border-mm-warn/40 bg-mm-warn/[0.08] p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mm-warn">
            Unregistered stream
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-mm-text">
            {entry.streamName}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full bg-mm-warn/20 px-2 py-0.5 text-[9px] font-semibold text-mm-warn"
          title={`First seen ${entry.firstSeen}\nLast seen ${entry.lastSeen}`}
        >
          {entry.attemptCount} attempt{entry.attemptCount === 1 ? "" : "s"}
        </span>
      </header>

      <p className="mb-2 text-[10px] text-mm-text-dim">
        A client pushed data to this stream, but no matching stream is registered.
        Register it to start feeding the pipeline.
      </p>

      <div className="mb-3 rounded-md border border-black/[0.06] bg-black/[0.03] p-2">
        <div className="mb-1 text-[9px] uppercase tracking-wider text-mm-text-dim">
          Example row
        </div>
        <pre className="overflow-x-auto font-mono text-[10px] leading-snug text-mm-text">
{JSON.stringify(entry.exampleRow, null, 2)}
        </pre>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-black/[0.06] px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onRegister}
          className="rounded-md bg-mm-warn/20 px-3 py-1 text-[10px] font-semibold text-mm-warn transition-colors hover:bg-mm-warn/30"
        >
          Register this stream
        </button>
      </div>
    </li>
  );
}
