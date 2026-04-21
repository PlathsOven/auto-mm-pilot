"""Transform configuration endpoints — scoped to the calling user.

Note: the underlying ``server.core.transforms`` registry is shared process-
wide (mutating its ``.selected`` / ``.params`` is how transform selections
are validated). The pipeline rerun uses the caller's per-user
``transform_config``, so pipeline math stays isolated — only the ``GET``
response can reflect another user's most recent patch. Documented v1
trade-off; revisit when transforms gain true per-user persistence.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.engine_state import rerun_and_broadcast, set_transform_config
from server.api.models import (
    TransformConfigRequest,
    TransformListResponse,
    TransformParamResponse,
    TransformResponse,
    TransformStepResponse,
)
from server.api.stream_registry import get_stream_registry
from server.core.transforms import get_registry

log = logging.getLogger(__name__)

router = APIRouter()

_STEP_LABELS = {
    "unit_conversion": "Unit Conversion",
    "decay_profile": "Decay Profile",
    "temporal_fair_value": "Temporal Fair Value",
    "variance": "Variance Calculation",
    "risk_space_aggregation": "Risk-Space Aggregation",
    "aggregation": "Space Aggregation",
    "calc_to_target": "Calc → Target Map",
    "position_sizing": "Position Sizing",
    "smoothing": "Position Smoothing",
    "market_value_inference": "Market Value Inference",
}


def _list_transforms_response() -> TransformListResponse:
    registry = get_registry()
    steps: dict[str, TransformStepResponse] = {}

    for step_name in registry.list_steps():
        lib = registry.get_step(step_name)
        selected = lib.get_selected()
        param_values = lib.get_param_values()

        transforms = []
        for t in lib.list_transforms():
            transforms.append(TransformResponse(
                name=t.name,
                description=t.description,
                formula=t.formula,
                params=[
                    TransformParamResponse(
                        name=p.name,
                        type=p.type,
                        default=p.default,
                        description=p.description,
                        min=p.min,
                        max=p.max,
                        options=p.options,
                    )
                    for p in t.params
                ],
            ))

        steps[step_name] = TransformStepResponse(
            label=_STEP_LABELS.get(step_name, step_name),
            contract=lib.contract_doc,
            selected=selected.name,
            params=param_values,
            transforms=transforms,
        )

    return TransformListResponse(steps=steps)


@router.get("/api/transforms", response_model=TransformListResponse)
async def list_transforms(
    _user: User = Depends(current_user),
) -> TransformListResponse:
    return _list_transforms_response()


@router.patch("/api/transforms", response_model=TransformListResponse)
async def update_transforms(
    req: TransformConfigRequest,
    user: User = Depends(current_user),
) -> TransformListResponse:
    registry = get_registry()

    config: dict[str, Any] = {}
    for step_name in registry.list_steps():
        selection = getattr(req, step_name, None)
        if selection is not None:
            try:
                registry.get_step(step_name).select(selection)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            config[step_name] = selection

        params = getattr(req, f"{step_name}_params", None)
        if params is not None:
            registry.get_step(step_name).set_param_values(params)
            config[f"{step_name}_params"] = params

    full_config = registry.to_dict()
    set_transform_config(user.id, full_config)

    stream_registry = get_stream_registry(user.id)
    stream_configs = stream_registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(user.id, stream_configs, transform_config=full_config)
        except Exception as exc:
            log.exception("Pipeline re-run failed after transform config update")
            raise HTTPException(
                status_code=500,
                detail=f"Config updated but pipeline re-run failed: {exc}",
            ) from exc

    return _list_transforms_response()
