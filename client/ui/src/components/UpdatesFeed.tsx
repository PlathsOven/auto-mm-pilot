import { useEffect, useState } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { useChat } from "../providers/ChatProvider";
import { valColor, formatUtcTime } from "../utils";
import { useStreamContributions } from "../hooks/useStreamContributions";

const HIGHLIGHT_AGE_MS = 2500;
const ATTRIBUTION_TOP_N = 2;

export function UpdatesFeed() {
  const { payload, updateHistory } = useWebSocket();
  const { investigate } = useChat();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const lastUpdate = payload?.context?.lastUpdateTimestamp ?? 0;
  const elapsed = lastUpdate > 0 ? now - lastUpdate : 0;

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-mm-border/40 pb-2">
        <h2 className="zone-header">Updates</h2>
        <span className="text-[10px] tabular-nums text-mm-text-dim">
          {lastUpdate > 0 ? `Last update: +${elapsed}ms` : "—"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {updateHistory.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            Awaiting updates...
          </p>
        )}

        {updateHistory.map((card) => {
          const isRecent = now - card.timestamp < HIGHLIGHT_AGE_MS;
          return (
            <div
              key={card.id}
              onClick={() => investigate({ type: "update", card })}
              className={`cursor-pointer rounded-lg border border-mm-border/40 bg-mm-bg/50 p-3 transition-colors hover:bg-mm-bg/80 hover:ring-1 hover:ring-mm-accent/30 ${isRecent ? "row-highlight" : ""}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-mm-text">
                  {card.asset} — {card.expiry}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-mm-text-dim">
                  {formatUtcTime(card.timestamp)}
                </span>
              </div>

              <div className="mb-1 flex items-baseline gap-3 text-xs tabular-nums">
                <span className={valColor(card.oldPos)}>
                  {card.oldPos > 0 ? "+" : ""}
                  {card.oldPos.toFixed(2)}
                </span>
                <span className="text-mm-text-dim">→</span>
                <span className={`font-semibold ${valColor(card.newPos)}`}>
                  {card.newPos > 0 ? "+" : ""}
                  {card.newPos.toFixed(2)}
                </span>
                <span className={`font-semibold ${valColor(card.delta)}`}>
                  {card.delta > 0 ? "+" : ""}
                  {card.delta.toFixed(2)}
                </span>
                <span className="text-[10px] text-mm-text-dim">$vega</span>
              </div>

              <CardAttribution asset={card.asset} expiry={card.expiry} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Top-N stream contributions for an update card — shows WHICH stream
 * caused the position change without leaving the feed.
 */
function CardAttribution({ asset, expiry }: { asset: string; expiry: string }) {
  const { contributions } = useStreamContributions({ asset, expiry });
  if (!contributions || contributions.length === 0) return null;

  const top = contributions.slice(0, ATTRIBUTION_TOP_N);

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-mm-border/30 pt-1.5">
      <span className="text-[9px] uppercase tracking-wider text-mm-text-dim">
        Streams
      </span>
      {top.map((c) => (
        <span
          key={c.blockName}
          className="rounded border border-mm-border/40 bg-mm-bg/40 px-1.5 py-0.5 text-[9px] tabular-nums"
        >
          <span className="text-mm-text">{c.blockName}</span>
          <span className={`ml-1 ${valColor(c.edge)}`}>
            {c.edge >= 0 ? "+" : ""}
            {c.edge.toFixed(4)}
          </span>
        </span>
      ))}
      {contributions.length > ATTRIBUTION_TOP_N && (
        <span className="text-[9px] text-mm-text-dim">
          +{contributions.length - ATTRIBUTION_TOP_N}
        </span>
      )}
    </div>
  );
}
