import type { ReactNode } from "react";
import { LeftNav } from "./LeftNav";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  onShowCheatsheet: () => void;
  children: ReactNode;
}

/**
 * Top-level chrome for the authenticated app.
 *
 * Three regions:
 *  - Left: collapsible `<LeftNav/>` (brand, modes, palette/chat/onboarding,
 *    user menu pinned at the bottom). Account + Admin are reachable via the
 *    user menu — they route through the mode system so the user navigates
 *    away by clicking another mode (no "✕ close" button needed).
 *  - Main: `<TopBar/>` (mode + focus breadcrumb) + page slot.
 *  - Bottom: 24px `<StatusBar/>` with WS state, last-tick freshness,
 *    Posit Control toggle, palette + cheatsheet hints.
 */
export function AppShell({ onShowCheatsheet, children }: AppShellProps) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-mm-bg">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftNav />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="flex min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
      <StatusBar onShowCheatsheet={onShowCheatsheet} />
    </div>
  );
}
