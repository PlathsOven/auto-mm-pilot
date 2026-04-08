import { useState, type ReactNode } from "react";
import type { SectionStatus } from "../canvasState";

interface SectionCardProps {
  title: string;
  number: number;
  status: SectionStatus;
  message?: string;
  /** Default collapsed state. Top-of-canvas sections start expanded. */
  defaultOpen?: boolean;
  /** Optional rich math disclosure shown via "Show me the math" link. */
  mathDisclosure?: ReactNode;
  /** Whether walk-through focus mode is active and another section has focus. */
  dimmed?: boolean;
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
 * Shared collapsible chrome for every Stream Canvas section.
 *
 * Renders the section title, status dot, validation message, and an optional
 * "Show me the math" disclosure for the underlying transform formula.
 */
export function SectionCard({
  title,
  number,
  status,
  message,
  defaultOpen = true,
  mathDisclosure,
  dimmed = false,
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [mathOpen, setMathOpen] = useState(false);

  return (
    <section
      className={`rounded-xl border bg-mm-bg/40 transition-opacity ${
        dimmed ? "border-mm-border/20 opacity-30" : "border-mm-border/60 opacity-100"
      }`}
    >
      <header
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3"
      >
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
          <span className="text-[10px] text-mm-text-dim">{open ? "▲" : "▼"}</span>
        </div>
      </header>

      {open && (
        <div className="border-t border-mm-border/30 px-4 pb-4 pt-3">
          {message && status !== "valid" && (
            <p className="mb-2 text-[10px] text-mm-warn">{message}</p>
          )}
          {children}
          {mathDisclosure && (
            <div className="mt-3 border-t border-mm-border/30 pt-2">
              <button
                type="button"
                onClick={() => setMathOpen((v) => !v)}
                className="text-[10px] font-medium text-mm-accent transition-colors hover:text-mm-accent/80"
              >
                {mathOpen ? "Hide math" : "Show me the math"}
              </button>
              {mathOpen && (
                <div className="mt-2 rounded-md bg-mm-bg-deep/80 p-2 text-[10px] text-mm-text-dim">
                  {mathDisclosure}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
