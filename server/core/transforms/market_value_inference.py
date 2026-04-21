"""Market-value-inference transforms — fill null ``space_market_fair`` from aggregate input.

Stage D.1 of the 4-space pipeline. Input is ``space_series_df`` (already
per-``(risk_dim, space_id, timestamp)`` from Stage C's risk-space mean).
Rows where every contributing block had ``market_value_source ∈ {"block",
"passthrough"}`` already have a ``space_market_fair`` value; rows where
any block was ``"aggregate"`` arrive with ``space_market_fair == null``
and are filled here.

Allocation: for each ``(symbol, expiry)`` with a user-set aggregate
``total_vol``, the implied variance ``total_vol² × T_years`` is
distributed across spaces whose ``space_market_fair`` is still null,
proportional to each space's forward-integrated ``space_fair``. The
``× T_years`` factor keeps the display math
``sqrt(Σ_t space_market_fair / T_years)`` returning exactly the user's
``total_vol``.

User-set per-space values in ``space_market_values`` override the
aggregate allocation for those specific spaces; the remainder flows to
the others.

Default (no aggregate, no user-set per-space): null
``space_market_fair`` rows fall back to ``space_fair`` — edge = 0 at
every timestamp.
"""

from __future__ import annotations

import datetime as _dt

import polars as pl

from server.core.config import SECONDS_PER_YEAR
from server.core.transforms.registry import transform


def _t_years_for_expiry(expiry: _dt.datetime, now: _dt.datetime) -> float:
    """Forward span in year-fractions — matches the convention the UI's
    vol display uses (``sqrt(Σ_t fair / T_years)``)."""
    secs = (expiry - now).total_seconds()
    return max(secs, 0.0) / SECONDS_PER_YEAR


def _user_values_df(
    space_market_values: dict[tuple[str, str, str], float],
    schema: dict[str, pl.DataType],
) -> pl.DataFrame:
    """Lift ``{(symbol, expiry_canon, space_id): vol}`` to a Polars frame
    with the same dtypes the pipeline uses, so joins match by both value
    and type."""
    if not space_market_values:
        return pl.DataFrame(
            schema={"symbol": pl.Utf8, "_expiry_canon": pl.Utf8, "space_id": pl.Utf8, "_user_vol": pl.Float64},
        )
    rows = [(s, e, sp, v) for (s, e, sp), v in space_market_values.items()]
    return pl.DataFrame(
        rows, schema=["symbol", "_expiry_canon", "space_id", "_user_vol"], orient="row",
    ).with_columns(
        pl.col("symbol").cast(schema["symbol"]),
        pl.col("space_id").cast(schema["space_id"]),
    )


def _aggregate_values_df(
    aggregate_market_values: dict[tuple[str, str], float],
    schema: dict[str, pl.DataType],
) -> pl.DataFrame:
    """Lift ``{(symbol, expiry_canon): vol}`` to a Polars frame."""
    if not aggregate_market_values:
        return pl.DataFrame(
            schema={"symbol": pl.Utf8, "_expiry_canon": pl.Utf8, "_agg_vol": pl.Float64},
        )
    rows = [(s, e, v) for (s, e), v in aggregate_market_values.items()]
    return pl.DataFrame(
        rows, schema=["symbol", "_expiry_canon", "_agg_vol"], orient="row",
    ).with_columns(pl.col("symbol").cast(schema["symbol"]))


@transform("market_value_inference", "time_varying_proportional",
           description="Fill null space_market_fair proportional to space_fair(t) so "
                       "Σ_t space_market_fair / T_years = aggregate_total_vol².")
