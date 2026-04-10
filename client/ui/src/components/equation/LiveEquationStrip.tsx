import { useTransforms } from "../../providers/TransformsProvider";
import { useFocusedCell } from "../../hooks/useFocusedCell";
import { useActivePositionSizing } from "../../hooks/useActivePositionSizing";
import { CANONICAL_GLYPH, renderFormula } from "./formulaTemplates";

/**
 * Three-size renderer for the canonical APT equation.
 *
 * - `xs` — top-bar glyph. Always shows the canonical "P = E·B / V" regardless
 *   of which sizing rule is active. The symbolic anchor for the framework.
 * - `md` — Floor pinned strip beneath the positions grid. Live numeric values
 *   for the focused cell, formula reflects the active `position_sizing` step.
 * - `lg` — Studio Anatomy detail panel. Same renderer as md, larger.
 *
 * The strip is intentionally read-only: navigation to Studio / Anatomy lives
 * in the mode switcher and ⌘K command palette, not inline here. The
 * numeric LHS comes from the authoritative `desiredPos` on the WS payload so
 * it always matches the positions grid exactly.
 */

export type EquationStripSize = "xs" | "md" | "lg";

interface LiveEquationStripProps {
  size?: EquationStripSize;
  /** Optional click handler — used to open the framework primer overlay. */
  onClick?: () => void;
}

export function LiveEquationStrip({ size = "xs", onClick }: LiveEquationStripProps) {
  if (size === "xs") {
    return <XsGlyph onClick={onClick} />;
  }
  return <MdLgStrip size={size} />;
}

// ---------------------------------------------------------------------------
// xs — top-bar glyph (always canonical, transform-agnostic)
// ---------------------------------------------------------------------------

function XsGlyph({ onClick }: { onClick?: () => void }) {
  const content = (
    <span
      className="font-medium tracking-wide text-mm-accent/80"
      title="APT canonical form: Position = Edge × Bankroll / Variance"
    >
      {CANONICAL_GLYPH}
    </span>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-black/[0.04]"
      >
        {content}
      </button>
    );
  }
  return <span className="px-1.5 py-0.5 text-[11px]">{content}</span>;
}

// ---------------------------------------------------------------------------
// md / lg — live formula renderer
// ---------------------------------------------------------------------------

function MdLgStrip({ size }: { size: "md" | "lg" }) {
  const focused = useFocusedCell();
  const positionSizing = useActivePositionSizing();
  const { bankroll } = useTransforms();

  // No focused cell → render nothing. Inspection is now driven exclusively
  // by selections from elsewhere in the app (e.g. CommandPalette), not by
  // clicks on the positions grid.
  if (!positionSizing || !focused) return null;

  const rendered = renderFormula(positionSizing.formula, {
    edge: focused.position.smoothedEdge,
    variance: focused.position.smoothedVar,
    bankroll,
    params: positionSizing.params,
    position: focused.position.desiredPos,
  });

  const symbolicSize = size === "lg" ? "text-lg" : "text-sm";
  const numericSize = size === "lg" ? "text-base" : "text-[11px]";

  return (
    <StripShell size={size}>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[10px] uppercase tracking-wider text-mm-text-dim">
          {focused.symbol} {focused.expiry}
        </span>
        <span className={`${symbolicSize} font-semibold text-mm-accent`}>
          {rendered.symbolic}
        </span>
        <span className={`${numericSize} tabular-nums text-mm-text`} title={rendered.caption}>
          {rendered.numeric}
        </span>
        <span className="text-[10px] text-mm-text-dim">{rendered.caption}</span>
      </div>
    </StripShell>
  );
}

function StripShell({
  size,
  children,
}: {
  size: "md" | "lg";
  children: React.ReactNode;
}) {
  const padding = size === "lg" ? "px-4 py-3" : "px-3 py-2";
  return (
    <div
      className={`mt-2 flex items-center justify-between gap-3 rounded-lg border border-black/[0.06] bg-black/[0.04] ${padding}`}
    >
      {children}
    </div>
  );
}
