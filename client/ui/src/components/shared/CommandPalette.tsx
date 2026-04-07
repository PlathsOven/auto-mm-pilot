import { useEffect, useMemo, useRef, useState } from "react";
import { useCommandPalette } from "../../providers/CommandPaletteProvider";
import { useMode, type ModeId } from "../../providers/ModeProvider";
import { useChat } from "../../providers/ChatProvider";
import { useOnboarding } from "../../providers/OnboardingProvider";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { useSelection } from "../../providers/SelectionProvider";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";

interface Command {
  id: string;
  title: string;
  hint?: string;
  group: "navigate" | "action" | "cell";
  run: () => void;
}

/**
 * Cmd+K command palette.
 *
 * Mode-aware: includes navigate-to-mode commands plus dynamic cell commands
 * when WS positions exist (so the architect can jump to "btc 27mar26"
 * directly). Also exposes onboarding and chat actions.
 */
export function CommandPalette() {
  const { open, closePalette, togglePalette } = useCommandPalette();
  const { setMode } = useMode();
  const { toggleDrawer } = useChat();
  const { openOnboarding } = useOnboarding();
  const { payload } = useWebSocket();
  const { selectDimension } = useSelection();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcut("k", togglePalette);
  useKeyboardShortcut("Escape", () => open && closePalette(), { mod: false });

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Focus next tick after the modal mounts
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const baseCommands = useMemo<Command[]>(() => {
    const goMode = (mode: ModeId, sub?: string) => () => {
      setMode(mode, sub);
      closePalette();
    };
    return [
      { id: "go-floor", group: "navigate", title: "Go to Floor", hint: "operator dashboard", run: goMode("floor") },
      { id: "go-studio-anatomy", group: "navigate", title: "Open Studio: Anatomy", hint: "pipeline canvas", run: goMode("studio", "anatomy") },
      { id: "go-studio-brain", group: "navigate", title: "Open Studio: Brain", hint: "decomposition + block inspector", run: goMode("studio", "brain") },
      { id: "go-docs", group: "navigate", title: "Open API Docs", run: goMode("docs") },
      {
        id: "toggle-chat",
        group: "action",
        title: "Toggle APT Chat",
        hint: "⌘\\",
        run: () => { toggleDrawer(); closePalette(); },
      },
      {
        id: "open-onboarding",
        group: "action",
        title: "Replay onboarding tour",
        run: () => { openOnboarding(); closePalette(); },
      },
      {
        id: "explain-apt",
        group: "action",
        title: "Explain APT",
        hint: "60-second framework primer",
        run: () => { openOnboarding(); closePalette(); },
      },
    ];
  }, [setMode, closePalette, toggleDrawer, openOnboarding]);

  const cellCommands = useMemo<Command[]>(() => {
    if (!payload) return [];
    return payload.positions.slice(0, 50).map((p) => ({
      id: `cell-${p.asset}-${p.expiry}`,
      group: "cell" as const,
      title: `${p.asset} ${p.expiry}`,
      hint: `pos ${p.desiredPos > 0 ? "+" : ""}${p.desiredPos.toFixed(2)} $vega`,
      run: () => {
        setMode("floor");
        selectDimension(p.asset, p.expiry);
        closePalette();
      },
    }));
  }, [payload, setMode, selectDimension, closePalette]);

  const filtered = useMemo(() => {
    const all = [...baseCommands, ...cellCommands];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) => c.title.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q),
    );
  }, [baseCommands, cellCommands, query]);

  // Reset highlight when filter changes
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/40" onClick={closePalette} aria-hidden />
      <div className="fixed inset-x-0 top-[15vh] z-[101] mx-auto w-[560px] max-w-[90vw] overflow-hidden rounded-xl border border-mm-border/60 bg-mm-surface shadow-2xl shadow-black/50">
        <div className="border-b border-mm-border/40 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                filtered[activeIdx]?.run();
              }
            }}
            placeholder="Type a command, mode, or symbol…"
            className="w-full bg-transparent text-sm text-mm-text placeholder:text-mm-text-dim focus:outline-none"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[11px] text-mm-text-dim">
              No commands match.
            </p>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={cmd.run}
              className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                i === activeIdx
                  ? "bg-mm-accent/15 text-mm-accent"
                  : "text-mm-text hover:bg-mm-border/30"
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="rounded bg-mm-bg/60 px-1.5 py-0.5 text-[8px] uppercase text-mm-text-dim">
                  {cmd.group}
                </span>
                <span className="font-medium">{cmd.title}</span>
              </span>
              {cmd.hint && (
                <span className="shrink-0 text-[10px] text-mm-text-dim">{cmd.hint}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-mm-border/40 bg-mm-bg/40 px-3 py-1.5 text-[9px] text-mm-text-dim">
          <span>↑↓ to move · ↵ to select · esc to close</span>
          <span>⌘K</span>
        </div>
      </div>
    </>
  );
}
