import type { ReactNode } from "react";

interface Props {
  /** Uppercase label rendered at the top-centre of the card. */
  title?: string;
  /** Optional top-overlapping badge (e.g. "BLACK BOX") that sits on the border. */
  badge?: string;
  /** Dashed border instead of solid — used for the APT Pipeline black-box wrapper. */
  dashed?: boolean;
  /** Emphasised border + tinted background, used for input/output bracket cards. */
  emphasis?: boolean;
  /** Optional click handler — turns the card into a button with hover styling. */
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Coloured, rounded box used as a node in the Pipeline flowchart.
 *
 * Visually mirrors the `SectionCard` primitive in the pitch-deck
 * `PositionManagementSlide`, adapted to the terminal's `mm-*` palette. Named
 * `FlowSectionCard` to avoid colliding with the Stream Canvas's unrelated
 * `SectionCard` primitive at `client/ui/src/components/studio/sections/SectionCard.tsx`.
 */
export function FlowSectionCard({
  title,
  badge,
  dashed = false,
  emphasis = false,
  onClick,
  className = "",
  children,
}: Props) {
  const borderClass = dashed
    ? "border-2 border-dashed border-mm-accent/30"
    : emphasis
      ? "border border-mm-accent/40"
      : "border border-mm-border/60";
  const bgClass = emphasis ? "bg-mm-accent/10" : "bg-mm-bg/40";
  const interactive = onClick
    ? "cursor-pointer transition-colors hover:border-mm-accent/60 hover:bg-mm-accent/15"
    : "";

  const content = (
    <div
      className={`relative flex w-full flex-col gap-2 rounded-xl p-4 ${borderClass} ${bgClass} ${interactive} ${className}`}
    >
      {badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-mm-accent/40 bg-mm-surface px-3 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-mm-accent">
          {badge}
        </span>
      )}
      {title && (
        <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-mm-accent">
          {title}
        </span>
      )}
      {children}
    </div>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="w-full text-left">
        {content}
      </button>
    );
  }
  return content;
}
