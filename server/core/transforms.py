"""
Transform registry and implementations.

Single-file replacement for the transforms/ package.  Contains:
  1. Registry infrastructure (TransformParam, TransformRegistration, StepLibrary)
  2. Step definitions (7 pipeline steps)
  3. All transform function implementations
"""

from __future__ import annotations

import datetime as dt
import inspect
from dataclasses import dataclass
from typing import Any, Callable, Literal, get_args, get_origin

import polars as pl

from server.core.config import SECONDS_PER_YEAR
from server.core.helpers import annualize, deannualize


# ═══════════════════════════════════════════════════════════════════════════════
# Registry infrastructure
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class TransformParam:
    """Schema for a single user-configurable parameter."""

    name: str
    type: Literal["float", "int", "bool", "str"]
    default: Any
    description: str = ""
    min: float | None = None
    max: float | None = None
    options: list[str] | None = None


@dataclass
class TransformRegistration:
    """A registered transform function with its parameter schema."""

    name: str
    step: str
    fn: Callable
    description: str
    params: list[TransformParam]
    # Optional symbolic form, e.g. "P = E·B / (γ·V)". Consumed by the UI's
    # LiveEquationStrip to render whichever position_sizing transform is
    # currently active without hand-coding templates on the client.
    formula: str = ""


# ---------------------------------------------------------------------------
# Param introspection
# ---------------------------------------------------------------------------

_PYTHON_TYPE_MAP: dict[type, str] = {
    float: "float", int: "int", bool: "bool", str: "str",
}


def _introspect_params(
    fn: Callable,
    infrastructure_params: list[str],
    param_overrides: dict[str, dict] | None = None,
) -> list[TransformParam]:
    """Build TransformParam list from a function's signature.

    Parameters in *infrastructure_params* are excluded (pipeline-provided).
    """
    sig = inspect.signature(fn)
    overrides = param_overrides or {}
    params: list[TransformParam] = []

    for pname, p in sig.parameters.items():
        if pname in infrastructure_params:
            continue
        annotation = p.annotation
        type_str = "float"
        if annotation is not inspect.Parameter.empty:
            if get_origin(annotation) is Literal:
                type_str = "str"
            elif annotation in _PYTHON_TYPE_MAP:
                type_str = _PYTHON_TYPE_MAP[annotation]

        default = p.default if p.default is not inspect.Parameter.empty else None
        options = list(get_args(annotation)) if get_origin(annotation) is Literal else None
        ov = overrides.get(pname, {})
        params.append(TransformParam(
            name=pname,
            type=ov.get("type", type_str),
            default=ov.get("default", default),
            description=ov.get("description", ""),
            min=ov.get("min"),
            max=ov.get("max"),
            options=ov.get("options", options),
        ))

    return params


# ---------------------------------------------------------------------------
# StepLibrary
# ---------------------------------------------------------------------------


class StepLibrary:
    """Library of transforms for a single pipeline step."""

    def __init__(self, step: str, contract_doc: str, infrastructure_params: list[str]) -> None:
        self.step = step
        self.contract_doc = contract_doc
        self.infrastructure_params = infrastructure_params
        self._transforms: dict[str, TransformRegistration] = {}
        self._selected: str | None = None
        self._param_values: dict[str, Any] = {}

    def register(self, name: str, fn: Callable, *, description: str = "",
                 formula: str = "",
                 param_overrides: dict[str, dict] | None = None) -> None:
        params = _introspect_params(fn, self.infrastructure_params, param_overrides)
        self._transforms[name] = TransformRegistration(
            name=name, step=self.step, fn=fn, description=description,
            params=params, formula=formula,
        )
        if self._selected is None:
            self._selected = name

    def select(self, name: str) -> None:
        if name not in self._transforms:
            raise ValueError(
                f"Step '{self.step}' has no transform '{name}'. "
                f"Available: {', '.join(self._transforms)}"
            )
        self._selected = name
        self._param_values = {}

    def get_selected(self) -> TransformRegistration:
        if self._selected is None:
            raise RuntimeError(f"Step '{self.step}' has no transforms registered")
        return self._transforms[self._selected]

    def get_param_values(self) -> dict[str, Any]:
        selected = self.get_selected()
        return {p.name: self._param_values.get(p.name, p.default) for p in selected.params}

    def set_param_values(self, params: dict[str, Any]) -> None:
        self._param_values.update(params)

    def list_transforms(self) -> list[TransformRegistration]:
        return list(self._transforms.values())


