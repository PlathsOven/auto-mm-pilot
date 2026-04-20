"""Market-value-inference transforms — distribute an aggregate total_vol across blocks."""

from __future__ import annotations

import datetime as _dt
from collections import defaultdict

import polars as pl

from server.api.expiry import canonical_expiry_key
from server.core.config import SECONDS_PER_YEAR
from server.core.transforms.registry import TransformRegistration, transform


def _forward_coverage(row: dict, now: _dt.datetime) -> float:
    """Forward-integrated market-fair coefficient β for one block.

    Defined so ``Σ_t market_fair_block(t) == target_market_value · β · T_years``
    over the forward grid ``[now, expiry]``. ``total_vol_proportional`` uses
    β to allocate variance in proportion to each block's real forward reach,
    making ``Σ_blocks |target_mkt| · β == aggregate_var`` hold by construction
    — which in turn makes the sqrt-lifted ``totalMarketFairVol`` equal the
    user-entered ``marketVol`` regardless of block timing.

    Returns 0 for blocks that cannot contribute to market_fair over the
    forward window: ``size_type='relative'`` (market_fair is identically 0
    for those), blocks whose active interval doesn't overlap ``[now, expiry]``,
    or degenerate timing.

    Covers the analytic shapes of ``fv_flat_forward`` and ``fv_standard``
    under default decay (``decay_end_size_mult == 1`` or
    ``decay_rate_prop_per_min == 0``). For non-default decay shapes β is a
    flat-active-window approximation and the identity may drift slightly —
    acceptable for v1; exact handling can follow if it matters.
    """
    if row["size_type"] == "relative":
        return 0.0

    expiry = row["expiry"]
    T_secs = (expiry - now).total_seconds()
    if T_secs <= 0:
        return 0.0

    if row["temporal_position"] == "shifting":
        start_ts = now
    else:
        start_ts = row["start_timestamp"]
        if start_ts is None:
            return 0.0

    active_start = start_ts if start_ts > now else now
    if active_start >= expiry:
        return 0.0
    active_secs = (expiry - active_start).total_seconds()

    if row["annualized"]:
        # Annualized + fixed: rate per unit target_mkt is 1, integrated over the
        # active forward window gives target_mkt · active_secs/SPY.
        #   β = (active_secs / SPY) / T_years = active_secs / T_secs
        return active_secs / T_secs

    # Non-annualized: fair_ann per unit target_mkt = SPY / (expiry - start_ts),
    # integrated over the active forward window gives active_secs/(expiry-start_ts).
    #   β = Σ / (target_mkt · T_years) = SPY · active_secs / ((expiry-start_ts) · T_secs)
    start_to_expiry = (expiry - start_ts).total_seconds()
    if start_to_expiry <= 0:
        return 0.0
    return SECONDS_PER_YEAR * active_secs / (start_to_expiry * T_secs)


@transform("market_value_inference", "total_vol_proportional",
           description="Allocate aggregate total vol to blocks, weighted by |target_value| and "
                       "forward-integrated coverage so Σ total_market_fair == aggregate_var · T_years.")
