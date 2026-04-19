import type { SilentStreamAlert } from "../../types";

interface Props {
  entry: SilentStreamAlert;
  onOpenStream: (streamName: string) => void;
  onDismiss: () => void;
}

/** Alert card shown when a READY stream's recent snapshots carry no
 *  `market_value`. The default (market_value = fair) collapses edge to
 *  zero for that block, so every desired position reads zero with no
 *  obvious cause. The primary CTA opens the stream in Anatomy so the
 *  operator can check the feed configuration. */
export function SilentStreamCard({ entry, onOpenStream, onDismiss }: Props) {
  return (
    <li className="rounded-lg border border-mm-error/40 bg-mm-error/[0.07] p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mm-error">
            No market values
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-mm-text">
            {entry.streamName}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full bg-mm-error/20 px-2 py-0.5 text-[9px] font-semibold text-mm-error"
          title={`First seen ${entry.firstSeen}\nLast seen ${entry.lastSeen}`}
        >
          {entry.rowsSeen} row{entry.rowsSeen === 1 ? "" : "s"}
        </span>
      </header>

      <p className="mb-3 text-[10px] text-mm-text-dim">
        This stream has only sent <span className="font-mono">raw_value</span>,
        so market-implied values default to match fair — edge collapses to zero
        and desired positions may all read zero. Send{" "}
        <span className="font-mono">market_value</span> with each snapshot to
        restore the signal.
      </p>

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
          onClick={() => onOpenStream(entry.streamName)}
          className="rounded-md bg-mm-error/15 px-3 py-1 text-[10px] font-semibold text-mm-error transition-colors hover:bg-mm-error/25"
        >
          Open stream
        </button>
      </div>
    </li>
  );
}
