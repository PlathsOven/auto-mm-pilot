import { useEffect, useState } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { useChat } from "../providers/ChatProvider";
import { useCommandPalette } from "../providers/CommandPaletteProvider";
import { formatUtcTime } from "../utils";
import { useMode } from "../providers/ModeProvider";
import { ModeSwitcher } from "./shared/ModeSwitcher";
import { UserMenu } from "./UserMenu";
import { GLOBAL_CONTEXT_TICK_MS } from "../constants";

interface GlobalContextBarProps {
  onOpenAccount: () => void;
  onOpenAdmin: () => void;
}

export function GlobalContextBar({ onOpenAccount, onOpenAdmin }: GlobalContextBarProps) {
  const { connectionStatus } = useWebSocket();
  const { mode, setMode } = useMode();
  const { drawerOpen, toggleDrawer } = useChat();
  const { openPalette } = useCommandPalette();
  const [now, setNow] = useState(Date.now());
  const [positEnabled, setPositEnabled] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), GLOBAL_CONTEXT_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const inDocs = mode === "docs";

  return (
    <div className="glass-bar flex h-[56px] items-center justify-between px-6">
      {/* Left: brand + connection dot */}
      <div className="flex items-center gap-3">
        <span className="text-base font-bold tracking-wide text-mm-accent">
          Posit
        </span>
        <span className="text-[10px] text-mm-text-dim">
          a positional trading platform
        </span>
        <span
          className={`h-2 w-2 rounded-full ${
            connectionStatus === "CONNECTED"
              ? "bg-mm-accent"
              : connectionStatus === "CONNECTING"
                ? "bg-mm-warn"
                : "bg-mm-error"
          }`}
          title={connectionStatus}
        />
      </div>

      {/* Centre: mode switcher + controls */}
      <div className="flex items-center gap-4">
        <ModeSwitcher />

        {/* Cmd+K — keyboard-only, small hint */}
        <button
          onClick={openPalette}
          className="flex items-center gap-1.5 rounded-md border border-black/[0.06] px-2.5 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          title="Open command palette"
        >
          <span>Search</span>
          <span className="text-[9px] text-mm-text-subtle">⌘K</span>
        </button>

        {/* Chat drawer toggle */}
        <button
          onClick={toggleDrawer}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
            drawerOpen
              ? "bg-mm-accent/10 font-medium text-mm-accent"
              : "text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
          }`}
          title="Toggle Posit Chat (⌘/)"
        >
          <span>Chat</span>
          <span className="text-[9px] text-mm-text-subtle">⌘/</span>
        </button>

        {/* Docs toggle */}
        <button
          onClick={() => setMode(inDocs ? "eyes" : "docs")}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            inDocs
              ? "bg-mm-accent/10 font-medium text-mm-accent"
              : "text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
          }`}
        >
          {inDocs ? "← Back" : "API Docs"}
        </button>

        {/* Posit Parameter Control Toggle */}
        <div className="flex items-center gap-2 pl-4">
          <span className="text-[10px] text-mm-text-dim">Posit Control:</span>
          <button
            onClick={() => setPositEnabled((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              positEnabled ? "bg-mm-accent" : "bg-black/10"
            }`}
            title={positEnabled ? "Posit is allowed to move parameters" : "Posit parameter moves are paused"}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                positEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </button>
          <span className={`text-[10px] font-semibold ${positEnabled ? "text-mm-accent" : "text-mm-error"}`}>
            {positEnabled ? "LIVE" : "PAUSED"}
          </span>
        </div>
      </div>

      {/* Right: System Time (UTC) + User menu */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-mm-text-dim">UTC</span>
          <span className="text-sm tabular-nums text-mm-text">
            {formatUtcTime(now)}
          </span>
        </div>
        <UserMenu onOpenAccount={onOpenAccount} onOpenAdmin={onOpenAdmin} />
      </div>
    </div>
  );
}
