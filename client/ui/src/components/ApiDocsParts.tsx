/**
 * Reusable helper components for ApiDocs.
 *
 * Extracted from ApiDocs.tsx to separate layout primitives from content.
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const BADGE_COLORS: Record<string, string> = {
  GET: "bg-emerald-500/20 text-emerald-400",
  POST: "bg-sky-500/20 text-sky-400",
  PATCH: "bg-amber-500/20 text-amber-400",
  DELETE: "bg-rose-500/20 text-rose-400",
  WS: "bg-violet-500/20 text-violet-400",
  SSE: "bg-fuchsia-500/20 text-fuchsia-400",
};

export function Badge({ method }: { method: string }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${BADGE_COLORS[method] ?? "bg-mm-border text-mm-text-dim"}`}
    >
      {method}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CodeBlock
// ---------------------------------------------------------------------------

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-black/[0.06] bg-mm-bg-deep p-3 text-[11px] leading-relaxed text-mm-text-dim">
      {children.trim()}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="mb-3 border-b border-black/[0.04] pb-1.5 text-sm font-semibold text-mm-accent">
        {title}
      </h2>
      <div className="space-y-3 text-xs leading-relaxed text-mm-text-dim">
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Collapsible
// ---------------------------------------------------------------------------

export function Collapsible({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-black/[0.04] bg-white/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-mm-border/10"
      >
        <span className="text-[11px] font-medium text-mm-text">{title}</span>
        <span className="ml-auto text-[10px] text-mm-text-dim">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-black/[0.03] px-3 py-2.5 text-[11px] text-mm-text-dim">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

export function Endpoint({
  method,
  path,
  description,
  children,
}: {
  method: string;
  path: string;
  description: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-black/[0.04] bg-white/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-mm-border/10"
      >
        <Badge method={method} />
        <code className="text-[11px] font-medium text-mm-text">{path}</code>
        <span className="ml-auto text-[10px] text-mm-text-dim">{open ? "▲" : "▼"}</span>
      </button>
      {!open && (
        <p className="px-3 pb-2 text-[11px] text-mm-text-dim">{description}</p>
      )}
      {open && (
        <div className="space-y-2 border-t border-black/[0.03] px-3 py-2.5 text-[11px] text-mm-text-dim">
          <p>{description}</p>
          {children}
        </div>
      )}
    </div>
  );
}
