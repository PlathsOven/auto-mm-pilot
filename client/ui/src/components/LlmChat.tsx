import { useEffect, useRef, useState } from "react";
import { useChat } from "../providers/ChatProvider";
import { formatUtcTime } from "../utils";

function senderInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function investigationLabel(ctx: NonNullable<ReturnType<typeof useChat>["investigation"]>): string {
  if (ctx.type === "update") {
    return `${ctx.card.asset} ${ctx.card.expiry} — ${ctx.card.oldPos > 0 ? "+" : ""}${ctx.card.oldPos.toFixed(2)} → ${ctx.card.newPos > 0 ? "+" : ""}${ctx.card.newPos.toFixed(2)} $vega`;
  }
  return `${ctx.asset} ${ctx.expiry} — Edge ${ctx.position.edge.toFixed(4)} vp, Desired ${ctx.position.desiredPos > 0 ? "+" : ""}${ctx.position.desiredPos.toFixed(2)} $vega`;
}

export function LlmChat() {
  const { messages, investigation, noteThread, sendMessage, clearInvestigation, closeNoteThread, addNote } = useChat();
  const [input, setInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
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

  function handleNoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = noteInput.trim();
    if (!text) return;
    addNote(text);
    setNoteInput("");
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-mm-border/40 pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">Team Chat</h2>
          <span className="text-[9px] text-mm-text-dim">Tag @APT to query the engine</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            Chat with your team or tag <span className="font-semibold text-mm-accent">@APT</span> to investigate positions.
          </p>
        )}

        {messages.map((msg) => {
          const isCurrentUser = msg.role === "user";
          const isApt = msg.role === "assistant";
          const isTeam = msg.role === "team";

          return (
            <div
              key={msg.id}
              className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                isApt
                  ? "border-l-2 border-mm-accent/50 bg-mm-accent/5"
                  : isCurrentUser
                    ? "bg-mm-bg/60"
                    : "bg-mm-bg/30"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className={`flex h-4 w-4 items-center justify-center text-[7px] font-bold ${
                    isApt
                      ? "rounded-full bg-mm-accent/30 text-mm-accent"
                      : isCurrentUser
                        ? "rounded-full bg-mm-accent/20 text-mm-accent"
                        : "rounded-full bg-mm-text-dim/20 text-mm-text-dim"
                  }`}
                >
                  {isApt ? "AI" : senderInitials(msg.sender)}
                </span>
                <span
                  className={`text-[10px] font-semibold ${
                    isApt ? "text-mm-accent" : isCurrentUser ? "text-mm-text" : "text-mm-text-dim"
                  }`}
                >
                  {isApt ? "APT" : msg.sender}
                  {isCurrentUser && " (you)"}
                </span>
                {isTeam && (
                  <span className="text-[8px] text-mm-text-dim">• team</span>
                )}
              </div>
              <span className={isApt ? "text-mm-text" : "text-mm-text-dim"}>
                {msg.content}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Note thread section */}
      {noteThread && (
        <div className="mt-2 overflow-hidden rounded-lg border border-mm-border/40 bg-mm-bg">
          <div className="flex items-center justify-between border-b border-mm-border/40 px-3 py-1.5">
            <span className="text-[10px] font-semibold text-mm-accent">
              {noteThread.cellKey.replace("-", " — ")} Notes
            </span>
            <button onClick={closeNoteThread} className="text-[10px] text-mm-text-dim hover:text-mm-text">✕</button>
          </div>
          <div className="max-h-32 overflow-y-auto">
            {noteThread.notes.length === 0 && (
              <p className="px-3 py-2 text-center text-[10px] text-mm-text-dim">No notes yet.</p>
            )}
            {noteThread.notes.map((note) => (
              <div key={note.id} className="border-b border-mm-border/20 px-3 py-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-mm-accent/20 text-[7px] font-bold text-mm-accent">{note.authorInitials}</span>
                    <span className="text-[10px] font-medium text-mm-text">{note.author}</span>
                  </div>
                  <span className="text-[9px] text-mm-text-dim">{formatUtcTime(note.timestamp)}</span>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-mm-text-dim">{note.content}</p>
              </div>
            ))}
          </div>
          <form onSubmit={handleNoteSubmit} className="flex gap-1 border-t border-mm-border/40 p-1.5">
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Add a note..."
              className="flex-1 rounded-md border border-mm-border/40 bg-mm-surface px-2 py-1 text-[10px] text-mm-text outline-none placeholder:text-mm-text-dim transition-colors focus:border-mm-accent/60 focus:ring-1 focus:ring-mm-accent/20"
            />
            <button type="submit" className="rounded-md border border-mm-border/40 bg-mm-surface px-2 py-1 text-[10px] text-mm-accent transition-colors hover:bg-mm-accent/10">Post</button>
          </form>
        </div>
      )}

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
          placeholder={investigation ? "Ask about this context..." : "Message team or type @APT to ask the engine..."}
          className="flex-1 rounded-lg border border-mm-border/40 bg-mm-bg px-3 py-2 text-xs text-mm-text outline-none placeholder:text-mm-text-dim transition-colors focus:border-mm-accent/60 focus:ring-1 focus:ring-mm-accent/20"
        />
        <button
          type="submit"
          className="rounded-lg border border-mm-border/40 bg-mm-surface px-4 py-2 text-xs text-mm-accent transition-colors hover:bg-mm-accent/10"
        >
          Send
        </button>
      </form>
    </div>
  );
}
