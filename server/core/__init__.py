"""
server.core — Core pipeline module.

Re-exports the public API so consumers can do:
    from server.core import run_pipeline, StreamConfig, BlockConfig, ...
"""

from server.core.config import SECONDS_PER_YEAR, BlockConfig, StreamConfig
from server.core.helpers import annualize, deannualize
from server.core.pipeline import run_pipeline
from server.core.serializers import engine_state_from_pipeline, snapshot_from_pipeline
from server.core.transforms import (
    TransformParam,
    TransformRegistration,
    StepLibrary,
    get_registry,
)

__all__ = [
    "SECONDS_PER_YEAR",
    "BlockConfig",
    "StreamConfig",
    "annualize",
    "deannualize",
    "run_pipeline",
    "snapshot_from_pipeline",
    "engine_state_from_pipeline",
    "TransformParam",
    "TransformRegistration",
    "StepLibrary",
    "get_registry",
]
