import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { useChat } from "../providers/ChatProvider";
import { Tabs, type TabItem } from "./ui/Tabs";
import type { ChatMode } from "../types";
import { CHAT_INPUT_MAX_HEIGHT_PX } from "../constants";

const MODE_LABELS: Record<ChatMode, string> = {
  investigate: "Investigate",
  build: "Build",
  general: "General",
};

const HISTORY_KEY = "posit-chat-history";
const HISTORY_MAX = 50;

interface SlashCommand {
  name: string;
  description: string;
  /** Returns true if the input was consumed (don't send to LLM). */
  run: (args: string, ctx: SlashCtx) => boolean;
}

interface SlashCtx {
  setChatMode: (mode: ChatMode) => void;
  clearMessages: () => void;
  pushSystemMessage: (text: string) => void;
  lastAssistantContent: string | null;
}

const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "/clear",
    description: "Clear all messages in the conversation",
    run: (_args, { clearMessages, pushSystemMessage }) => {
      clearMessages();
      // Push the help nudge after clear so the user sees they can /help.
      pushSystemMessage("Conversation cleared. Type /help for commands.");
      return true;
    },
  },
  {
    name: "/explain",
    description: "Switch to Investigate mode",
    run: (_args, { setChatMode, pushSystemMessage }) => {
      setChatMode("investigate");
      pushSystemMessage("Mode → Investigate");
      return true;
    },
  },
  {
    name: "/build",
    description: "Switch to Build mode (stream / opinion creation)",
    run: (_args, { setChatMode, pushSystemMessage }) => {
      setChatMode("build");
      pushSystemMessage("Mode → Build");
      return true;
    },
  },
  {
    name: "/general",
    description: "Switch to General mode (catch-all chat)",
    run: (_args, { setChatMode, pushSystemMessage }) => {
      setChatMode("general");
      pushSystemMessage("Mode → General");
      return true;
    },
  },
  {
    name: "/copy",
    description: "Copy the last assistant response to the clipboard",
    run: (_args, { lastAssistantContent, pushSystemMessage }) => {
      if (!lastAssistantContent) {
        pushSystemMessage("No assistant message to copy.");
        return true;
      }
      navigator.clipboard
        .writeText(lastAssistantContent)
        .then(() => pushSystemMessage("Copied last response to clipboard."))
        .catch(() => pushSystemMessage("Copy failed — clipboard permission denied."));
      return true;
    },
  },
  {
    name: "/help",
    description: "List available slash commands",
    run: (_args, { pushSystemMessage }) => {
      const lines = ["Slash commands:"];
      for (const c of SLASH_COMMANDS) lines.push(`  ${c.name} — ${c.description}`);
      lines.push("History: ↑ / ↓ to walk through previous prompts. Enter to send · Shift+Enter for newline.");
      pushSystemMessage(lines.join("\n"));
      return true;
    },
  },
];

function investigationLabel(ctx: NonNullable<ReturnType<typeof useChat>["investigation"]>): string {
  if (ctx.type === "update") {
    return `${ctx.card.symbol} ${ctx.card.expiry} — ${ctx.card.oldPos > 0 ? "+" : ""}${ctx.card.oldPos.toFixed(2)} → ${ctx.card.newPos > 0 ? "+" : ""}${ctx.card.newPos.toFixed(2)} $vega`;
  }
  return `${ctx.symbol} ${ctx.expiry} — Edge ${ctx.position.edge.toFixed(4)} vp, Desired ${ctx.position.desiredPos > 0 ? "+" : ""}${ctx.position.desiredPos.toFixed(2)} $vega`;
}

function loadHistory(): string[] {
  try {
    const v = localStorage.getItem(HISTORY_KEY);
    if (!v) return [];
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function persistHistory(history: string[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_MAX))); } catch { /* ignore */ }
}