# ---------------------------------------------------------------------------
# Module-level registry (replaces TransformRegistry class)
# ---------------------------------------------------------------------------

_steps: dict[str, StepLibrary] = {}


def _define_step(step: str, *, contract_doc: str, infrastructure_params: list[str]) -> StepLibrary:
    lib = StepLibrary(step, contract_doc, infrastructure_params)
    _steps[step] = lib
    return lib


def get_step(step: str) -> StepLibrary:
    if step not in _steps:
        raise KeyError(f"No step '{step}' defined")
    return _steps[step]


def list_steps() -> list[str]:
    return list(_steps.keys())


def to_dict() -> dict[str, Any]:
    """Serialize current selections + param overrides."""
    out: dict[str, Any] = {}
    for name, lib in _steps.items():
        if lib._selected is not None:
            out[name] = lib._selected
        if lib._param_values:
            out[f"{name}_params"] = dict(lib._param_values)
    return out


def from_dict(config: dict[str, Any]) -> None:
    """Restore selections + param overrides from a config dict.

    Always resets to defaults first, then applies overrides.
    """
    for name, lib in _steps.items():
        # Reset to default (first registered transform)
        first = next(iter(lib._transforms))
        lib._selected = first
        lib._param_values = {}
        # Apply overrides
        if name in config:
            lib.select(config[name])
        pk = f"{name}_params"
        if pk in config and config[pk]:
            lib.set_param_values(config[pk])


class _RegistryProxy:
    """Lightweight proxy so get_registry() returns an object with the expected API."""
    get_step = staticmethod(get_step)
    list_steps = staticmethod(list_steps)
    to_dict = staticmethod(to_dict)
    from_dict = staticmethod(from_dict)


_proxy = _RegistryProxy()


def get_registry() -> _RegistryProxy:
    """Return a proxy with the same interface as the old TransformRegistry."""
    return _proxy


# ---------------------------------------------------------------------------
# @transform decorator
# ---------------------------------------------------------------------------


def transform(step: str, name: str, *, description: str = "",
              formula: str = "",
              param_overrides: dict[str, dict] | None = None) -> Callable:
    """Register a function into a step's library.

    `formula` is an optional symbolic form (e.g. "P = E·B / V") that the UI
    renders when this transform is the active implementation.
    """
    def wrapper(fn: Callable) -> Callable:
        get_step(step).register(
            name, fn, description=description, formula=formula,
            param_overrides=param_overrides,
        )
        return fn
    return wrapper


# ═══════════════════════════════════════════════════════════════════════════════
# Step definitions
# ═══════════════════════════════════════════════════════════════════════════════

_define_step("unit_conversion",
             contract_doc="(col: str, **params) -> pl.Expr",
             infrastructure_params=["col"])

_define_step("decay_profile",
             contract_doc="(progress: pl.Expr, end_mult: float, **params) -> pl.Expr",
             infrastructure_params=["progress", "end_mult"])

_define_step("temporal_fair_value",
             contract_doc="(blocks_df, time_grid, risk_dimension_cols, now, decay_fn, **params) -> pl.DataFrame",
             infrastructure_params=["blocks_df", "time_grid", "risk_dimension_cols", "now", "decay_fn"])

_define_step("variance",
             contract_doc="(block_fair_df: pl.DataFrame, **params) -> pl.DataFrame",
             infrastructure_params=["block_fair_df"])

