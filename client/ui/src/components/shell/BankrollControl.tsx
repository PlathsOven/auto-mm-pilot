import { useEffect, useRef, useState, type RefObject } from "react";
import { updateBankroll } from "../../services/streamApi";
import { useTransforms } from "../../providers/TransformsProvider";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { BANKROLL_POPOVER_WIDTH_PX } from "../../constants";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The DOM element that toggled this popover open. Clicks on it must NOT
   *  count as outside-clicks — otherwise the popover's mousedown handler
   *  races the trigger's click handler and the popover stays stuck open. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Pixel offset from the anchor's right edge — lets the caller align the popover. */
  anchorRightPx?: number;
  /** Pixel offset from the anchor's bottom edge. */
  anchorBottomPx?: number;
}

/**
 * Popover for editing the account bankroll.
 *
 * Two-step: type a new value → click "Set" to enter confirm state → "Confirm"
 * fires the PATCH. Cancelling in confirm state returns to the input view.
 * The confirm step is mandatory per product spec — bankroll changes move real
 * sizing and should never happen from a stray keystroke.
 */
export function BankrollControl({
  open,
  onClose,
  anchorRef,
  anchorRightPx = 8,
  anchorBottomPx = 28,
}: Props) {
  const { bankroll: current, refresh } = useTransforms();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [input, setInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useKeyboardShortcut("Escape", () => open && onClose(), { mod: false });

  useEffect(() => {
    if (!open) return;
    setInput("");
    setConfirming(false);
    setError(null);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      // The trigger owns toggle semantics — ignore it here so its own
      // onClick can close the popover. Otherwise the mousedown here fires
      // first and closes, then the click reopens: popover gets stuck open.
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const parsed = parseFloat(input);
  const parsedValid = Number.isFinite(parsed) && parsed > 0;
  const unchanged = parsedValid && parsed === current;

  const handleRequestConfirm = () => {
    if (!parsedValid) {
      setError("Bankroll must be a positive number");
      return;
    }
    if (unchanged) {
      setError("New value is the same as current");
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await updateBankroll(parsed);
      await refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute z-20 flex flex-col gap-2 rounded-lg border border-white/50 bg-white/90 p-3 shadow-lg shadow-black/[0.08] ring-1 ring-black/[0.06] backdrop-blur-glass24"
      style={{
        right: anchorRightPx,
        bottom: anchorBottomPx,
        width: BANKROLL_POPOVER_WIDTH_PX,
      }}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold text-mm-text">Bankroll</h3>
        <span className="font-mono text-[10px] text-mm-text-dim">
          {Number.isFinite(current) ? current.toLocaleString() : "—"}
        </span>
      </div>

      {!confirming ? (
        <>
          <input
            ref={inputRef}
            type="number"
            step="any"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleRequestConfirm(); }}
            placeholder="New value"
            className="form-input font-mono text-[11px]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-black/[0.08] px-3 py-1.5 text-[10px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRequestConfirm}
              disabled={!parsedValid || unchanged}
              className="flex-1 rounded-md bg-mm-accent/20 px-3 py-1.5 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30 disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-md border border-mm-warn/40 bg-mm-warn/10 px-2 py-1.5 text-[10px] text-mm-text">
            Change bankroll from{" "}
            <span className="font-mono">{current.toLocaleString()}</span> to{" "}
            <span className="font-mono font-semibold">{parsed.toLocaleString()}</span>?
            <br />
            <span className="text-mm-text-dim">Re-runs the pipeline.</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={submitting}
              className="flex-1 rounded-md border border-black/[0.08] px-3 py-1.5 text-[10px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 rounded-md bg-mm-accent/30 px-3 py-1.5 text-[10px] font-semibold text-mm-accent transition-colors hover:bg-mm-accent/40 disabled:opacity-40"
            >
              {submitting ? "Saving…" : "Confirm"}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="text-[10px] text-mm-error">{error}</p>
      )}
    </div>
  );
}
