import { useStreamContributions } from "../../hooks/useStreamContributions";
import { valColor } from "../../utils";

interface Props {
  symbol: string;
  expiry: string;
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
export function StreamAttributionHoverCard({ symbol, expiry }: Props) {
  const { loading, contributions, error } = useStreamContributions({ symbol, expiry });

  return (
    <div className="absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 rounded-lg border border-white/50 bg-white/85 p-3 shadow-lg shadow-black/[0.08] ring-1 ring-black/[0.06]" style={{ backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
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
                <span className={`text-[10px] ${valColor(c.edge)}`}>
                  {c.edge >= 0 ? "+" : ""}
                  {c.edge.toFixed(4)}
                </span>
                <span className="text-[9px] text-mm-text-dim">
                  σ² {c.variance.toFixed(4)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
