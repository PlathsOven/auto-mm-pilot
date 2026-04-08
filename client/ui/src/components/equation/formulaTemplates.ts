/**
 * Formula rendering helpers.
 *
 * The active transform's symbolic formula comes from the server (see
 * `TransformInfo.formula`), so this file no longer hand-codes template
 * functions. It provides only:
 *
 *   - `CANONICAL_GLYPH`: the immutable symbolic form for the top-bar glyph.
 *   - `renderFormula(formula, ctx)`: formats the formula with live inputs. The
 *     LHS (computed position) comes from the caller — it's the authoritative
 *     `desiredPos` from the WS payload, not a client recomputation. This
 *     guarantees the strip's number always matches the positions grid exactly
 *     and avoids float drift from rounded wire values.
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
  /**
   * Authoritative computed position (e.g. `DesiredPosition.desiredPos` from
   * the WS payload). The numeric formula uses this value as the LHS so it
   * always matches the grid cell.
   */
  position: number;
}

export interface RenderedFormula {
  /** Symbolic form, e.g. "P = E·B / V" (echoed from the server). */
  symbolic: string;
  /** Numeric form with live values, e.g. "+12,500 = 0.0024 × 5,000,000 / 0.96". */
  numeric: string;
  /** Plain-language caption derived from the symbolic form. */
  caption: string;
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
// Renderers per symbolic shape
// ---------------------------------------------------------------------------

const KELLY_SHAPE = /E\s*[·*]\s*B\s*\/\s*V(?!\s*\))/;
const POWER_UTILITY_SHAPE = /E\s*[·*]\s*B\s*\/\s*\(\s*γ\s*[·*]\s*V\s*\)/;

function numericForm(symbolic: string, ctx: FormulaContext): string {
  const { edge, bankroll, variance, params, position } = ctx;
  if (KELLY_SHAPE.test(symbolic)) {
    return `${fmtPos(position)} = ${fmt(edge)} × ${fmt(bankroll)} / ${fmt(variance)}`;
  }
  if (POWER_UTILITY_SHAPE.test(symbolic)) {
    const gamma =
      typeof params.risk_aversion === "number"
        ? (params.risk_aversion as number)
        : 2.0;
    return `${fmtPos(position)} = ${fmt(edge)} × ${fmt(bankroll)} / (${fmt(gamma)} × ${fmt(variance)})`;
  }
  return `${fmtPos(position)} ≈ f(${fmt(edge)}, ${fmt(bankroll)}, ${fmt(variance)})`;
}

function caption(symbolic: string, ctx: FormulaContext): string {
  if (KELLY_SHAPE.test(symbolic)) {
    return "Position = Edge × Bankroll / Variance";
  }
  if (POWER_UTILITY_SHAPE.test(symbolic)) {
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
 * rule, falls back to the generic shape). `ctx.position` is the authoritative
 * value from the WS payload — used as the LHS so the displayed number always
 * matches the positions grid.
 */
export function renderFormula(formula: string, ctx: FormulaContext): RenderedFormula {
  const symbolic = formula || FALLBACK_SYMBOLIC;
  return {
    symbolic,
    numeric: numericForm(symbolic, ctx),
    caption: caption(symbolic, ctx),
  };
}
