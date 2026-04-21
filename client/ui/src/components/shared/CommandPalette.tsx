import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useCommandPalette } from "../../providers/CommandPaletteProvider";
import { useMode, type ModeId } from "../../providers/ModeProvider";
import { useChat } from "../../providers/ChatProvider";
import { useOnboarding } from "../../providers/OnboardingProvider";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { useFocus } from "../../providers/FocusProvider";
import { fetchBlocks } from "../../services/blockApi";
import { listStreams } from "../../services/streamApi";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import type { BlockRow, RegisteredStream } from "../../types";
import { blockKeyOf } from "../../utils";

interface Command {
  id: string;
  title: string;
  hint?: string;
  group: "navigate" | "action" | "cell" | "stream" | "block";
  run: () => void;
}

const PALETTE_RESULTS_LIMIT = 80;

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
  const { setFocus } = useFocus();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [streams, setStreams] = useState<RegisteredStream[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcut("k", togglePalette);
  useKeyboardShortcut("Escape", () => open && closePalette(), { mod: false });

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
      // Hydrate streams + blocks lazily on open so search includes them.
      fetchBlocks().then(setBlocks).catch(() => { /* ignore */ });
      listStreams().then(setStreams).catch(() => { /* ignore */ });
    }
  }, [open]);

  const baseCommands = useMemo<Command[]>(() => {
    const goMode = (mode: ModeId, sub?: string) => () => {
      setMode(mode, sub);
      closePalette();
    };
    return [
      { id: "go-workbench", group: "navigate", title: "Open Workbench", hint: "positions + inspector + chat", run: goMode("workbench") },
      { id: "go-anatomy", group: "navigate", title: "Open Anatomy", hint: "pipeline canvas", run: goMode("anatomy") },
      { id: "go-docs", group: "navigate", title: "Open API Docs", run: goMode("docs") },
      {
        id: "toggle-chat",
        group: "action",
        title: "Toggle Posit Chat",
        hint: "⌘/",
        run: () => { toggleDrawer(); closePalette(); },
      },
      {
        id: "open-onboarding",
        group: "action",
        title: "Replay onboarding tour",
        run: () => { openOnboarding(); closePalette(); },
      },
    ];
  }, [setMode, closePalette, toggleDrawer, openOnboarding]);

  const cellCommands = useMemo<Command[]>(() => {
    if (!payload) return [];
    return payload.positions.map((p) => ({
      id: `cell-${p.symbol}-${p.expiry}`,
      group: "cell" as const,
      title: `${p.symbol} ${p.expiry}`,
      hint: `pos ${p.desiredPos > 0 ? "+" : ""}${p.desiredPos.toFixed(2)} $vega`,
      run: () => {
        setMode("workbench");
        setFocus({ kind: "cell", symbol: p.symbol, expiry: p.expiry });
        closePalette();
      },
    }));
  }, [payload, setMode, setFocus, closePalette]);

  const streamCommands = useMemo<Command[]>(() => {
    return streams.map((s) => ({
      id: `stream-${s.stream_name}`,
      group: "stream" as const,
      title: s.stream_name,
      hint: `${s.status.toLowerCase()} · ${s.key_cols.join(",")}`,
      run: () => {
        setMode("workbench");
        setFocus({ kind: "stream", name: s.stream_name });
        closePalette();
      },
    }));
  }, [streams, setMode, setFocus, closePalette]);

  const blockCommands = useMemo<Command[]>(() => {
    return blocks.map((b) => ({
      id: `block-${b.block_name}`,
      group: "block" as const,
      title: b.block_name,
      hint: `${b.symbol} · ${b.expiry} · ${b.source}`,
      run: () => {
        setMode("workbench");
        setFocus({ kind: "block", key: blockKeyOf(b) });
        closePalette();
      },
    }));
  }, [blocks, setMode, setFocus, closePalette]);

  const filtered = useMemo(() => {
    const all = [...baseCommands, ...cellCommands, ...streamCommands, ...blockCommands];
    const q = query.trim().toLowerCase();
    const matched = !q
      ? all
      : all.filter(
          (c) => c.title.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q),
        );
    return matched.slice(0, PALETTE_RESULTS_LIMIT);
  }, [baseCommands, cellCommands, streamCommands, blockCommands, query]);

  // Reset highlight when filter changes
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed inset-0 z-[100] bg-black/20"
            onClick={closePalette}
            aria-hidden
          />
          <motion.div
            key="palette"
            initial={{ opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 top-[15vh] z-[101] mx-auto w-[560px] max-w-[90vw] overflow-hidden rounded-lg border border-white/50 bg-white/80 shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.06] backdrop-blur-glass32"
          >
        <div className="border-b border-black/[0.06] px-3 py-2">
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
            className="w-full bg-transparent text-sm text-mm-text placeholder:text-mm-text-subtle focus:outline-none"
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
                  ? "bg-mm-accent/10 text-mm-accent"
                  : "text-mm-text hover:bg-black/[0.04]"
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[8px] uppercase text-mm-text-dim">
                  {cmd.group}
                </span>
                <span className="font-medium">{cmd.title}</span>
              </span>
              {cmd.hint && (
                <span className="shrink-0 text-[10px] text-mm-text-subtle">{cmd.hint}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[9px] text-mm-text-dim">
          <span>↑↓ to move · ↵ to select · esc to close</span>
          <span>⌘K</span>
        </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
