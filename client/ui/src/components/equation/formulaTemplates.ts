/**
 * Formula renderers keyed by `position_sizing` transform name.
 *
 * APT's canonical form is `Position = Edge × Bankroll / Variance` (the README's
 * "P = E·B / V"), but `position_sizing` is one of seven pluggable transform
 * steps and the active implementation can be swapped. The Live Equation Strip
 * looks up the active template here so the displayed formula always matches
 * what the server is actually computing.
 *
 * To support a new sizing transform, add an entry to FORMULA_TEMPLATES.
 * Unknown implementations fall back to FALLBACK_TEMPLATE.
 */

export interface FormulaContext {
  edge: number;
  bankroll: number;
  variance: number;
  /** Parameters as returned by GET /api/transforms for the active step. */
  params: Record<string, unknown>;
}

export interface RenderedFormula {
  /** Symbolic form, e.g. "P = E·B / V" or "P = E·B / (γ·V)". */
  symbolic: string;
  /** Numeric form with live values, e.g. "+12,500 = 0.0024 × 5,000,000 / 0.96". */
  numeric: string;
  /** Plain-language caption explaining the formula. */
  caption: string;
  /** Computed position value (NaN if unknown). */
  position: number;
}

export type FormulaTemplate = (ctx: FormulaContext) => RenderedFormula;

// ---------------------------------------------------------------------------
// Number formatting helpers
// ---------------------------------------------------------------------------

function fmt(v: number, maxDigits: number = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1) {
    return v.toLocaleString("en-US", { maximumFractionDigits: maxDigits });
  }
  return v.toPrecision(3);
}

function fmtPos(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const s = v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v >= 0 ? `+${s}` : s;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const KELLY_TEMPLATE: FormulaTemplate = ({ edge, bankroll, variance }) => {
  const position = variance === 0 ? NaN : (edge * bankroll) / variance;
  return {
    symbolic: "P = E·B / V",
    numeric: `${fmtPos(position)} = ${fmt(edge)} × ${fmt(bankroll)} / ${fmt(variance)}`,
    caption: "Position = Edge × Bankroll / Variance",
    position,
  };
};

export const POWER_UTILITY_TEMPLATE: FormulaTemplate = ({
  edge,
  bankroll,
  variance,
  params,
}) => {
  const gamma =
    typeof params.risk_aversion === "number" ? (params.risk_aversion as number) : 2.0;
  const position = variance === 0 ? NaN : (edge * bankroll) / (gamma * variance);
  return {
    symbolic: "P = E·B / (γ·V)",
    numeric: `${fmtPos(position)} = ${fmt(edge)} × ${fmt(bankroll)} / (${fmt(gamma)} × ${fmt(variance)})`,
    caption: `Position = Edge × Bankroll / (γ × Variance), γ = ${fmt(gamma)}`,
    position,
  };
};

export const FALLBACK_TEMPLATE: FormulaTemplate = ({ edge, bankroll, variance }) => ({
  symbolic: "P = f(E, B, V)",
  numeric: `f(${fmt(edge)}, ${fmt(bankroll)}, ${fmt(variance)})`,
  caption: "Position = f(Edge, Bankroll, Variance) — sizing rule not registered in UI",
  position: NaN,
});

export const FORMULA_TEMPLATES: Record<string, FormulaTemplate> = {
  kelly: KELLY_TEMPLATE,
  power_utility: POWER_UTILITY_TEMPLATE,
};

/**
 * Canonical symbolic form. Used as the persistent top-bar glyph regardless of
 * which sizing rule is currently active — it's the symbolic anchor for the
 * whole framework, not a live render.
 */
export const CANONICAL_GLYPH = "P = E·B / V";

export function getTemplate(name: string | undefined | null): FormulaTemplate {
  if (!name) return FALLBACK_TEMPLATE;
  return FORMULA_TEMPLATES[name] ?? FALLBACK_TEMPLATE;
}