_define_step("aggregation",
             contract_doc="(block_df, risk_dimension_cols, **params) -> pl.DataFrame",
             infrastructure_params=["block_df", "risk_dimension_cols"])

_define_step("position_sizing",
             contract_doc="(edge: pl.Expr, var: pl.Expr, bankroll: float, **params) -> pl.Expr",
             infrastructure_params=["edge", "var", "bankroll"])

_define_step("smoothing",
             contract_doc="(agg_df, risk_dimension_cols, **params) -> pl.DataFrame",
             infrastructure_params=["agg_df", "risk_dimension_cols"])


# ═══════════════════════════════════════════════════════════════════════════════
# Transform implementations
# ═══════════════════════════════════════════════════════════════════════════════


# ---------------------------------------------------------------------------
# unit_conversion
# ---------------------------------------------------------------------------

@transform("unit_conversion", "affine_power",
           description="(scale * raw + offset) ^ exponent",
           param_overrides={
               "scale": {"description": "Multiplicative scale factor"},
               "offset": {"description": "Additive offset before exponentiation"},
               "exponent": {"description": "Power exponent"},
           })
def affine_power(col: str, scale: float = 1.0, offset: float = 0.0, exponent: float = 1.0) -> pl.Expr:
    return (scale * pl.col(col) + offset).pow(exponent)


@transform("unit_conversion", "log_scale",
           description="scale * ln(raw + shift) + offset",
           param_overrides={
               "scale": {"description": "Multiplicative scale factor"},
               "offset": {"description": "Additive offset after log"},
               "shift": {"description": "Additive shift before log (must be > 0)", "min": 0.001},
           })
def log_scale(col: str, scale: float = 1.0, offset: float = 0.0, shift: float = 1.0) -> pl.Expr:
    return scale * (pl.col(col) + shift).log() + offset


# ---------------------------------------------------------------------------
# decay_profile
# ---------------------------------------------------------------------------

@transform("decay_profile", "linear",
           description="Linear remaining value: D(p) = 1 - p*(1 - end_mult) → constant annualized rate")
def decay_linear(progress: pl.Expr, end_mult: float) -> pl.Expr:
    return 1.0 - progress * (1.0 - end_mult)


@transform("decay_profile", "exponential",
           description="Exponential remaining value: D(p) = end_mult + (1-end_mult)*exp(-λp)",
           param_overrides={
               "lam": {"description": "Decay rate (higher = faster initial decay)", "min": 0.1},
           })
def decay_exponential(progress: pl.Expr, end_mult: float, lam: float = 3.0) -> pl.Expr:
    return end_mult + (1.0 - end_mult) * (-lam * progress).exp()


@transform("decay_profile", "sigmoid",
           description="Sigmoid remaining value: S-curve from 1 to end_mult",
           param_overrides={
               "midpoint": {"description": "Steepest transition point", "min": 0.01, "max": 0.99},
               "steepness": {"description": "Transition sharpness", "min": 1.0},
           })
def decay_sigmoid(progress: pl.Expr, end_mult: float,
                  midpoint: float = 0.5, steepness: float = 10.0) -> pl.Expr:
    raw_sig = 1.0 / (1.0 + (steepness * (progress - midpoint)).exp())
    sig_0 = 1.0 / (1.0 + pl.lit(-steepness * midpoint).exp())
    sig_1 = 1.0 / (1.0 + pl.lit(steepness * (1.0 - midpoint)).exp())
    normalized = (raw_sig - sig_1) / (sig_0 - sig_1)
    return end_mult + (1.0 - end_mult) * normalized


@transform("decay_profile", "step",
           description="Step function: instant drop from 1 to end_mult at threshold",
           param_overrides={
               "threshold": {"description": "Progress point for the drop", "min": 0.01, "max": 0.99},
           })
def decay_step(progress: pl.Expr, end_mult: float, threshold: float = 0.5) -> pl.Expr:
    return pl.when(progress < threshold).then(1.0).otherwise(end_mult)


