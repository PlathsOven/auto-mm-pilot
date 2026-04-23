import { useEffect, useRef, useState } from "react";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { useCommandPalette } from "../../providers/CommandPaletteProvider";
import { useNotifications } from "../../providers/NotificationsProvider";
import { useTransforms } from "../../providers/TransformsProvider";
import { formatUtcTime, safeGetItem, safeSetItem } from "../../utils";
import { POSIT_CONTROL_KEY, STATUSBAR_HEIGHT_PX, STATUSBAR_TICK_MS } from "../../constants";
import { BankrollControl } from "./BankrollControl";
import { Tooltip } from "../ui/Tooltip";

interface StatusBarProps {
  onShowCheatsheet: () => void;
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
export function StatusBar({ onShowCheatsheet }: StatusBarProps) {
  const { connectionStatus, payload } = useWebSocket();
  const { openPalette } = useCommandPalette();
  const { togglePanel: toggleNotifications, count: notificationCount } = useNotifications();
  const { bankroll } = useTransforms();
  const [now, setNow] = useState(Date.now());
  const [bankrollOpen, setBankrollOpen] = useState(false);
  const bankrollTriggerRef = useRef<HTMLButtonElement>(null);
  const [positEnabled, setPositEnabled] = useState<boolean>(
    () => safeGetItem(POSIT_CONTROL_KEY) !== "false",
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STATUSBAR_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const lastUpdate = payload?.context?.lastUpdateTimestamp ?? 0;
  const elapsedMs = lastUpdate > 0 ? now - lastUpdate : null;

  const togglePosit = () => {
    setPositEnabled((v) => {
      const next = !v;
      safeSetItem(POSIT_CONTROL_KEY, String(next));
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

      <Tooltip label="Time since the last pipeline tick — the lower, the fresher" side="top">
        <span className="flex items-baseline gap-1" tabIndex={0}>
          <span className="text-mm-text-subtle">tick</span>
          <span className="font-mono tabular-nums text-mm-text">
            {elapsedMs == null ? "—" : `+${elapsedMs}ms`}
          </span>
        </span>
      </Tooltip>

      <Divider />

      <div className="relative flex items-center">
        <Tooltip label="Edit bankroll — the capital Posit sizes positions against" side="top">
          <button
            ref={bankrollTriggerRef}
            type="button"
            onClick={() => setBankrollOpen((v) => !v)}
            aria-label="Edit bankroll"
            className={`flex items-baseline gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04] ${
              bankrollOpen ? "bg-black/[0.04] text-mm-text" : ""
            }`}
          >
            <span className="text-mm-text-subtle">bankroll</span>
            <span className="font-mono tabular-nums text-mm-text">
              {Number.isFinite(bankroll) ? bankroll.toLocaleString() : "—"}
            </span>
          </button>
        </Tooltip>
        <BankrollControl
          open={bankrollOpen}
          onClose={() => setBankrollOpen(false)}
          anchorRef={bankrollTriggerRef}
        />
      </div>

      <Divider />

      <Tooltip
        label={
          positEnabled
            ? "Posit automation is armed (advisory only today) — click to pause"
            : "Posit automation is paused — click to arm"
        }
        side="top"
      >
        <button
          type="button"
          onClick={togglePosit}
          aria-label={positEnabled ? "Pause Posit automation" : "Arm Posit automation"}
          aria-pressed={positEnabled}
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04]"
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${positEnabled ? "bg-mm-accent" : "bg-mm-text-subtle"}`}
          />
          <span className="text-mm-text-subtle">control</span>
          <span className={`font-semibold tracking-wider ${positEnabled ? "text-mm-accent" : "text-mm-text-dim"}`}>
            {positEnabled ? "ARMED" : "PAUSED"}
          </span>
        </button>
      </Tooltip>

      <span className="ml-auto flex items-center gap-3">
        <Tooltip
          label={
            notificationCount > 0
              ? `${notificationCount} pending notification${notificationCount === 1 ? "" : "s"} — click to open`
              : "Open notifications"
          }
          side="top"
        >
          <button
            type="button"
            onClick={toggleNotifications}
            aria-label={
              notificationCount > 0
                ? `${notificationCount} pending notifications`
                : "Open notifications"
            }
            className={`relative rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04] hover:text-mm-text ${
              notificationCount > 0 ? "text-mm-warn" : ""
            }`}
          >
            ⚑
            {notificationCount > 0 && (
              <span className="ml-1 rounded-full bg-mm-warn/20 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums">
                {notificationCount}
              </span>
            )}
          </button>
        </Tooltip>
        <Tooltip label="Open command palette (⌘K)" side="top">
          <button
            type="button"
            onClick={openPalette}
            aria-label="Open command palette"
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          >
            ⌘K
          </button>
        </Tooltip>
        <Tooltip label="Show keyboard shortcuts (?)" side="top">
          <button
            type="button"
            onClick={onShowCheatsheet}
            aria-label="Show keyboard shortcuts"
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          >
            ?
          </button>
        </Tooltip>
        <Divider />
        <Tooltip label="Current server time in UTC" side="top">
          <span className="flex items-baseline gap-1" tabIndex={0}>
            <span className="text-mm-text-subtle">UTC</span>
            <span className="font-mono tabular-nums text-mm-text">{formatUtcTime(now).slice(0, 8)}</span>
          </span>
        </Tooltip>
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
  const explain =
    status === "CONNECTED" ? "WebSocket connected — positions update in real time"
    : status === "CONNECTING" ? "WebSocket is reconnecting — values may be stale"
    : "WebSocket offline — values on screen are frozen from the last connected tick";
  return (
    <Tooltip label={explain} side="top">
      <span
        className="flex items-center gap-1.5"
        tabIndex={0}
        role="status"
        aria-label={`WebSocket ${label}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-mm-text-subtle">ws</span>
        <span className="text-mm-text">{label}</span>
      </span>
    </Tooltip>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-black/[0.08]" />;
}
