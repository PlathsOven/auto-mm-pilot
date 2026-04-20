"""Market-value-inference transforms — per-space ``market_fair`` time series.

Market-implied value lives at the space level. The inference step collapses
the per-block ``fair`` / ``var`` frame into per-space rows and attaches a
``space_market_fair(t)`` curve.

Default (no aggregate, no user-set per-space values): each space's
``market_fair(t)`` equals its own ``fair(t)`` — edge = 0 at every timestamp.

Time-varying proportional allocation: when a user sets aggregate
``total_vol`` for ``(symbol, expiry)``, the implied variance
(``total_vol² × T_years``) is distributed across inferable spaces such
that each space's ``market_fair(t)`` is proportional to its own
``fair(t)``. The ``× T_years`` factor keeps the forward integral aligned
with the UI's vol-display math: ``sqrt(Σ_t total_market_fair / T_years)``
returns exactly ``total_vol``. Without it a user-set 30-point marketVol
would read as ``30 × sqrt(365) ≈ 573`` on the grid.

User-set per-space values take precedence: each user-set space uses its
own ``space_vol² × T_years``. The remainder flows to the remaining spaces.
"""

from __future__ import annotations

import datetime as _dt
from collections import defaultdict

import polars as pl

from server.api.expiry import canonical_expiry_key
from server.core.config import SECONDS_PER_YEAR
from server.core.transforms.registry import transform


def _space_aggregate(
    block_var_df: pl.DataFrame,
    space_group_keys: list[str],
) -> pl.DataFrame:
    """Collapse per-block fair/var to per-space per-timestamp rows."""
    return block_var_df.group_by(space_group_keys).agg(
        pl.col("fair").sum().alias("space_fair"),
        pl.col("var").sum().alias("space_var"),
    ).sort(space_group_keys)


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
           description="Per-space market_fair(t) proportional to space_fair(t). "
                       "Default is edge-zero; aggregate total_vol distributes across "
                       "inferable spaces preserving Σ market_fair = total_vol² × T_years.")
def mvi_time_varying_proportional(
    block_var_df: pl.DataFrame,
    risk_dimension_cols: list[str],
    aggregate_market_values: dict[tuple[str, str], float],
    space_market_values: dict[tuple[str, str, str], float],
    now: _dt.datetime,
) -> pl.DataFrame:
    if block_var_df.is_empty():
        return pl.DataFrame()

    space_group_keys = risk_dimension_cols + ["space_id", "timestamp"]
    space_df = _space_aggregate(block_var_df, space_group_keys)

    # Fast path: no user input anywhere → default market_fair = fair → edge=0.
    if not aggregate_market_values and not space_market_values:
        return space_df.with_columns(
            pl.col("space_fair").alias("space_market_fair"),
        )

    # Per-space forward-integrated fair — the denominator for proportional
    # allocation and the invariant target for user/aggregate variance.
    space_integral_df = space_df.group_by(
        risk_dimension_cols + ["space_id"],
    ).agg(
        pl.col("space_fair").sum().alias("_space_fair_integral"),
    )

    # Group spaces by (symbol, expiry_canonical) so we can reconcile each
    # group against its aggregate entry.
    rd_groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in space_integral_df.iter_rows(named=True):
        rd_key = tuple(row[c] for c in risk_dimension_cols)
        rd_groups[rd_key].append({
            "space_id": row["space_id"],
            "integral": row["_space_fair_integral"],
        })

    multipliers: dict[tuple, float] = {}

    for rd_key, entries in rd_groups.items():
        # Expect ``risk_dimension_cols == ["symbol", "expiry"]`` — the
        # pipeline default. The aggregate + space stores key on
        # ``(symbol, canonical_expiry_key)`` so we canonicalise expiry here.
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

        # User-set spaces: shape market_fair(t) so Σ_t = user_var × T_years.
        for e in user_space_entries:
            key = rd_key + (e["space_id"],)
            multipliers[key] = (
                e["user_var_target"] / e["integral"] if e["integral"] != 0 else 0.0
            )

        # Inferable spaces: edge-zero default unless aggregate is set.
        if aggregate_var_target is None:
            for e in inferable_entries:
                multipliers[rd_key + (e["space_id"],)] = 1.0
            continue

        user_contribution = sum(e["user_var_target"] for e in user_space_entries)
        remainder = aggregate_var_target - user_contribution
        inf_total = sum(e["integral"] for e in inferable_entries)

        # No inferable capacity → leave them at edge-zero default. Resulting
        # Σ_t sits at ``user_contribution`` rather than the aggregate; the UI
        # mismatch surface tells the trader to add a compatible space.
        if inf_total == 0 or not inferable_entries:
            for e in inferable_entries:
                multipliers[rd_key + (e["space_id"],)] = 1.0
            continue

        mult = remainder / inf_total
        for e in inferable_entries:
            multipliers[rd_key + (e["space_id"],)] = mult

    if not multipliers:
        return space_df.with_columns(
            pl.col("space_fair").alias("space_market_fair"),
        )

    # Join multipliers back to the per-timestamp space frame.
    mult_rows = []
    for key, m in multipliers.items():
        row: dict = {}
        for i, c in enumerate(risk_dimension_cols):
            row[c] = key[i]
        row["space_id"] = key[len(risk_dimension_cols)]
        row["_multiplier"] = m
        mult_rows.append(row)

    mult_df = pl.DataFrame(mult_rows)
    for c in risk_dimension_cols:
        mult_df = mult_df.with_columns(pl.col(c).cast(space_df.schema[c]))
    mult_df = mult_df.with_columns(pl.col("space_id").cast(space_df.schema["space_id"]))

    return (
        space_df.join(
            mult_df, on=risk_dimension_cols + ["space_id"], how="left",
        )
        .with_columns(pl.col("_multiplier").fill_null(1.0))
        .with_columns(
            (pl.col("space_fair") * pl.col("_multiplier")).alias("space_market_fair"),
        )
        .drop("_multiplier")
        .sort(space_group_keys)
    )


@transform("market_value_inference", "passthrough",
           description="No inference — space_market_fair defaults to space_fair (zero edge).")
def mvi_passthrough(
    block_var_df: pl.DataFrame,
    risk_dimension_cols: list[str],
    aggregate_market_values: dict[tuple[str, str], float],
    space_market_values: dict[tuple[str, str, str], float],
    now: _dt.datetime,
) -> pl.DataFrame:
    if block_var_df.is_empty():
        return pl.DataFrame()
    space_group_keys = risk_dimension_cols + ["space_id", "timestamp"]
    return _space_aggregate(block_var_df, space_group_keys).with_columns(
        pl.col("space_fair").alias("space_market_fair"),
    )
