"use client";

import type { ReactNode } from "react";

interface PanelWindowProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function PanelWindow({ title, onClose, children }: PanelWindowProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-mm-border/60 bg-mm-surface shadow-lg shadow-black/20">
      <div className="panel-drag-handle flex shrink-0 cursor-move items-center justify-between border-b border-mm-border/40 bg-mm-bg/80 px-4 py-2">
        <span className="select-none text-[11px] font-semibold tracking-normal text-mm-accent">
          {title}
        </span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded-md text-mm-text-dim transition-colors hover:bg-mm-error/10 hover:text-mm-error"
          title="Close panel"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
