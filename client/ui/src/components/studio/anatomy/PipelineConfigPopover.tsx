import { useEffect, useRef } from "react";
import { BankrollEditor } from "../BankrollEditor";
import { MarketPricingEditor } from "../MarketPricingEditor";
import { useKeyboardShortcut } from "../../../hooks/useKeyboardShortcut";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Floating popover for pipeline-level configuration (bankroll + market pricing).
 *
 * Previously these editors lived in a permanent right sidebar on Pipeline
 * Composer. In the new Anatomy they're tucked into a low-traffic popover
 * triggered from a "⚙ Config" button in the header — the canvas surface
 * stays clean by default, and architects who need to tweak bankroll or
 * market pricing reach them from a single click.
 */
export function PipelineConfigPopover({ open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useKeyboardShortcut("Escape", () => open && onClose(), { mod: false });

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute right-4 top-12 z-20 flex w-[340px] flex-col gap-3 rounded-xl border border-mm-border/60 bg-mm-surface p-3 shadow-xl shadow-black/40"
    >
      <div className="flex items-center justify-between">
        <h3 className="zone-header">Pipeline config</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>
      <BankrollEditor />
      <MarketPricingEditor />
    </div>
  );
}
