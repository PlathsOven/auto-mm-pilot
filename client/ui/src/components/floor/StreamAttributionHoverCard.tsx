import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStreamContributions } from "../../hooks/useStreamContributions";
import { valColor } from "../../utils";

interface Props {
  symbol: string;
  expiry: string;
  /** The cell's DOMRect — used to position the popover via fixed coords so
   *  it isn't clipped by the position grid's overflow-auto scroller. */
  anchorRect: DOMRect | null;
}

/**
 * Hover-card showing every stream contribution to fair value and variance
 * for a single (symbol, expiry) cell.
 *
 * Backed by `GET /api/pipeline/timeseries` (`currentDecomposition.blocks`)
 * via `useStreamContributions`. Cached for 5s so re-hovers are instant.
 *
 * The popup is a child of the parent `<td>`, so mouse-wheel scroll inside
 * the popup does not fire `mouseleave` on the td and the hover state
 * survives. Hence pointer events are enabled here.
 */
export function StreamAttributionHoverCard({ symbol, expiry, anchorRect }: Props) {
  const { loading, contributions, error } = useStreamContributions({ symbol, expiry });
  const [mounted, setMounted] = useState(false);

  // SSR safety + ensure document.body exists (it always will in the browser
  // but keeps Storybook/tests happy).
  useEffect(() => { setMounted(typeof document !== "undefined"); }, []);
  if (!mounted || !anchorRect) return null;

  // Position below the anchor cell, clamped to the viewport so the card never
  // hangs off the right edge or below the status bar.
  const cardWidth = 256;
  const margin = 8;
  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 200);
  let left = anchorRect.left + anchorRect.width / 2 - cardWidth / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - cardWidth - margin));

  return createPortal(
    <div
      className="fixed z-[120] rounded-lg border border-white/50 bg-white/85 p-3 shadow-elev-3 ring-1 ring-black/[0.06] backdrop-blur-glass24"
      style={{ top, left, width: cardWidth }}
      // Don't intercept pointer events — the hover lives on the underlying td.
      // Setting pointer-events: none means moving over the card doesn't trigger
      // mouseleave on the cell (the card is pinned but can't be interacted with).
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mb-2 flex items-baseline justify-between border-b border-black/[0.06] pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-accent">
          Stream Attribution
        </span>
        <span className="text-[10px] tabular-nums text-mm-text-dim">
          {symbol} {expiry}
        </span>
      </div>

      {loading && (
        <p className="py-2 text-center text-[10px] text-mm-text-dim">
          Loading…
        </p>
      )}

      {error && (
        <p className="py-2 text-[10px] text-mm-error">
          {error}
        </p>
      )}

      {contributions && contributions.length === 0 && (
        <p className="py-2 text-center text-[10px] text-mm-text-dim">
          No contributions for this cell.
        </p>
      )}

      {contributions && contributions.length > 0 && (
        <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
          {contributions.map((c) => (
            <div
              key={c.blockName}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="truncate text-[10px] font-medium text-mm-text">
                {c.blockName}
              </span>
              <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
                <span className={`text-[10px] ${valColor(c.fair)}`}>
                  {c.fair >= 0 ? "+" : ""}
                  {c.fair.toFixed(4)}
                </span>
                <span className="text-[9px] text-mm-text-dim">
                  σ² {c.variance.toFixed(4)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
