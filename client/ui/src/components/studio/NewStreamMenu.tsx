import { useEffect, useRef, useState } from "react";
import { STREAM_TEMPLATES } from "./templates";

interface Props {
  /** Fires when the user picks "Blank stream" (main body or popover top row). */
  onOpenBlank: () => void;
  /** Fires when the user picks a template id. */
  onOpenTemplate: (templateId: string) => void;
}

/**
 * Split button with a template popover.
 *
 * Primary body click opens a blank canvas — preserves the 1-click muscle
 * memory from the old solid `+ New stream` button. The caret opens a small
 * popover listing Blank + each registered template's title + one-liner.
 *
 * This is how quick-start templates are kept "less salient": they're
 * invisible until the user explicitly commits to creating a stream. The
 * open-action is delegated to the parent so callers control whether the
 * new stream opens in the Anatomy sidebar or elsewhere.
 */
export function NewStreamMenu({ onOpenBlank, onOpenTemplate }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-stretch overflow-hidden rounded-lg bg-mm-accent text-white shadow-sm">
        <button
          type="button"
          onClick={onOpenBlank}
          className="px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-mm-accent/90"
        >
          + New stream
        </button>
        <div className="w-px bg-white/25" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Choose a template"
          className="flex items-center px-2 text-[10px] transition-colors hover:bg-mm-accent/90"
        >
          ▾
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[320px] overflow-hidden rounded-xl border border-mm-border/60 bg-mm-surface py-1 shadow-xl shadow-black/40">
          <button
            type="button"
            onClick={() => {
              onOpenBlank();
              setOpen(false);
            }}
            className="flex w-full flex-col items-start gap-0.5 border-b border-mm-border/30 px-3 py-2 text-left transition-colors hover:bg-mm-accent/10"
          >
            <span className="text-xs font-semibold text-mm-text">Blank stream</span>
            <span className="text-[10px] text-mm-text-dim">
              Start from scratch with an empty canvas.
            </span>
          </button>

          <div className="max-h-[300px] overflow-y-auto">
            <p className="px-3 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Templates
            </p>
            {STREAM_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  onOpenTemplate(tpl.id);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-mm-accent/10"
              >
                <span className="text-[11px] font-medium text-mm-text">{tpl.title}</span>
                <span className="text-[10px] text-mm-text-dim">{tpl.oneLiner}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