# ---------------------------------------------------------------------------
# temporal_fair_value  (helpers + implementations)
# ---------------------------------------------------------------------------

def _get_end_timestamp(
    start_ts: dt.datetime, expiry: dt.datetime,
    decay_end_size_mult: float, decay_rate_prop_per_min: float,
) -> dt.datetime:
    if decay_end_size_mult == 1 or decay_rate_prop_per_min == 0:
        return expiry
    return start_ts + dt.timedelta(minutes=1 / decay_rate_prop_per_min)


def _get_total_value(
    stream_value: float, market_value: float,
    start_ts: dt.datetime, end_ts: dt.datetime,
    is_annualized: bool, size_type: str,
) -> float:
    if is_annualized:
        ann_val = stream_value if size_type == "fixed" else stream_value - market_value
        return deannualize(ann_val, (end_ts - start_ts).total_seconds())
    return stream_value


def _get_start_annualized_value(
    total_value: float, expiry: dt.datetime,
    start_ts: dt.datetime, end_ts: dt.datetime,
    end_annualized_value: float, is_annualized: bool,
) -> float:
    start_to_expiry_secs = (expiry - start_ts).total_seconds()
    start_to_end_secs = (end_ts - start_ts).total_seconds()
    ann_val = annualize(total_value, start_to_end_secs)
    if is_annualized:
        start_to_end_secs = min(start_to_expiry_secs, start_to_end_secs)
        p = start_to_end_secs / start_to_expiry_secs
        return (2 / p) * (ann_val - (1 - p) * end_annualized_value) - end_annualized_value
    return ann_val


@transform("temporal_fair_value", "standard",
           description="Original analytical: linear interpolation of annualized rate, preserves total value integral")
def fv_standard(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
    decay_fn: TransformRegistration,
) -> pl.DataFrame:
    """Exact port of the original compute_block_fair_values logic."""
    parts: list[pl.DataFrame] = []

    for row in blocks_df.iter_rows(named=True):
        block_name = row["block_name"]
        is_ann = row["annualized"]
        expiry = row["expiry"]
        start_ts = now if row["temporal_position"] == "shifting" else row["start_timestamp"]
        end_ts = _get_end_timestamp(
            start_ts, expiry, row["decay_end_size_mult"], row["decay_rate_prop_per_min"],
        )

        target_val = row["target_value"]
        target_mkt = row["target_market_value"]

        total_val = _get_total_value(target_val, target_mkt, start_ts, end_ts, is_ann, row["size_type"])
        dur_secs = (end_ts - start_ts).total_seconds()
        end_ann = annualize(total_val, dur_secs) * row["decay_end_size_mult"]
        start_ann = _get_start_annualized_value(total_val, expiry, start_ts, end_ts, end_ann, is_ann)

        mkt_total = _get_total_value(target_mkt, target_mkt, start_ts, end_ts, is_ann, row["size_type"])
        mkt_end_ann = annualize(mkt_total, dur_secs) * row["decay_end_size_mult"]
        mkt_start_ann = _get_start_annualized_value(mkt_total, expiry, start_ts, end_ts, mkt_end_ann, is_ann)

        grid_filter = time_grid
        for rdc in risk_dimension_cols:
            grid_filter = grid_filter.filter(pl.col(rdc) == row[rdc])

        block_df = grid_filter.select(risk_dimension_cols + ["timestamp", "dtte"]).with_columns(
            (
                pl.when(pl.col("timestamp") < start_ts).then(0.0)
                .when(pl.col("timestamp") > end_ts).then(end_ann)
                .when(pl.lit(is_ann)).then(
                    start_ann + (end_ann - start_ann)
                    * (pl.col("timestamp") - start_ts) / (end_ts - start_ts)
                )
                .otherwise(start_ann)
            ).alias("fair_annualized"),
            (
                pl.when(pl.col("timestamp") < start_ts).then(0.0)
                .when(pl.col("timestamp") > end_ts).then(mkt_end_ann)
                .when(pl.lit(is_ann)).then(
                    mkt_start_ann + (mkt_end_ann - mkt_start_ann)
                    * (pl.col("timestamp") - start_ts) / (end_ts - start_ts)
                )
                .otherwise(mkt_start_ann)
            ).alias("market_fair_annualized"),
            pl.lit(block_name).alias("block_name"),
            pl.lit(row["stream_name"]).alias("stream_name"),
            pl.lit(row["space_id"]).alias("space_id"),
            pl.lit(row["aggregation_logic"]).alias("aggregation_logic"),
            pl.lit(row["var_fair_ratio"]).alias("var_fair_ratio"),
        ).with_columns(
            (pl.col("fair_annualized") * pl.col("dtte")).alias("fair"),
            (pl.col("market_fair_annualized") * pl.col("dtte")).alias("market_fair"),
        )

        parts.append(block_df)

    return pl.concat(parts)


