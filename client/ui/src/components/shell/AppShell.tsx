import type { ReactNode } from "react";
import { LeftNav } from "./LeftNav";
import { StatusBar } from "./StatusBar";

interface AppShellProps {
  onOpenAccount: () => void;
  onOpenAdmin: () => void;
  onShowCheatsheet: () => void;
  children: ReactNode;
}

/**
 * Top-level chrome for the authenticated app.
 *
 * Three regions:
 *  - Left: collapsible `<LeftNav/>` (brand, modes, palette/chat/onboarding,
 *    user menu pinned at the bottom).
 *  - Main: scrolling content slot — caller mounts the active page or an
 *    overlay (Account, Admin) here.
 *  - Bottom: 24px `<StatusBar/>` with WS state, last-tick freshness,
 *    Posit Control toggle, palette + cheatsheet hints.
 *
 * Replaces the old `GlobalContextBar` top header. Industry-standard layout
 * (sidebar + main + status bar) instead of the previous all-in-one top
 * strip — frees vertical space and spreads logic across surfaces that read
 * naturally.
 */
export function AppShell({
  onOpenAccount,
  onOpenAdmin,
  onShowCheatsheet,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-mm-bg">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftNav onOpenAccount={onOpenAccount} onOpenAdmin={onOpenAdmin} />
        <main className="flex min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <StatusBar onShowCheatsheet={onShowCheatsheet} />
    </div>
  );
}
