"use client";

import { useEffect, useState } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { useChat } from "../providers/ChatProvider";
import { valColor, formatUtcTime } from "../utils";

const HIGHLIGHT_AGE_MS = 2500;

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

              <p className="text-[10px] leading-relaxed text-mm-text-dim">
                {card.reason}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
