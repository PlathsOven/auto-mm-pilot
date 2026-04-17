"""Market-value-inference transforms — distribute an aggregate total_vol across blocks."""

from __future__ import annotations

import datetime as _dt
from collections import defaultdict

import polars as pl

from server.core.transforms.registry import TransformRegistration, transform


@transform("market_value_inference", "total_vol_proportional",
           description="Distribute aggregate total vol to blocks proportional to |target_value|")
def mvi_total_vol_proportional(
    blocks_df: pl.DataFrame,
    aggregate_market_values: dict[tuple[str, str], float],
    unit_fn: TransformRegistration,
) -> pl.DataFrame:
    """Proportional variance allocation from aggregate total vol.

    For each (symbol, expiry) where the user has set an aggregate total_vol:
      1. aggregate_var = total_vol²
      2. user_var_sum = sum of |target_market_value| for blocks with has_user_market_value=True
      3. remainder_var = max(0, aggregate_var - user_var_sum)
      4. For blocks without user market_value: weight by |target_value| / total_raw_var
      5. Inferred target_market_value = sign(target_value) * remainder_var * weight
      6. Reverse unit conversion to get market_value in raw units

    Blocks without an aggregate AND without user-defined market_value keep
    market_value = raw_value (the default set by build_blocks_df).
    """
    if not aggregate_market_values or "has_user_market_value" not in blocks_df.columns:
        return blocks_df

    rows = blocks_df.to_dicts()
    modified = False

    dim_groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        exp = row["expiry"]
        exp_str = exp.isoformat() if isinstance(exp, _dt.datetime) else str(exp)
        dim_groups[(row["symbol"], exp_str)].append(i)

    for (symbol, expiry_str), indices in dim_groups.items():
        if (symbol, expiry_str) not in aggregate_market_values:
            continue

        total_vol = aggregate_market_values[(symbol, expiry_str)]
        aggregate_var = total_vol ** 2

        user_indices = [i for i in indices if rows[i]["has_user_market_value"]]
        infer_indices = [i for i in indices if not rows[i]["has_user_market_value"]]

        if not infer_indices:
            continue

        user_var_sum = sum(abs(rows[i]["target_market_value"]) for i in user_indices)
        remainder_var = max(0.0, aggregate_var - user_var_sum)

        raw_vars = [abs(rows[i]["target_value"]) for i in infer_indices]
        total_raw_var = sum(raw_vars)

        for j, idx in enumerate(infer_indices):
            weight = raw_vars[j] / total_raw_var if total_raw_var > 0 else 0.0
            tv = rows[idx]["target_value"]
            sign = 1.0 if tv >= 0 else -1.0
            inferred_tmv = sign * remainder_var * weight

            # Reverse unit conversion: raw = ((target)^(1/exponent) - offset) / scale
            scale = rows[idx]["scale"]
            offset = rows[idx]["offset"]
            exponent = rows[idx]["exponent"]
            if exponent != 0:
                abs_tmv = abs(inferred_tmv)
                raw_abs = (abs_tmv ** (1.0 / exponent) - offset) / scale if scale != 0 else 0.0
                inferred_mv = sign * raw_abs
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
) -> pl.DataFrame:
    return blocks_df
