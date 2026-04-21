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
from collections import defaultdict

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

    rd_groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in space_integral_df.iter_rows(named=True):
        rd_key = tuple(row[c] for c in risk_dimension_cols)
        rd_groups[rd_key].append({
            "space_id": row["space_id"],
            "integral": row["_space_fair_integral"],
        })

    multipliers: dict[tuple, float] = {}

    for rd_key, entries in rd_groups.items():
        symbol = rd_key[0]
        expiry_raw = rd_key[1] if len(rd_key) > 1 else None
        expiry_canon = canonical_expiry_key(expiry_raw) if expiry_raw is not None else ""
        t_years = _t_years_for_expiry(expiry_raw, now) if expiry_raw is not None else 0.0

        aggregate_vol = aggregate_market_values.get((symbol, expiry_canon))
        aggregate_var_target = (
            aggregate_vol ** 2 * t_years if aggregate_vol is not None else None
        )

        user_space_entries: list[dict] = []
        inferable_entries: list[dict] = []
        for e in entries:
            user_vol = space_market_values.get((symbol, expiry_canon, e["space_id"]))
            if user_vol is not None:
                user_space_entries.append({**e, "user_var_target": user_vol ** 2 * t_years})
            else:
                inferable_entries.append(e)

        for e in user_space_entries:
            key = rd_key + (e["space_id"],)
            multipliers[key] = (
                e["user_var_target"] / e["integral"] if e["integral"] != 0 else 0.0
            )

        if aggregate_var_target is None:
            for e in inferable_entries:
                multipliers[rd_key + (e["space_id"],)] = 1.0
            continue

        user_contribution = sum(e["user_var_target"] for e in user_space_entries)
        remainder = aggregate_var_target - user_contribution
        inf_total = sum(e["integral"] for e in inferable_entries)

        if inf_total == 0 or not inferable_entries:
            for e in inferable_entries:
                multipliers[rd_key + (e["space_id"],)] = 1.0
            continue

        mult = remainder / inf_total
        for e in inferable_entries:
            multipliers[rd_key + (e["space_id"],)] = mult

    if not multipliers:
        return space_series_df.with_columns(
            pl.col("space_market_fair").fill_null(pl.col("space_fair")),
        ).sort(space_group_keys)

    mult_rows: list[dict] = []
    for key, m in multipliers.items():
        row: dict = {}
        for i, c in enumerate(risk_dimension_cols):
            row[c] = key[i]
        row["space_id"] = key[len(risk_dimension_cols)]
        row["_multiplier"] = m
        mult_rows.append(row)

    mult_df = pl.DataFrame(mult_rows)
    for c in risk_dimension_cols:
        mult_df = mult_df.with_columns(pl.col(c).cast(space_series_df.schema[c]))
    mult_df = mult_df.with_columns(
        pl.col("space_id").cast(space_series_df.schema["space_id"]),
    )

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
