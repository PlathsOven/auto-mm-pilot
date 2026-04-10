import type { ReactNode } from "react";

interface PanelWindowProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function PanelWindow({ title, onClose, children }: PanelWindowProps) {
  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <div className="panel-drag-handle flex shrink-0 cursor-move items-center justify-between border-b border-black/[0.06] px-5 py-3">
        <span className="select-none text-[13px] font-medium tracking-tight text-mm-text">
          {title}
        </span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded-md text-mm-text-subtle transition-colors hover:bg-mm-error/10 hover:text-mm-error"
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
