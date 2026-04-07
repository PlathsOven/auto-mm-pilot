interface Props {
  /** Optional data-flow name displayed between the line and the arrowhead. */
  label?: string;
}

/**
 * Vertical connector between two flowchart nodes.
 *
 * Consists of a thin line + optional data-flow label + CSS-triangle arrowhead.
 * Pure CSS, no SVG, no framer-motion.
 */
export function FlowArrow({ label }: Props) {
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <div className="h-5 w-px bg-mm-accent/40" />
      {label && (
        <span className="text-[9px] font-medium uppercase tracking-wider text-mm-text-dim">
          {label}
        </span>
      )}
      <div
        className="h-0 w-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent"
        style={{ borderTopColor: "rgba(129, 140, 248, 0.4)" }}
      />
    </div>
  );
}
