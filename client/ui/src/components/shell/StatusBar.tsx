import { useEffect, useState } from "react";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { useCommandPalette } from "../../providers/CommandPaletteProvider";
import { formatUtcTime } from "../../utils";
import { POSIT_CONTROL_KEY, STATUSBAR_HEIGHT_PX, STATUSBAR_TICK_MS } from "../../constants";

interface StatusBarProps {
  onShowCheatsheet: () => void;
  onToggleNotifications: () => void;
}

/**
 * Bottom status bar — single row of system state.
 *
 * Replaces the indicators that used to be crammed into the old
 * `GlobalContextBar`: WS connection dot, last-tick freshness, the Posit
 * Control automation toggle, the UTC clock, and a `?` hint to the keyboard
 * cheatsheet. Fixed-height so the main content area can size against it.
 *
 * The Posit Control toggle persists via localStorage. Today it is purely
 * advisory — the server doesn't yet honour it — so the indicator just tells
 * the trader whether the automation lever is "armed". The persistence + UI
 * surface lands now so the eventual server hook can read from a stable
 * place.
 */
export function StatusBar({ onShowCheatsheet, onToggleNotifications }: StatusBarProps) {
  const { connectionStatus, payload } = useWebSocket();
  const { openPalette } = useCommandPalette();
  const [now, setNow] = useState(Date.now());
  const notificationCount = payload?.unregisteredPushes?.length ?? 0;
  const [positEnabled, setPositEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(POSIT_CONTROL_KEY) !== "false"; } catch { return true; }
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STATUSBAR_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const lastUpdate = payload?.context?.lastUpdateTimestamp ?? 0;
  const elapsedMs = lastUpdate > 0 ? now - lastUpdate : null;

  const togglePosit = () => {
    setPositEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(POSIT_CONTROL_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <footer
      className="glass-bar relative z-10 flex shrink-0 items-center gap-3 border-t px-3 text-[10px] text-mm-text-dim"
      style={{ height: STATUSBAR_HEIGHT_PX }}
    >
      <ConnectionPill status={connectionStatus} />

      <Divider />

      <span className="flex items-baseline gap-1">
        <span className="text-mm-text-subtle">tick</span>
        <span className="font-mono tabular-nums text-mm-text">
          {elapsedMs == null ? "—" : `+${elapsedMs}ms`}
        </span>
      </span>

      <Divider />

      <button
        type="button"
        onClick={togglePosit}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04]"
        title={positEnabled ? "Posit automation is armed (advisory only today)" : "Posit automation is paused"}
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${positEnabled ? "bg-mm-accent" : "bg-mm-text-subtle"}`}
        />
        <span className="text-mm-text-subtle">control</span>
        <span className={`font-semibold tracking-wider ${positEnabled ? "text-mm-accent" : "text-mm-text-dim"}`}>
          {positEnabled ? "ARMED" : "PAUSED"}
        </span>
      </button>

      <span className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleNotifications}
          className={`relative rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04] hover:text-mm-text ${
            notificationCount > 0 ? "text-mm-warn" : ""
          }`}
          title={
            notificationCount > 0
              ? `${notificationCount} pending notification${notificationCount === 1 ? "" : "s"}`
              : "Notifications"
          }
        >
          ⚑
          {notificationCount > 0 && (
            <span className="ml-1 rounded-full bg-mm-warn/20 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums">
              {notificationCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={openPalette}
          className="rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          title="Command palette"
        >
          ⌘K
        </button>
        <button
          type="button"
          onClick={onShowCheatsheet}
          className="rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          title="Keyboard shortcuts"
        >
          ?
        </button>
        <Divider />
        <span className="flex items-baseline gap-1">
          <span className="text-mm-text-subtle">UTC</span>
          <span className="font-mono tabular-nums text-mm-text">{formatUtcTime(now).slice(0, 8)}</span>
        </span>
      </span>
    </footer>
  );
}

function ConnectionPill({ status }: { status: "CONNECTED" | "CONNECTING" | "DISCONNECTED" }) {
  const dot =
    status === "CONNECTED" ? "bg-mm-accent"
    : status === "CONNECTING" ? "bg-mm-warn animate-pulse"
    : "bg-mm-error";
  const label =
    status === "CONNECTED" ? "live"
    : status === "CONNECTING" ? "connecting"
    : "offline";
  return (
    <span className="flex items-center gap-1.5" title={`WebSocket: ${status}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="text-mm-text-subtle">ws</span>
      <span className="text-mm-text">{label}</span>
    </span>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-black/[0.08]" />;
}
