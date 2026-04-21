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

from server.api.expiry import canonical_expiry_key
from server.core.config import SECONDS_PER_YEAR
from server.core.transforms.registry import transform


def _t_years_for_expiry(expiry: object, now: _dt.datetime) -> float:
    """Forward span in year-fractions — matches the convention the UI's
    vol display uses (``sqrt(Σ_t fair / T_years)``)."""
    if isinstance(expiry, _dt.datetime):
        exp_dt = expiry
    elif isinstance(expiry, _dt.date):
        exp_dt = _dt.datetime(expiry.year, expiry.month, expiry.day)
    else:
        exp_dt = _dt.datetime.fromisoformat(canonical_expiry_key(expiry))
    secs = (exp_dt - now).total_seconds()
    return max(secs, 0.0) / SECONDS_PER_YEAR


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

    # Fast path: no user input → fall back to space_fair wherever null.
    if not aggregate_market_values and not space_market_values:
        return space_series_df.with_columns(
            pl.col("space_market_fair").fill_null(pl.col("space_fair")),
        ).sort(space_group_keys)

    # Only spaces with null space_market_fair need inference — those came from
    # blocks tagged "aggregate". Spaces already carrying a block/passthrough
    # mean are untouched by the allocator below.
    inferable_mask = pl.col("space_market_fair").is_null()

    space_integral_df = (
        space_series_df
        .filter(inferable_mask)
        .group_by(risk_dimension_cols + ["space_id"])
        .agg(pl.col("space_fair").sum().alias("_space_fair_integral"))
    )

    if space_integral_df.is_empty():
        return space_series_df.with_columns(
            pl.col("space_market_fair").fill_null(pl.col("space_fair")),
        ).sort(space_group_keys)

    rd_groups = space_integral_df.partition_by(
        risk_dimension_cols, as_dict=True, maintain_order=True,
    )

    # Accumulator rows for the join-back multiplier frame. Each tuple is
    # (*risk_dim_values, space_id, multiplier) matching the schema below.
    mult_records: list[tuple] = []

    for rd_key, group_df in rd_groups.items():
        symbol = rd_key[0]
        expiry_raw = rd_key[1] if len(rd_key) > 1 else None
        expiry_canon = canonical_expiry_key(expiry_raw) if expiry_raw is not None else ""
        t_years = _t_years_for_expiry(expiry_raw, now) if expiry_raw is not None else 0.0

        aggregate_vol = aggregate_market_values.get((symbol, expiry_canon))
        aggregate_var_target = (
            aggregate_vol ** 2 * t_years if aggregate_vol is not None else None
        )

        user_entries: list[tuple[object, float, float]] = []
        inferable_entries: list[tuple[object, float]] = []
        for space_id, integral in group_df.select("space_id", "_space_fair_integral").rows():
            user_vol = space_market_values.get((symbol, expiry_canon, space_id))
            if user_vol is not None:
                user_entries.append((space_id, integral, user_vol ** 2 * t_years))
            else:
                inferable_entries.append((space_id, integral))

        for space_id, integral, user_var_target in user_entries:
            mult = user_var_target / integral if integral != 0 else 0.0
            mult_records.append((*rd_key, space_id, mult))

        if aggregate_var_target is None:
            for space_id, _integral in inferable_entries:
                mult_records.append((*rd_key, space_id, 1.0))
            continue

        user_contribution = sum(e[2] for e in user_entries)
        remainder = aggregate_var_target - user_contribution
        inf_total = sum(e[1] for e in inferable_entries)

        if inf_total == 0 or not inferable_entries:
            for space_id, _integral in inferable_entries:
                mult_records.append((*rd_key, space_id, 1.0))
            continue

        mult = remainder / inf_total
        for space_id, _integral in inferable_entries:
            mult_records.append((*rd_key, space_id, mult))

    if not mult_records:
        return space_series_df.with_columns(
            pl.col("space_market_fair").fill_null(pl.col("space_fair")),
        ).sort(space_group_keys)

    mult_schema = [
        *((c, space_series_df.schema[c]) for c in risk_dimension_cols),
        ("space_id", space_series_df.schema["space_id"]),
        ("_multiplier", pl.Float64),
    ]
    mult_df = pl.DataFrame(mult_records, schema=mult_schema, orient="row")

    joined = space_series_df.join(
        mult_df, on=risk_dimension_cols + ["space_id"], how="left",
    ).with_columns(
        pl.col("_multiplier").fill_null(1.0),
    )

    # Fill ONLY the null rows (block/passthrough spaces keep their own market).
    filled = joined.with_columns(
        pl.when(pl.col("space_market_fair").is_null())
          .then(pl.col("space_fair") * pl.col("_multiplier"))
          .otherwise(pl.col("space_market_fair"))
          .alias("space_market_fair"),
    ).drop("_multiplier")

    return filled.sort(space_group_keys)


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
