import type { ReactNode } from "react";
import type { SectionStatus } from "../canvasState";

interface SectionCardProps {
  title: string;
  number: number;
  status: SectionStatus;
  message?: string;
  /** When false, the card shows only its header (collapsed). The body is
   *  controlled by the parent via the walkthrough index — individual
   *  cards are no longer independently collapsible. */
  expanded?: boolean;
  /** Optional footer rendered inside the expanded body — used by the
   *  walkthrough to host Back/Next navigation. */
  nav?: ReactNode;
  children: ReactNode;
}

const STATUS_DOT: Record<SectionStatus, string> = {
  empty: "bg-mm-border",
  draft: "bg-mm-warn",
  valid: "bg-mm-accent",
};

const STATUS_LABEL: Record<SectionStatus, string> = {
  empty: "Empty",
  draft: "Draft",
  valid: "Valid",
};

/**
 * Shared chrome for every Stream Canvas section.
 *
 * Renders the section title, status dot, and validation message. Whether
 * the body is visible is driven by the parent (`expanded`) so the canvas
 * can run a single-card-at-a-time walkthrough with Back/Next navigation.
 */
export function SectionCard({
  title,
  number,
  status,
  message,
  expanded = true,
  nav,
  children,
}: SectionCardProps) {
  return (
    <section className="rounded-xl border border-black/[0.08] bg-black/[0.03]">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mm-bg-deep text-[10px] font-semibold text-mm-accent">
            {number}
          </span>
          <h3 className="truncate text-sm font-semibold text-mm-text">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
          <span className="text-[10px] uppercase tracking-wider text-mm-text-dim">
            {STATUS_LABEL[status]}
          </span>
        </div>
      </header>

      {expanded && (
        <div className="border-t border-black/[0.04] px-4 pb-4 pt-3">
          {message && status !== "valid" && (
            <p className="mb-2 text-[10px] text-mm-warn">{message}</p>
          )}
          {children}
          {nav && <div className="mt-4 border-t border-black/[0.04] pt-3">{nav}</div>}
        </div>
      )}
    </section>
  );
}
