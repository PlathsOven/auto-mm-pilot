import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { useChat } from "../providers/ChatProvider";

function investigationLabel(ctx: NonNullable<ReturnType<typeof useChat>["investigation"]>): string {
  if (ctx.type === "update") {
    return `${ctx.card.symbol} ${ctx.card.expiry} — ${ctx.card.oldPos > 0 ? "+" : ""}${ctx.card.oldPos.toFixed(2)} → ${ctx.card.newPos > 0 ? "+" : ""}${ctx.card.newPos.toFixed(2)} $vega`;
  }
  return `${ctx.symbol} ${ctx.expiry} — Edge ${ctx.position.edge.toFixed(4)} vp, Desired ${ctx.position.desiredPos > 0 ? "+" : ""}${ctx.position.desiredPos.toFixed(2)} $vega`;
}

export function LlmChat() {
  const { messages, investigation, isStreaming, sendMessage, clearInvestigation, cancelStream } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    const prefix = investigation ? `[Context: ${investigationLabel(investigation)}]\n` : "";
    sendMessage(prefix + text);
    setInput("");
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-mm-border/40 pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">APT Chat</h2>
          <span className="text-[9px] text-mm-text-dim">Ask the engine anything</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            Ask <span className="font-semibold text-mm-accent">APT</span> about positions, edges, or pipeline state.
          </p>
        )}

        {messages.map((msg) => {
          const isApt = msg.role === "assistant";

          return (
            <div
              key={msg.id}
              className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                isApt
                  ? "border-l-2 border-mm-accent/50 bg-mm-accent/5"
                  : "bg-mm-bg/60"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[7px] font-bold ${
                    isApt
                      ? "bg-mm-accent/30 text-mm-accent"
                      : "bg-mm-accent/20 text-mm-accent"
                  }`}
                >
                  {isApt ? "AI" : "U"}
                </span>
                <span
                  className={`text-[10px] font-semibold ${
                    isApt ? "text-mm-accent" : "text-mm-text"
                  }`}
                >
                  {isApt ? "APT" : "You"}
                </span>
              </div>
              {isApt ? (
                <div className="prose-apt text-mm-text">
                  <Markdown>{msg.content}</Markdown>
                </div>
              ) : (
                <span className="text-mm-text-dim">
                  {msg.content}
                </span>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Investigation context pill */}
      {investigation && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border-l-2 border-mm-accent bg-mm-accent/5 px-3 py-1.5">
          <span className="flex-1 text-[10px] leading-relaxed text-mm-accent">
            {investigationLabel(investigation)}
          </span>
          <button onClick={clearInvestigation} className="shrink-0 text-[10px] text-mm-text-dim hover:text-mm-text">✕</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={investigation ? "Ask about this context..." : "Ask APT anything..."}
          className="flex-1 rounded-lg border border-mm-border/40 bg-mm-bg px-3 py-2 text-xs text-mm-text outline-none placeholder:text-mm-text-dim transition-colors focus:border-mm-accent/60 focus:ring-1 focus:ring-mm-accent/20"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={cancelStream}
            className="rounded-lg border border-mm-warn/40 bg-mm-surface px-4 py-2 text-xs text-mm-warn transition-colors hover:bg-mm-warn/10"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="rounded-lg border border-mm-border/40 bg-mm-surface px-4 py-2 text-xs text-mm-accent transition-colors hover:bg-mm-accent/10"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
