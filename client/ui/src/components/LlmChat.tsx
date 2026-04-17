import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { useChat } from "../providers/ChatProvider";
import type { ChatMode } from "../types";
import { CHAT_INPUT_MAX_HEIGHT_PX } from "../constants";

const MODE_LABELS: Record<ChatMode, string> = {
  investigate: "Investigate",
  build: "Build",
  general: "General",
};

function investigationLabel(ctx: NonNullable<ReturnType<typeof useChat>["investigation"]>): string {
  if (ctx.type === "update") {
    return `${ctx.card.symbol} ${ctx.card.expiry} — ${ctx.card.oldPos > 0 ? "+" : ""}${ctx.card.oldPos.toFixed(2)} → ${ctx.card.newPos > 0 ? "+" : ""}${ctx.card.newPos.toFixed(2)} $vega`;
  }
  return `${ctx.symbol} ${ctx.expiry} — Edge ${ctx.position.edge.toFixed(4)} vp, Desired ${ctx.position.desiredPos > 0 ? "+" : ""}${ctx.position.desiredPos.toFixed(2)} $vega`;
}

export function LlmChat() {
  const { messages, investigation, isStreaming, sendMessage, clearInvestigation, cancelStream, chatMode, setChatMode } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Autofocus the input each time the chat mounts (drawer open).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-grow the textarea up to the configured max height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, CHAT_INPUT_MAX_HEIGHT_PX)}px`;
  }, [input]);

  function submit() {
    const text = input.trim();
    if (!text) return;
    const prefix = investigation ? `[Context: ${investigationLabel(investigation)}]\n` : "";
    sendMessage(prefix + text);
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline (default textarea behavior).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) submit();
    }
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-black/[0.06] pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">Posit Chat</h2>
          <span className="text-[9px] text-mm-text-subtle">Ask the engine anything</span>
        </div>
        <select
          value={chatMode}
          onChange={(e) => setChatMode(e.target.value as ChatMode)}
          disabled={isStreaming}
          className="rounded-md border border-black/[0.06] bg-mm-surface-solid px-2 py-0.5 text-[10px] text-mm-text outline-none transition-colors focus:border-mm-accent/40"
        >
          {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
            <option key={m} value={m}>{MODE_LABELS[m]}</option>
          ))}
        </select>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            Ask <span className="font-semibold text-mm-accent">Posit</span> about positions, edges, or pipeline state.
          </p>
        )}

        {messages.map((msg) => {
          if (msg.role === "system") {
            return (
              <div
                key={msg.id}
                className="rounded-md bg-black/[0.02] px-3 py-1.5 text-[10px] leading-relaxed text-mm-text-subtle"
              >
                {msg.content}
              </div>
            );
          }

          const isPosit = msg.role === "assistant";

          return (
            <div
              key={msg.id}
              className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                isPosit
                  ? "border-l-2 border-mm-accent/40 bg-mm-accent/[0.04]"
                  : "bg-black/[0.03]"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[7px] font-bold ${
                    isPosit
                      ? "bg-mm-accent/10 text-mm-accent"
                      : "bg-mm-accent/10 text-mm-accent"
                  }`}
                >
                  {isPosit ? "AI" : "U"}
                </span>
                <span
                  className={`text-[10px] font-semibold ${
                    isPosit ? "text-mm-accent" : "text-mm-text"
                  }`}
                >
                  {isPosit ? "Posit" : "You"}
                </span>
              </div>
              {isPosit ? (
                msg.content ? (
                  <div className="prose-posit text-mm-text">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : isStreaming ? (
                  <ThinkingDots />
                ) : null
              ) : (
                <span className="whitespace-pre-wrap text-mm-text-dim">
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
        <div className="mt-2 flex items-center gap-2 rounded-lg border-l-2 border-mm-accent bg-mm-accent/[0.04] px-3 py-1.5">
          <span className="flex-1 text-[10px] leading-relaxed text-mm-accent">
            {investigationLabel(investigation)}
          </span>
          <button onClick={clearInvestigation} className="shrink-0 text-[10px] text-mm-text-subtle hover:text-mm-text">✕</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={investigation ? "Ask about this context..." : "Ask Posit anything..."}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-black/[0.08] bg-mm-surface-solid px-3 py-2 text-xs leading-relaxed text-mm-text outline-none placeholder:text-mm-text-subtle transition-colors focus:border-mm-accent/30 focus:ring-1 focus:ring-mm-accent/15"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={cancelStream}
            className="shrink-0 rounded-lg border border-mm-warn/30 bg-mm-surface-solid px-4 py-2 text-xs text-mm-warn transition-colors hover:bg-mm-warn/10"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-black/[0.06] bg-mm-surface-solid px-4 py-2 text-xs text-mm-accent transition-colors hover:bg-mm-accent/[0.06]"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Posit is thinking">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-mm-accent/60 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-mm-accent/60 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-mm-accent/60" />
    </div>
  );
}
