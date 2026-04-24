"""
Transforms package — pipeline step registry + transform implementations.

Preserves the single-file import surface ``from server.core.transforms
import get_registry`` (and friends).  Each transform implementation
module registers into the step library via the ``@transform`` decorator
at import time; importing this package imports each implementation
module so every transform is available the first time ``get_registry()``
is called.
"""

from server.core.transforms.registry import (
    StepLibrary,
    TransformParam,
    TransformRegistration,
    from_dict,
    get_registry,
    get_step,
    list_steps,
    to_dict,
    transform,
)

# Side-effect imports — each module's @transform decorators populate the
# registry.  Deleting any of these would silently drop its transforms.
from server.core.transforms import (  # noqa: F401
    aggregation,
    calc_to_target,
    decay,
    exposure_to_position,
    fair_value,
    market_value_inference,
    position_sizing,
    risk_space_aggregation,
    smoothing,
    unit_conversion,
    variance,
)

__all__ = [
    "StepLibrary",
    "TransformParam",
    "TransformRegistration",
    "from_dict",
    "get_registry",
    "get_step",
    "list_steps",
    "to_dict",
    "transform",
]