@transform("temporal_fair_value", "flat_forward",
           description="Constant annualized value throughout block lifetime (no decay shape)")
def fv_flat_forward(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
    decay_fn: TransformRegistration,
) -> pl.DataFrame:
    parts: list[pl.DataFrame] = []

    for row in blocks_df.iter_rows(named=True):
        block_name = row["block_name"]
        is_ann = row["annualized"]
        expiry = row["expiry"]
        start_ts = now if row["temporal_position"] == "shifting" else row["start_timestamp"]
        target_val = row["target_value"]
        target_mkt = row["target_market_value"]

        if is_ann:
            fair_ann = target_val if row["size_type"] == "fixed" else target_val - target_mkt
            mkt_fair_ann = target_mkt if row["size_type"] == "fixed" else 0.0
        else:
            remaining = (expiry - start_ts).total_seconds()
            fair_ann = annualize(target_val, remaining) if remaining > 0 else 0.0
            mkt_fair_ann = annualize(target_mkt, remaining) if remaining > 0 else 0.0

        grid_filter = time_grid
        for rdc in risk_dimension_cols:
            grid_filter = grid_filter.filter(pl.col(rdc) == row[rdc])

        block_df = grid_filter.select(risk_dimension_cols + ["timestamp", "dtte"]).with_columns(
            pl.when(pl.col("timestamp") < start_ts).then(0.0)
            .otherwise(fair_ann).alias("fair_annualized"),
            pl.when(pl.col("timestamp") < start_ts).then(0.0)
            .otherwise(mkt_fair_ann).alias("market_fair_annualized"),
            pl.lit(block_name).alias("block_name"),
            pl.lit(row["stream_name"]).alias("stream_name"),
            pl.lit(row["space_id"]).alias("space_id"),
            pl.lit(row["aggregation_logic"]).alias("aggregation_logic"),
            pl.lit(row["var_fair_ratio"]).alias("var_fair_ratio"),
        ).with_columns(
            (pl.col("fair_annualized") * pl.col("dtte")).alias("fair"),
            (pl.col("market_fair_annualized") * pl.col("dtte")).alias("market_fair"),
        )

        parts.append(block_df)

    return pl.concat(parts)


# ---------------------------------------------------------------------------
# variance
# ---------------------------------------------------------------------------

@transform("variance", "fair_proportional",
           description="var = |fair| * var_fair_ratio (proportional to fair value magnitude)")
