import type { ReactNode } from "react";
import { LeftNav } from "./LeftNav";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { ChatDock } from "../workbench/ChatDock";
import { NotificationsCenter } from "../notifications/NotificationsCenter";
import { useNotifications } from "../../providers/NotificationsProvider";

interface AppShellProps {
  onShowCheatsheet: () => void;
  children: ReactNode;
}

/**
 * Top-level chrome for the authenticated app.
 *
 * Three regions:
 *  - Left: collapsible `<LeftNav/>` (brand, modes, palette/chat/notifications/
 *    onboarding, user menu pinned at the bottom). Account + Admin are
 *    reachable via the user menu.
 *  - Main: `<TopBar/>` (mode + focus breadcrumb) + page slot.
 *  - Bottom: 24px `<StatusBar/>` — WS state, last-tick freshness, Posit
 *    Control toggle, ambient notifications badge, palette + cheatsheet hints.
 *
 * Notifications state is owned by `<NotificationsProvider/>` (mounted in
 * `main.tsx`) so the LeftNav tab, the StatusBar badge, and the slide-over
 * panel all stay in sync.
 */
export function AppShell({ onShowCheatsheet, children }: AppShellProps) {
  const { open, closePanel } = useNotifications();
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-mm-bg">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftNav />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="flex min-h-0 flex-1 overflow-hidden">{children}</main>
          <ChatDock />
        </div>
      </div>
      <StatusBar onShowCheatsheet={onShowCheatsheet} />
      <NotificationsCenter open={open} onClose={closePanel} />
    </div>
  );
}
