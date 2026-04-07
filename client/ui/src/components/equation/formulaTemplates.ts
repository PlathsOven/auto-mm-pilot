/**
 * Formula rendering helpers.
 *
 * The active transform's symbolic formula comes from the server (see
 * `TransformInfo.formula`), so this file no longer hand-codes template
 * functions. It provides only:
 *
 *   - `CANONICAL_GLYPH`: the immutable symbolic form for the top-bar glyph.
 *   - `renderFormula(formula, ctx)`: substitutes live numeric values into the
 *     server-provided symbolic form, picking whichever parameters the formula
 *     references.
 *
 * The client stays dumb: adding a new sizing rule only requires registering
 * it on the server with a `formula="..."` string. No client deploy needed.
 */

export interface FormulaContext {
  edge: number;
  bankroll: number;
  variance: number;
  /** Parameters as returned by GET /api/transforms for the active step. */
  params: Record<string, unknown>;
}

export interface RenderedFormula {
  /** Symbolic form, e.g. "P = E·B / V" (echoed from the server). */
  symbolic: string;
  /** Numeric form with live values, e.g. "+12,500 = 0.0024 × 5,000,000 / 0.96". */
  numeric: string;
  /** Plain-language caption derived from the symbolic form. */
  caption: string;
  /** Computed position value (NaN if the formula can't be evaluated). */
  position: number;
}

export const CANONICAL_GLYPH = "P = E·B / V";

const FALLBACK_SYMBOLIC = "P = f(E, B, V)";

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
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Very small expression evaluator keyed by the symbolic shapes used in the
 * registered transforms (`P = E·B / V`, `P = E·B / (γ·V)`, etc.). We don't
 * parse arbitrary math — we detect the handful of shapes we know about.
 */
function evaluate(symbolic: string, ctx: FormulaContext): number {
  const { edge, bankroll, variance, params } = ctx;
  if (variance === 0) return NaN;
  // Kelly shape: E·B / V
  if (/E\s*[·*]\s*B\s*\/\s*V(?!\s*\))/.test(symbolic)) {
    return (edge * bankroll) / variance;
  }
  // Power utility shape: E·B / (γ·V)
  if (/E\s*[·*]\s*B\s*\/\s*\(\s*γ\s*[·*]\s*V\s*\)/.test(symbolic)) {
    const gamma =
      typeof params.risk_aversion === "number"
        ? (params.risk_aversion as number)
        : 2.0;
    return (edge * bankroll) / (gamma * variance);
  }
  return NaN;
}

function numericForm(symbolic: string, ctx: FormulaContext, position: number): string {
  const { edge, bankroll, variance, params } = ctx;
  if (/E\s*[·*]\s*B\s*\/\s*V(?!\s*\))/.test(symbolic)) {
    return `${fmtPos(position)} = ${fmt(edge)} × ${fmt(bankroll)} / ${fmt(variance)}`;
  }
  if (/E\s*[·*]\s*B\s*\/\s*\(\s*γ\s*[·*]\s*V\s*\)/.test(symbolic)) {
    const gamma =
      typeof params.risk_aversion === "number"
        ? (params.risk_aversion as number)
        : 2.0;
    return `${fmtPos(position)} = ${fmt(edge)} × ${fmt(bankroll)} / (${fmt(gamma)} × ${fmt(variance)})`;
  }
  return `${fmtPos(position)} ≈ f(${fmt(edge)}, ${fmt(bankroll)}, ${fmt(variance)})`;
}

function caption(symbolic: string, ctx: FormulaContext): string {
  if (/E\s*[·*]\s*B\s*\/\s*V(?!\s*\))/.test(symbolic)) {
    return "Position = Edge × Bankroll / Variance";
  }
  if (/E\s*[·*]\s*B\s*\/\s*\(\s*γ\s*[·*]\s*V\s*\)/.test(symbolic)) {
    const gamma =
      typeof ctx.params.risk_aversion === "number"
        ? (ctx.params.risk_aversion as number)
        : 2.0;
    return `Position = Edge × Bankroll / (γ × Variance), γ = ${fmt(gamma)}`;
  }
  return "Position = f(Edge, Bankroll, Variance)";
}

/**
 * Render a formula for display in the Live Equation Strip.
 *
 * `formula` is the server-provided symbolic string (empty = unknown sizing
 * rule, falls back to the generic shape).
 */
export function renderFormula(formula: string, ctx: FormulaContext): RenderedFormula {
  const symbolic = formula || FALLBACK_SYMBOLIC;
  const position = evaluate(symbolic, ctx);
  return {
    symbolic,
    position,
    numeric: numericForm(symbolic, ctx, position),
    caption: caption(symbolic, ctx),
  };
}
