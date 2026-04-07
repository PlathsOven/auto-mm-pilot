import { useStreamContributions } from "../../hooks/useStreamContributions";
import { valColor } from "../../utils";

interface Props {
  asset: string;
  expiry: string;
}

const TOP_N = 3;

/**
 * Compact hover-card showing the top-3 stream contributions to fair value
 * and variance for a single (asset, expiry) cell.
 *
 * Backed by `GET /api/pipeline/timeseries` (`current_decomposition.blocks`)
 * via `useStreamContributions`. Cached for 5s so re-hovers are instant.
 */
export function StreamAttributionHoverCard({ asset, expiry }: Props) {
  const { loading, contributions, error } = useStreamContributions({ asset, expiry });

  return (
    <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 rounded-lg border border-mm-border/60 bg-mm-surface/95 p-3 shadow-xl shadow-black/40 backdrop-blur-sm">
      <div className="mb-2 flex items-baseline justify-between border-b border-mm-border/40 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-accent">
          Stream Attribution
        </span>
        <span className="text-[10px] tabular-nums text-mm-text-dim">
          {asset} {expiry}
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
        <div className="flex flex-col gap-1.5">
          {contributions.slice(0, TOP_N).map((c) => (
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
          {contributions.length > TOP_N && (
            <p className="mt-1 border-t border-mm-border/40 pt-1 text-[9px] text-mm-text-dim">
              +{contributions.length - TOP_N} more — open Lens to inspect
            </p>
          )}
        </div>
      )}
    </div>
  );
}
