import { useEffect, useState } from "react";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { useFocus } from "../../providers/FocusProvider";
import { valColor, formatUtcTime } from "../../utils";

const HIGHLIGHT_AGE_MS = 2500;
const NOW_TICK_MS = 250;

/**
 * Horizontal-scrolling update ticker.
 *
 * Replaces the panel-sized UpdatesFeed in the new workbench layout. Recent
 * position changes scroll right-to-left across a thin strip at the top of
 * the main canvas — Bloomberg-ticker style. Click a card to focus the
 * corresponding cell. Click an already-focused card to unfocus (toggle).
 *
 * Sized at 36px to be present without competing with the position grid /
 * pipeline chart for vertical real estate.
 */
export function UpdatesTicker() {
  const { updateHistory } = useWebSocket();
  const { toggleFocus } = useFocus();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (updateHistory.length === 0) {
    return (
      <div className="glass-bar flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-[10px] text-mm-text-subtle">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Updates
        </span>
        <span>—</span>
      </div>
    );
  }

  return (
    <div className="glass-bar flex h-9 shrink-0 items-center gap-2 rounded-md border pl-3">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
        Updates
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-3">
        {updateHistory.map((card) => {
          const isRecent = now - card.timestamp < HIGHLIGHT_AGE_MS;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() =>
                toggleFocus({ kind: "cell", symbol: card.symbol, expiry: card.expiry })
              }
              className={`flex shrink-0 items-center gap-1.5 rounded-md border border-black/[0.06] bg-white/55 px-2 py-1 text-left transition-colors hover:bg-white/80 hover:ring-1 hover:ring-mm-accent/20 ${
                isRecent ? "ring-1 ring-mm-accent/40" : ""
              }`}
              title={`${card.symbol} ${card.expiry} at ${formatUtcTime(card.timestamp)}`}
            >
              <span className="text-[10px] font-semibold text-mm-text">
                {card.symbol} {card.expiry}
              </span>
              <span className={`font-mono text-[10px] tabular-nums ${valColor(card.delta)}`}>
                {card.delta > 0 ? "+" : ""}
                {card.delta.toFixed(2)}
              </span>
              <span className="text-[9px] text-mm-text-subtle">$vega</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
