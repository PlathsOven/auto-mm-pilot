import type { ReactNode } from "react";

interface PanelWindowProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function PanelWindow({ title, onClose, children }: PanelWindowProps) {
  return (
    <div className="flex h-full flex-col border border-mm-border bg-mm-surface">
      <div className="panel-drag-handle flex shrink-0 cursor-move items-center justify-between border-b border-mm-border bg-mm-bg px-3 py-1.5">
        <span className="select-none text-[10px] font-semibold uppercase tracking-wide text-mm-accent">
          {title}
        </span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="flex h-4 w-4 items-center justify-center text-mm-text-dim hover:text-mm-error"
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