def mvi_time_varying_proportional(
    space_series_df: pl.DataFrame,
    risk_dimension_cols: list[str],
    aggregate_market_values: dict[tuple[str, str], float],
    space_market_values: dict[tuple[str, str, str], float],
    now: _dt.datetime,
) -> pl.DataFrame:
    if space_series_df.is_empty():
        return pl.DataFrame()

    space_group_keys = risk_dimension_cols + ["space_id", "timestamp"]

    # Fast path: no user input → null rows fall back to space_fair.
    if not aggregate_market_values and not space_market_values:
        return space_series_df.with_columns(
            pl.col("space_market_fair").fill_null(pl.col("space_fair")),
        ).sort(space_group_keys)

    # Canonical expiry key column — matches dict-key formatting. Requires
    # "expiry" in risk_dimension_cols; without it, the dicts can't key in and
    # the loop below produces no multipliers (equivalent to fast path).
    has_expiry = "expiry" in risk_dimension_cols
    if has_expiry:
        expiry_canon_expr = (
            pl.col("expiry").cast(pl.Datetime("us")).dt.strftime("%Y-%m-%dT%H:%M:%S")
        )
        t_years_expr = pl.max_horizontal(
            (pl.col("expiry").cast(pl.Datetime("us")) - pl.lit(now)).dt.total_seconds()
            / SECONDS_PER_YEAR,
            pl.lit(0.0),
        )
    else:
        expiry_canon_expr = pl.lit("")
        t_years_expr = pl.lit(0.0)

    # Integrate space_fair over null-market rows, per (risk_dim, space_id).
    # Rows already carrying a block/passthrough market_fair are untouched.
    inferable = (
        space_series_df
        .filter(pl.col("space_market_fair").is_null())
        .group_by(risk_dimension_cols + ["space_id"])
        .agg(pl.col("space_fair").sum().alias("_integral"))
    )
    if inferable.is_empty():
        return space_series_df.with_columns(
            pl.col("space_market_fair").fill_null(pl.col("space_fair")),
        ).sort(space_group_keys)

    inferable = inferable.with_columns(
        expiry_canon_expr.alias("_expiry_canon"),
        t_years_expr.alias("_t_years"),
    )

    schema = dict(space_series_df.schema)
    user_df = _user_values_df(space_market_values, schema)
    agg_df = _aggregate_values_df(aggregate_market_values, schema)

    joined = inferable.join(
        user_df, on=["symbol", "_expiry_canon", "space_id"], how="left",
    ).join(
        agg_df, on=["symbol", "_expiry_canon"], how="left",
    ).with_columns(
        (pl.col("_user_vol") ** 2 * pl.col("_t_years")).alias("_user_var_target"),
        (pl.col("_agg_vol") ** 2 * pl.col("_t_years")).alias("_agg_var_target"),
    )

    # Per-group (risk_dim) window aggregates: sum of user-set var targets,
    # and sum of integrals across inferable-only (non-user) spaces.
    joined = joined.with_columns(
        pl.col("_user_var_target").fill_null(0.0).sum().over(risk_dimension_cols)
        .alias("_user_contribution"),
        pl.when(pl.col("_user_var_target").is_null())
        .then(pl.col("_integral"))
        .otherwise(pl.lit(0.0))
        .sum().over(risk_dimension_cols)
        .alias("_inf_integral_sum"),
    ).with_columns(
        (pl.col("_agg_var_target") - pl.col("_user_contribution")).alias("_remainder"),
    ).with_columns(
        # User-set multiplier: user_var_target / integral (0 if integral==0).
        pl.when(pl.col("_integral") == 0)
        .then(pl.lit(0.0))
        .otherwise(pl.col("_user_var_target") / pl.col("_integral"))
        .alias("_user_mult"),
        # Inferable multiplier: remainder / inf_integral_sum (or 1.0 fallback).
        pl.when(pl.col("_inf_integral_sum") == 0)
        .then(pl.lit(1.0))
        .otherwise(pl.col("_remainder") / pl.col("_inf_integral_sum"))
        .alias("_inf_mult"),
    ).with_columns(
        pl.when(pl.col("_user_var_target").is_not_null()).then(pl.col("_user_mult"))
        .when(pl.col("_agg_var_target").is_not_null()).then(pl.col("_inf_mult"))
        .otherwise(pl.lit(1.0))
        .alias("_multiplier"),
    ).select(risk_dimension_cols + ["space_id", "_multiplier"])

    return (
        space_series_df
        .join(joined, on=risk_dimension_cols + ["space_id"], how="left")
        .with_columns(pl.col("_multiplier").fill_null(1.0))
        .with_columns(
            pl.when(pl.col("space_market_fair").is_null())
            .then(pl.col("space_fair") * pl.col("_multiplier"))
            .otherwise(pl.col("space_market_fair"))
            .alias("space_market_fair"),
        )
        .drop("_multiplier")
        .sort(space_group_keys)
    )


@transform("market_value_inference", "passthrough",
           description="No inference — null space_market_fair rows fall back to "
                       "space_fair (zero edge at every timestamp).")
def mvi_passthrough(
    space_series_df: pl.DataFrame,
    risk_dimension_cols: list[str],
    aggregate_market_values: dict[tuple[str, str], float],
    space_market_values: dict[tuple[str, str, str], float],
    now: _dt.datetime,
) -> pl.DataFrame:
    if space_series_df.is_empty():
        return pl.DataFrame()
    return space_series_df.with_columns(
        pl.col("space_market_fair").fill_null(pl.col("space_fair")),
    ).sort(risk_dimension_cols + ["space_id", "timestamp"])
