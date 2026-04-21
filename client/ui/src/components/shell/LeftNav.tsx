import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "../ui/Sidebar";
import { UserMenu } from "../UserMenu";
import { useMode, MODE_LABELS, PRIMARY_MODES, type ModeId } from "../../providers/ModeProvider";
import { useChat } from "../../providers/ChatProvider";
import { useCommandPalette } from "../../providers/CommandPaletteProvider";
import { useNotifications } from "../../providers/NotificationsProvider";
import { useOnboarding } from "../../providers/OnboardingProvider";
import { safeGetItem, safeSetItem } from "../../utils";
import {
  LEFTNAV_COLLAPSED_WIDTH_PX,
  LEFTNAV_EXPANDED_WIDTH_PX,
  LEFTNAV_OPEN_KEY,
} from "../../constants";

interface NavItem {
  mode?: ModeId;
  label: string;
  icon: string;
  /** If non-mode action, an explicit handler to run instead of `setMode`. */
  onClick?: () => void;
  /** Pinned to the bottom (above the user menu). Used for utility actions. */
  pinned?: boolean;
  /** Optional count rendered as a small badge to the right of the label. */
  badge?: number;
}

const PRIMARY_ICONS: Record<ModeId, string> = {
  workbench: "▦",
  anatomy: "✶",
  docs: "❀",
  account: "◐",
  admin: "★",
};

/**
 * Global left-side navigation.
 *
 * Industry-standard pattern: collapsible icon-strip on the left. Hosts the
 * brand at top, a primary mode list (Workbench, Anatomy, Docs), pinned
 * actions (search palette, chat, onboarding), and the user menu pinned at
 * the bottom (which routes to Account / Admin via the mode system).
 *
 * Account + Admin are NOT in the primary nav — they're not workspaces, just
 * destinations. Reaching them goes through the user menu; leaving them is
 * the same gesture as leaving any mode (click another sidebar entry).
 */
export function LeftNav() {
  const { mode, setMode } = useMode();
  const { toggleDrawer } = useChat();
  const { openPalette } = useCommandPalette();
  const { openOnboarding } = useOnboarding();
  const {
    togglePanel: toggleNotifications,
    count: notificationCount,
    open: notificationsOpen,
  } = useNotifications();

  const [collapsed, setCollapsed] = useState<boolean>(
    () => safeGetItem(LEFTNAV_OPEN_KEY) === "false",
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      safeSetItem(LEFTNAV_OPEN_KEY, next ? "false" : "true");
      return next;
    });
  }, []);

  // Listen for external toggle events (Phase 2 doesn't bind a hotkey, but
  // keeping the hook here so a future shortcut can dispatch a StorageEvent).
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== LEFTNAV_OPEN_KEY) return;
      setCollapsed(safeGetItem(LEFTNAV_OPEN_KEY) === "false");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const primary: NavItem[] = PRIMARY_MODES.map((m) => ({
    mode: m,
    label: MODE_LABELS[m],
    icon: PRIMARY_ICONS[m],
  }));

  const pinned: NavItem[] = [
    { label: "Search", icon: "⌘", onClick: openPalette },
    { label: "Chat", icon: "✱", onClick: toggleDrawer },
    {
      label: "Notifications",
      icon: "⚑",
      onClick: toggleNotifications,
      badge: notificationCount,
    },
    { label: "Onboarding", icon: "?", onClick: openOnboarding },
  ];

  return (
    <Sidebar
      side="left"
      collapsed={collapsed}
      expandedWidthPx={LEFTNAV_EXPANDED_WIDTH_PX}
      collapsedWidthPx={LEFTNAV_COLLAPSED_WIDTH_PX}
    >
      {/* Brand + collapse toggle */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/[0.05] px-3 py-2.5">
        {!collapsed && (
          <div className="flex flex-col gap-0">
            <span className="text-[13px] font-bold tracking-wide text-mm-accent">Posit</span>
            <span className="text-[9px] text-mm-text-subtle">positional trading</span>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* Primary nav (modes) */}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {primary.map((item) => (
          <NavButton
            key={item.label}
            item={item}
            collapsed={collapsed}
            active={item.mode != null && item.mode === mode}
            onActivate={() => {
              if (item.onClick) item.onClick();
              else if (item.mode) setMode(item.mode);
            }}
          />
        ))}
      </nav>

      {/* Pinned actions */}
      <div className="flex shrink-0 flex-col gap-0.5 border-t border-black/[0.05] px-2 py-2">
        {pinned.map((item) => (
          <NavButton
            key={item.label}
            item={item}
            collapsed={collapsed}
            active={item.label === "Notifications" && notificationsOpen}
            onActivate={item.onClick ?? (() => {})}
          />
        ))}
      </div>

      {/* User menu pinned at bottom — opens upward, routes Account/Admin via
          the mode system so leaving them is "click any other sidebar entry". */}
      <div className={`flex shrink-0 items-center border-t border-black/[0.05] py-2 ${
        collapsed ? "justify-center px-1" : "px-2"
      }`}>
        <UserMenu
          onOpenAccount={() => setMode("account")}
          onOpenAdmin={() => setMode("admin")}
          placement="top-left"
          compact={collapsed}
          activeMode={mode}
        />
      </div>
    </Sidebar>
  );
}

function NavButton({
  item,
  collapsed,
  active,
  onActivate,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onActivate}
      title={item.label}
      className={`relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
        active
          ? "bg-mm-accent-soft text-mm-accent"
          : "text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
      } ${collapsed ? "justify-center" : ""}`}
    >
      <span aria-hidden className={`text-[13px] leading-none ${active ? "text-mm-accent" : "text-mm-text-subtle"}`}>
        {item.icon}
      </span>
      {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
      {item.badge !== undefined && item.badge > 0 && (
        <span
          className={`${
            collapsed
              ? "absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-mm-warn"
              : "rounded-full bg-mm-warn/20 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-mm-warn"
          }`}
          aria-label={`${item.badge} pending`}
        >
          {collapsed ? "" : item.badge}
        </span>
      )}
    </button>
  );
}