def mvi_total_vol_proportional(
    blocks_df: pl.DataFrame,
    aggregate_market_values: dict[tuple[str, str], float],
    unit_fn: TransformRegistration,
    now: _dt.datetime,
) -> pl.DataFrame:
    """Proportional variance allocation with forward-coverage weighting.

    For each (symbol, expiry) with an aggregate total_vol:
      1. aggregate_var = total_vol²
      2. β_i = forward coverage for block i (see ``_forward_coverage``)
      3. user_contribution = Σ_{user blocks} target_market_value_i · β_i  (signed)
      4. remainder_var = aggregate_var - user_contribution  (signed; can be negative)
      5. For inferred blocks with β_i > 0: weight by |target_value_i|, then
         target_market_value_i = remainder_var · weight_i / β_i  (signed; sign
         follows remainder_var so user overshoots are cancelled out).
      6. Reverse unit conversion to produce raw market_value.

    The key invariant: Σ_blocks target_mkt · β == aggregate_var (algebraic) →
    forward integral of total_market_fair == aggregate_var · T_years →
    ``totalMarketFairVol == total_vol · 100 == marketVol`` on the UI.

    Holds even when user-set per-block market values overshoot the aggregate
    (remainder_var goes negative, inferred blocks take on negative target_mkt
    to cancel the excess).

    Blocks with β = 0 (relative size_type, stale static blocks fully outside
    the forward window) can't absorb variance and keep their default
    ``market_value == raw_value``.
    """
    if not aggregate_market_values or "has_user_market_value" not in blocks_df.columns:
        return blocks_df

    rows = blocks_df.to_dicts()
    modified = False

    dim_groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        dim_groups[(row["symbol"], canonical_expiry_key(row["expiry"]))].append(i)

    for (symbol, expiry_str), indices in dim_groups.items():
        if (symbol, expiry_str) not in aggregate_market_values:
            continue

        total_vol = aggregate_market_values[(symbol, expiry_str)]
        aggregate_var = total_vol ** 2

        coverage = {i: _forward_coverage(rows[i], now) for i in indices}

        user_idx = [i for i in indices if rows[i]["has_user_market_value"]]
        infer_idx = [i for i in indices if not rows[i]["has_user_market_value"]]

        # Signed user contribution — whatever the user's per-block market
        # values integrate to in the forward window. Remainder is signed too:
        # when the user-set blocks overshoot the aggregate, remainder goes
        # negative and the inferred blocks take on negative target_mkt to
        # cancel the excess, so Σ_blocks target_mkt · β lands on aggregate_var
        # algebraically.
        user_contribution = sum(
            rows[i]["target_market_value"] * coverage[i] for i in user_idx
        )
        remainder_var = aggregate_var - user_contribution

        # Only β > 0 blocks can absorb variance. Skip the rest so the weighted
        # allocation across eligible blocks sums to remainder_var exactly.
        eligible_idx = [i for i in infer_idx if coverage[i] > 0]
        if not eligible_idx:
            continue

        raw_vars = [abs(rows[i]["target_value"]) for i in eligible_idx]
        total_raw_var = sum(raw_vars)

        # When every eligible block has target_value == 0 (e.g. an events-only
        # dim before any event has fired), |target_value|-weighting collapses
        # every share to 0 and the aggregate-variance identity silently breaks.
        # Fall back to uniform weighting so the dim still absorbs remainder_var.
        if total_raw_var > 0:
            weights = [rv / total_raw_var for rv in raw_vars]
        else:
            weights = [1.0 / len(eligible_idx)] * len(eligible_idx)

        for j, idx in enumerate(eligible_idx):
            beta = coverage[idx]
            inferred_tmv = remainder_var * weights[j] / beta

            scale = rows[idx]["scale"]
            offset = rows[idx]["offset"]
            exponent = rows[idx]["exponent"]
            if exponent != 0 and scale != 0:
                sign_tmv = 1.0 if inferred_tmv >= 0 else -1.0
                raw_abs = (abs(inferred_tmv) ** (1.0 / exponent) - offset) / scale
                inferred_mv = sign_tmv * raw_abs
            else:
                inferred_mv = 0.0

            rows[idx]["target_market_value"] = inferred_tmv
            rows[idx]["market_value"] = inferred_mv
            modified = True

    if not modified:
        return blocks_df

    return pl.DataFrame(rows, schema=blocks_df.schema)


@transform("market_value_inference", "passthrough",
           description="No market value inference — blocks keep their individual market_value")
def mvi_passthrough(
    blocks_df: pl.DataFrame,
    aggregate_market_values: dict[tuple[str, str], float],
    unit_fn: TransformRegistration,
    now: _dt.datetime,
) -> pl.DataFrame:
    return blocks_df
