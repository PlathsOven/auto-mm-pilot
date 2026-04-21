import type { ReactNode } from "react";

/**
 * Reusable sidebar shell.
 *
 * Provides the chrome (border, glass, width) for a vertical sidebar that can
 * collapse to an icon-only strip. Caller owns the inner content — this is
 * pure layout, not nav. Phase 2 uses it for the global LeftNav; the
 * existing `WorkbenchRail` and Anatomy `StreamSidebar` keep their bespoke
 * shells until a Phase 3 refactor.
 *
 * Width semantics:
 *  - `expanded` — full width (default 220px), shown when `collapsed=false`.
 *  - `collapsed` — icon strip width (default 56px), shown when `collapsed=true`.
 *
 * The sidebar handles its own width transition; the toggle button + persistence
 * are the caller's responsibility (different sidebars want different keys).
 */

interface SidebarProps {
  side: "left" | "right";
  collapsed: boolean;
  expandedWidthPx?: number;
  collapsedWidthPx?: number;
  children: ReactNode;
  /** Optional className override for the outer container. */
  className?: string;
}

export function Sidebar({
  side,
  collapsed,
  expandedWidthPx = 220,
  collapsedWidthPx = 56,
  children,
  className = "",
}: SidebarProps) {
  const width = collapsed ? collapsedWidthPx : expandedWidthPx;
  const borderClass = side === "left" ? "border-r" : "border-l";

  return (
    <aside
      className={`flex shrink-0 flex-col overflow-hidden ${borderClass} border-black/[0.06] bg-white/65 backdrop-blur-glass28 ${className}`}
      style={{
        width,
        transition: "width 240ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {children}
    </aside>
  );
}
