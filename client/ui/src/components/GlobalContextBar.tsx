import { useEffect, useState } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { useChat } from "../providers/ChatProvider";
import { useCommandPalette } from "../providers/CommandPaletteProvider";
import { useOnboarding } from "../providers/OnboardingProvider";
import { formatUtcTime } from "../utils";
import { CURRENT_USER } from "../providers/MockDataProvider";
import { useMode } from "../providers/ModeProvider";
import { ModeSwitcher } from "./shared/ModeSwitcher";
import { LiveEquationStrip } from "./equation/LiveEquationStrip";

export function GlobalContextBar() {
  const { connectionStatus } = useWebSocket();
  const { mode, setMode } = useMode();
  const { drawerOpen, toggleDrawer } = useChat();
  const { openPalette } = useCommandPalette();
  const { resetOnboarding } = useOnboarding();
  const [now, setNow] = useState(Date.now());
  const [aptEnabled, setAptEnabled] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 47);
    return () => clearInterval(id);
  }, []);

  const inDocs = mode === "docs";

  return (
    <div className="flex h-[60px] items-center justify-between border-b border-mm-border/40 bg-mm-surface/80 px-6 backdrop-blur-sm">
      {/* Left: brand + connection + canonical equation glyph */}
      <div className="flex items-center gap-3">
        <span className="text-base font-bold tracking-wide text-mm-accent">
          APT
        </span>
        <span className="text-[10px] text-mm-text-dim">
          Automated Positional Trader
        </span>
        <span className="text-[10px] text-mm-text-dim">
          [{connectionStatus}]
        </span>
        <LiveEquationStrip size="xs" />
      </div>

      {/* Middle: mode switcher + per-mode controls */}
      <div className="flex items-center gap-4">
        <ModeSwitcher />

        {/* Cmd+K hint */}
        <button
          onClick={openPalette}
          className="flex items-center gap-1.5 rounded-lg border border-mm-border/40 px-2.5 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
          title="Open command palette"
        >
          <span>Search</span>
          <span className="text-[9px]">⌘K</span>
        </button>

        {/* Chat drawer toggle */}
        <button
          onClick={toggleDrawer}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
            drawerOpen
              ? "bg-mm-accent/15 font-medium text-mm-accent"
              : "text-mm-text-dim hover:bg-mm-border/30 hover:text-mm-text"
          }`}
          title="Toggle APT Chat (⌘\\)"
        >
          <span>Chat</span>
          <span className="text-[9px] text-mm-text-dim">⌘\</span>
        </button>

        {/* Docs toggle */}
        <button
          onClick={() => setMode(inDocs ? "floor" : "docs")}
          className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
            inDocs
              ? "bg-mm-accent/15 font-medium text-mm-accent"
              : "text-mm-text-dim hover:bg-mm-border/30 hover:text-mm-text"
          }`}
        >
          {inDocs ? "← Back" : "API Docs"}
        </button>

        {/* APT Parameter Control Toggle */}
        <div className="flex items-center gap-2 pl-4">
          <span className="text-[10px] text-mm-text-dim">APT Control:</span>
          <button
            onClick={() => setAptEnabled((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              aptEnabled ? "bg-mm-accent" : "bg-mm-border"
            }`}
            title={aptEnabled ? "APT is allowed to move parameters" : "APT parameter moves are paused"}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                aptEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </button>
          <span className={`text-[10px] font-semibold ${aptEnabled ? "text-mm-accent" : "text-mm-error"}`}>
            {aptEnabled ? "LIVE" : "PAUSED"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* System Time (UTC) */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-mm-text-dim">UTC:</span>
          <span className="text-sm tabular-nums text-mm-text">
            {formatUtcTime(now)}
          </span>
        </div>

        {/* Logged-in User */}
        <div className="relative pl-4">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-mm-accent/20 text-[10px] font-bold text-mm-accent">
              {CURRENT_USER.initials}
            </span>
            <div className="flex flex-col text-left">
              <span className="text-[10px] font-medium text-mm-text">{CURRENT_USER.name}</span>
              <span className="text-[9px] text-mm-text-dim">{CURRENT_USER.role}</span>
            </div>
          </button>
          {userMenuOpen && (
            <div
              onMouseLeave={() => setUserMenuOpen(false)}
              className="absolute right-0 top-full z-50 mt-2 min-w-[200px] overflow-hidden rounded-xl border border-mm-border/60 bg-mm-surface py-1 shadow-xl shadow-black/30"
            >
              <button
                onClick={() => {
                  resetOnboarding();
                  setUserMenuOpen(false);
                }}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-mm-text transition-colors hover:bg-mm-accent/10"
              >
                Replay onboarding tour
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
