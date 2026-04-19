import type { UnregisteredPushAttempt } from "../../types";

const RESERVED_COLS = new Set(["timestamp", "raw_value", "market_value"]);

interface Props {
  entry: UnregisteredPushAttempt;
  onRegister: () => void;
  onDismiss: () => void;
  /** When `true`, hide the "Example row" JSON block to keep the card compact
   *  in surfaces that sit alongside a busy Streams table. The Notifications
   *  slide-over still shows the full row. */
  compact?: boolean;
}

/** Derive the key columns from an unregistered push's example row by
 *  filtering out the three reserved column names the registry injects. */
export function inferKeyColsFromExampleRow(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((k) => !RESERVED_COLS.has(k));
}

export function UnregisteredPushCard({ entry, onRegister, onDismiss, compact }: Props) {
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

      {!compact && (
        <div className="mb-3 rounded-md border border-black/[0.06] bg-black/[0.03] p-2">
          <div className="mb-1 text-[9px] uppercase tracking-wider text-mm-text-dim">
            Example row
          </div>
          <pre className="overflow-x-auto font-mono text-[10px] leading-snug text-mm-text">
{JSON.stringify(entry.exampleRow, null, 2)}
          </pre>
        </div>
      )}

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