def var_fair_proportional(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(
        (pl.col("fair").abs() * pl.col("var_fair_ratio")).alias("var"),
    )


@transform("variance", "constant",
           description="var = var_fair_ratio as absolute variance value (ignores fair magnitude)")
def var_constant(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(pl.col("var_fair_ratio").alias("var"))


@transform("variance", "squared_fair",
           description="var = fair² * var_fair_ratio (quadratic scaling with fair value)")
def var_squared_fair(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(
        (pl.col("fair").pow(2) * pl.col("var_fair_ratio")).alias("var"),
    )


# ---------------------------------------------------------------------------
# aggregation
# ---------------------------------------------------------------------------

@transform("aggregation", "average_offset",
           description="'average' blocks → mean fair, 'offset' blocks → sum fair, variances always sum")
def agg_average_offset(block_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    group_keys = risk_dimension_cols + ["timestamp", "space_id"]

    avg_df = block_df.filter(pl.col("aggregation_logic") == "average")
    off_df = block_df.filter(pl.col("aggregation_logic") == "offset")

    if avg_df.height > 0:
        avg_agg = avg_df.group_by(group_keys).agg(
            pl.col("fair").mean().alias("avg_fair"),
            pl.col("market_fair").mean().alias("avg_market_fair"),
        )
    else:
        schema = {c: block_df.schema[c] for c in group_keys}
        schema.update({"avg_fair": pl.Float64, "avg_market_fair": pl.Float64})
        avg_agg = pl.DataFrame(schema=schema)

    if off_df.height > 0:
        off_agg = off_df.group_by(group_keys).agg(
            pl.col("fair").sum().alias("off_fair"),
            pl.col("market_fair").sum().alias("off_market_fair"),
        )
    else:
        schema = {c: block_df.schema[c] for c in group_keys}
        schema.update({"off_fair": pl.Float64, "off_market_fair": pl.Float64})
        off_agg = pl.DataFrame(schema=schema)

    var_agg = block_df.group_by(group_keys).agg(
        pl.col("var").sum().alias("space_var"),
    )

    space_df = (
        var_agg.join(avg_agg, on=group_keys, how="left")
        .join(off_agg, on=group_keys, how="left")
        .with_columns(
            pl.col("avg_fair").fill_null(0.0),
            pl.col("avg_market_fair").fill_null(0.0),
            pl.col("off_fair").fill_null(0.0),
            pl.col("off_market_fair").fill_null(0.0),
        )
        .with_columns(
            (pl.col("avg_fair") + pl.col("off_fair")).alias("space_fair"),
            (pl.col("avg_market_fair") + pl.col("off_market_fair")).alias("space_market_fair"),
        )
        .with_columns(
            (pl.col("space_fair") - pl.col("space_market_fair")).alias("space_edge"),
        )
    )

    rd_ts = risk_dimension_cols + ["timestamp"]
    return space_df.group_by(rd_ts).agg(
        pl.col("space_fair").sum().alias("total_fair"),
        pl.col("space_market_fair").sum().alias("total_market_fair"),
        pl.col("space_edge").sum().alias("edge"),
        pl.col("space_var").sum().alias("var"),
    ).sort(rd_ts)


@transform("aggregation", "weighted",
           description="Inverse-variance weighted combination of blocks within each space")
def agg_weighted(block_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    group_keys = risk_dimension_cols + ["timestamp", "space_id"]

    weighted_df = block_df.with_columns(
        pl.when(pl.col("var") > 0).then(1.0 / pl.col("var")).otherwise(1.0).alias("_w"),
    )

    space_agg = (
        weighted_df.group_by(group_keys).agg(
            (pl.col("fair") * pl.col("_w")).sum().alias("_wf"),
            (pl.col("market_fair") * pl.col("_w")).sum().alias("_wmf"),
            pl.col("_w").sum().alias("_tw"),
            pl.col("var").sum().alias("space_var"),
        )
        .with_columns(
            (pl.col("_wf") / pl.col("_tw")).alias("space_fair"),
            (pl.col("_wmf") / pl.col("_tw")).alias("space_market_fair"),
        )
        .with_columns(
            (pl.col("space_fair") - pl.col("space_market_fair")).alias("space_edge"),
        )
    )

    rd_ts = risk_dimension_cols + ["timestamp"]
    return space_agg.group_by(rd_ts).agg(
        pl.col("space_fair").sum().alias("total_fair"),
        pl.col("space_market_fair").sum().alias("total_market_fair"),
        pl.col("space_edge").sum().alias("edge"),
        pl.col("space_var").sum().alias("var"),
    ).sort(rd_ts)


@transform("aggregation", "sum_all",
           description="Sum all blocks regardless of aggregation_logic")
def agg_sum_all(block_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    group_keys = risk_dimension_cols + ["timestamp", "space_id"]

    space_agg = block_df.group_by(group_keys).agg(
        pl.col("fair").sum().alias("space_fair"),
        pl.col("market_fair").sum().alias("space_market_fair"),
        pl.col("var").sum().alias("space_var"),
    ).with_columns(
        (pl.col("space_fair") - pl.col("space_market_fair")).alias("space_edge"),
    )

    rd_ts = risk_dimension_cols + ["timestamp"]
    return space_agg.group_by(rd_ts).agg(
        pl.col("space_fair").sum().alias("total_fair"),
        pl.col("space_market_fair").sum().alias("total_market_fair"),
        pl.col("space_edge").sum().alias("edge"),
        pl.col("space_var").sum().alias("var"),
    ).sort(rd_ts)


# ---------------------------------------------------------------------------
# position_sizing
# ---------------------------------------------------------------------------

@transform("position_sizing", "kelly",
           description="Kelly criterion (log utility): position = edge * bankroll / var",
           formula="P = E·B / V")
def ps_kelly(edge: pl.Expr, var: pl.Expr, bankroll: float) -> pl.Expr:
    return edge * bankroll / var


@transform("position_sizing", "power_utility",
           description="CRRA power utility: nonlinear position sizing for risk_aversion ≠ 1",
           formula="P = E·B / (γ·V)",
           param_overrides={
               "risk_aversion": {
                   "description": "CRRA risk aversion coefficient γ (γ=1 is Kelly/log utility)",
                   "min": 0.1,
               },
           })
def ps_power_utility(edge: pl.Expr, var: pl.Expr, bankroll: float,
                     risk_aversion: float = 2.0) -> pl.Expr:
    return edge * bankroll / (risk_aversion * var)


# ---------------------------------------------------------------------------
# smoothing
# ---------------------------------------------------------------------------

@transform("smoothing", "forward_ewm",
           description="Forward-looking EWM: reverse → ewm_mean_by → reverse",
           param_overrides={
               "half_life_secs": {"description": "EWM half-life in seconds", "min": 1},
           })
def smooth_forward_ewm(agg_df: pl.DataFrame, risk_dimension_cols: list[str],
                       half_life_secs: int = 1800) -> pl.DataFrame:
    hl = f"{half_life_secs}s"
    return agg_df.sort(risk_dimension_cols + ["timestamp"]).with_columns(
        pl.col("edge")
        .reverse().ewm_mean_by("timestamp", half_life=hl).reverse()
        .over(risk_dimension_cols).alias("smoothed_edge"),
        pl.col("var")
        .reverse().ewm_mean_by("timestamp", half_life=hl).reverse()
        .over(risk_dimension_cols).alias("smoothed_var"),
    )


@transform("smoothing", "no_smoothing",
           description="No smoothing: smoothed values equal raw values")
def smooth_none(agg_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    return agg_df.with_columns(
        pl.col("edge").alias("smoothed_edge"),
        pl.col("var").alias("smoothed_var"),
    )


@transform("smoothing", "forward_rolling_mean",
           description="Forward-looking rolling mean: reverse → rolling_mean → reverse",
           param_overrides={
               "window_size": {"description": "Rolling window size (grid points)", "min": 2, "max": 500},
           })
def smooth_rolling(agg_df: pl.DataFrame, risk_dimension_cols: list[str],
                   window_size: int = 30) -> pl.DataFrame:
    return agg_df.sort(risk_dimension_cols + ["timestamp"]).with_columns(
        pl.col("edge")
        .reverse().rolling_mean(window_size=window_size, min_periods=1).reverse()
        .over(risk_dimension_cols).alias("smoothed_edge"),
        pl.col("var")
        .reverse().rolling_mean(window_size=window_size, min_periods=1).reverse()
        .over(risk_dimension_cols).alias("smoothed_var"),
    )
