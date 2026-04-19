import type { ReactNode } from "react";
import type { SectionStatus } from "../canvasState";

interface SectionCardProps {
  title: string;
  number: number;
  status: SectionStatus;
  message?: string;
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

export function SectionCard({
  title,
  number,
  status,
  message,
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

      <div className="border-t border-black/[0.04] px-4 pb-4 pt-3">
        {message && status !== "valid" && (
          <p className="mb-2 text-[10px] text-mm-warn">{message}</p>
        )}
        {children}
      </div>
    </section>
  );
}