export function LlmChat() {
  const {
    messages, investigation, isStreaming, sendMessage, clearInvestigation,
    cancelStream, chatMode, setChatMode, pushSystemMessage, clearMessages,
  } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Command history (persisted across reloads). historyIdx === null means
  // "live input" (the user's freshly-typed text); a numeric idx points into
  // the history array.
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const liveInputRef = useRef<string>("");

  const modeTabs = useMemo<TabItem<ChatMode>[]>(
    () => (Object.keys(MODE_LABELS) as ChatMode[]).map((m) => ({
      value: m,
      label: MODE_LABELS[m],
      disabled: isStreaming,
    })),
    [isStreaming],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  function pushHistory(entry: string) {
    setHistory((prev) => {
      // Drop consecutive duplicates.
      const next = prev[prev.length - 1] === entry ? prev : [...prev, entry];
      const trimmed = next.slice(-HISTORY_MAX);
      persistHistory(trimmed);
      return trimmed;
    });
  }

  function tryRunSlash(text: string): boolean {
    if (!text.startsWith("/")) return false;
    const [name, ...rest] = text.split(/\s+/);
    const cmd = SLASH_COMMANDS.find((c) => c.name === name);
    if (!cmd) return false;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    cmd.run(rest.join(" "), {
      setChatMode,
      clearMessages,
      pushSystemMessage,
      lastAssistantContent: lastAssistant?.content ?? null,
    });
    return true;
  }

  function submit() {
    const text = input.trim();
    if (!text) return;

    pushHistory(text);
    setHistoryIdx(null);
    liveInputRef.current = "";

    if (tryRunSlash(text)) {
      setInput("");
      return;
    }

    const prefix = investigation ? `[Context: ${investigationLabel(investigation)}]\n` : "";
    sendMessage(prefix + text);
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function navigateHistory(direction: 1 | -1) {
    if (history.length === 0) return;
    const isFirstStep = historyIdx === null;
    if (isFirstStep) liveInputRef.current = input;

    let nextIdx: number | null;
    if (isFirstStep) {
      nextIdx = direction === -1 ? history.length - 1 : null;
    } else {
      const candidate = (historyIdx as number) + direction;
      if (candidate < 0) nextIdx = 0;
      else if (candidate >= history.length) nextIdx = null;
      else nextIdx = candidate;
    }

    setHistoryIdx(nextIdx);
    setInput(nextIdx === null ? liveInputRef.current : history[nextIdx]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) submit();
      return;
    }

    // Single-line: ↑/↓ walk history. Multi-line input: leave native behavior.
    const isMultiline = input.includes("\n");
    if (!isMultiline && e.key === "ArrowUp") {
      e.preventDefault();
      navigateHistory(-1);
    } else if (!isMultiline && e.key === "ArrowDown") {
      e.preventDefault();
      navigateHistory(1);
    }
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between border-b border-black/[0.06] pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">Posit Chat</h2>
          <button
            type="button"
            onClick={() => pushSystemMessage(SLASH_COMMANDS.map((c) => `${c.name} — ${c.description}`).join("\n"))}
            className="text-[9px] text-mm-text-subtle hover:text-mm-accent"
            title="Show slash commands"
          >
            /help
          </button>
        </div>
        <Tabs items={modeTabs} value={chatMode} onChange={setChatMode} variant="pill" size="sm" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            Ask <span className="font-semibold text-mm-accent">Posit</span> about positions, edges, or pipeline state.{" "}
            Type <code className="font-mono text-mm-accent">/help</code> for commands. ↑/↓ walks prompt history.
          </p>
        )}

        {messages.map((msg) => {
          if (msg.role === "system") {
            return (
              <div
                key={msg.id}
                className="rounded-md bg-black/[0.02] px-3 py-1.5 font-mono text-[10px] leading-relaxed text-mm-text-subtle whitespace-pre-wrap"
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
                    isPosit ? "bg-mm-accent/10 text-mm-accent" : "bg-mm-accent/10 text-mm-accent"
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

      {investigation && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border-l-2 border-mm-accent bg-mm-accent/[0.04] px-3 py-1.5">
          <span className="flex-1 text-[10px] leading-relaxed text-mm-accent">
            {investigationLabel(investigation)}
          </span>
          <button onClick={clearInvestigation} className="shrink-0 text-[10px] text-mm-text-subtle hover:text-mm-text">✕</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-2 flex items-stretch gap-1.5 rounded-lg border border-black/[0.08] bg-mm-surface-solid focus-within:border-mm-accent/30 focus-within:ring-1 focus-within:ring-mm-accent/15">
        <span className="flex shrink-0 items-start py-2 pl-3 font-mono text-[12px] text-mm-accent" aria-hidden>
          ›
        </span>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Edits invalidate the history walk.
            if (historyIdx !== null) setHistoryIdx(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            input.startsWith("/")
              ? "Slash command…"
              : investigation
                ? "Ask about this context…"
                : "Ask Posit (or type /help)…"
          }
          rows={1}
          className="min-w-0 flex-1 resize-none bg-transparent py-2 pr-2 font-mono text-[12px] leading-relaxed text-mm-text outline-none placeholder:text-mm-text-subtle"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={cancelStream}
            className="shrink-0 rounded-r-lg border-l border-mm-warn/30 bg-mm-warn/5 px-3 text-[11px] font-semibold text-mm-warn transition-colors hover:bg-mm-warn/10"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="shrink-0 rounded-r-lg border-l border-black/[0.06] px-3 text-[11px] font-semibold text-mm-accent transition-colors hover:bg-mm-accent/[0.06]"
          >
            ↵
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
