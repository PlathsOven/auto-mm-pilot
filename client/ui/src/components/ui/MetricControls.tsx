import { useEffect, useRef, useState } from "react";
import type { Metric, Smoothing } from "../../utils";
import {
  CONTRIBUTION_METRICS,
  CONTRIBUTION_METRIC_META,
  METRIC_META,
  METRICS,
  type ContributionMetric,
} from "../../constants";

/** Shared metric dropdown used by the Overview grid and the Pipeline
 *  chart. Visual design is identical in both surfaces — any layout change
 *  here propagates to both. */
export function MetricDropdown({
  value,
  onChange,
}: {
  value: Metric;
  onChange: (m: Metric) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-lg border border-mm-accent/30 bg-mm-accent/10 px-2 py-1 text-[10px] font-medium text-mm-accent transition-colors"
      >
        <span>{METRIC_META[value].label}</span>
        <span className="text-[8px]">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-black/[0.06] bg-mm-surface-solid py-1 shadow-lg shadow-black/[0.08]">
          {METRICS.map((m) => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] transition-colors hover:bg-mm-accent/10 ${
                value === m ? "text-mm-accent" : "text-mm-text"
              }`}
            >
              <span>{METRIC_META[m].label}</span>
              {METRIC_META[m].unit && (
                <span className="text-[9px] text-mm-text-dim">{METRIC_META[m].unit}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Contributions-tab dropdown — one of Fair / Variance / Market in
 *  calc space. Styled identically to ``MetricDropdown`` so the Pipeline
 *  panel's Contributions tab reads as a sibling control, not a new
 *  affordance. */
export function ContributionMetricDropdown({
  value,
  onChange,
}: {
  value: ContributionMetric;
  onChange: (m: ContributionMetric) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-lg border border-mm-accent/30 bg-mm-accent/10 px-2 py-1 text-[10px] font-medium text-mm-accent transition-colors"
      >
        <span>{CONTRIBUTION_METRIC_META[value].label}</span>
        <span className="text-[8px]">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-black/[0.06] bg-mm-surface-solid py-1 shadow-lg shadow-black/[0.08]">
          {CONTRIBUTION_METRICS.map((m) => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] transition-colors hover:bg-mm-accent/10 ${
                value === m ? "text-mm-accent" : "text-mm-text"
              }`}
            >
              <span>{CONTRIBUTION_METRIC_META[m].label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shared Instant/Smoothed segmented toggle. `disabled` greys the strip
 *  for metrics with no smoothed variant (Market Source). */
export function SmoothingToggle({
  value,
  onChange,
  disabled,
}: {
  value: Smoothing;
  onChange: (s: Smoothing) => void;
  disabled: boolean;
}) {
  const baseBtn = "px-2 py-1 text-[10px] font-medium transition-colors";
  const selected = "bg-mm-accent/10 text-mm-accent";
  const unselected = "text-mm-text-dim hover:bg-black/[0.04]";
  const wrapperClass = `flex overflow-hidden rounded-lg border border-mm-accent/30 ${
    disabled ? "pointer-events-none opacity-40" : ""
  }`;
  return (
    <div
      className={wrapperClass}
      title={disabled ? "No smoothed variant for this view" : "Toggle smoothed / instant values"}
    >
      <button
        type="button"
        onClick={() => onChange("instant")}
        className={`${baseBtn} ${value === "instant" ? selected : unselected}`}
      >
        Instant
      </button>
      <button
        type="button"
        onClick={() => onChange("smoothed")}
        className={`${baseBtn} border-l border-mm-accent/30 ${value === "smoothed" ? selected : unselected}`}
      >
        Smoothed
      </button>
    </div>
  );
}
