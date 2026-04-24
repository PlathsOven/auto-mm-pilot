"""
Auth, account, admin, and usage-event shapes.

Covers the multi-user surface: signup / login / api-key / usage telemetry
and the admin read paths (user summaries, llm_failures triage). Has no
runtime dependency on streams or LLM shapes — imports stdlib + pydantic
only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# Charset + length rules match the spec: case-insensitive, 3–32 chars, [a-zA-Z0-9_-].
USERNAME_PATTERN = r"^[A-Za-z0-9_-]{3,32}$"
PASSWORD_MIN_LENGTH = 8


class UserPublic(BaseModel):
    """Non-secret user profile — safe to return anywhere in the API."""
    id: str
    username: str  # display form (original casing)
    created_at: datetime
    is_admin: bool


class SignupRequest(BaseModel):
    """Fully-open signup payload. Charset/length validated by the pattern + min_length."""
    username: str = Field(..., pattern=USERNAME_PATTERN)
    password: str = Field(..., min_length=PASSWORD_MIN_LENGTH)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    session_token: str
    user: UserPublic


class ApiKeyResponse(BaseModel):
    """Returned only on ``GET /api/account/key`` and the regenerate endpoint."""
    api_key: str


class UsageEventRequest(BaseModel):
    type: Literal[
        "panel_open",
        "panel_close",
        "manual_block_create",
        "cell_click",
        "app_focus",
        "app_blur",
    ]
    # Metadata is intentionally low-cardinality + non-PII — enforced at the
    # type level so a client accidentally stuffing a user message / raw row
    # into it fails validation rather than silently leaking to storage.
    metadata: dict[str, str | int | float | bool] = Field(default_factory=dict)


class AdminUserSummary(BaseModel):
    """One row of the admin usage dashboard."""
    id: str
    username: str
    created_at: datetime
    last_login_at: datetime | None
    active_ws_connections: int
    manual_block_count: int
    total_sessions: int
    total_time_seconds: int


class AdminUserListResponse(BaseModel):
    users: list[AdminUserSummary]


class AdminLlmFailureRow(BaseModel):
    """One row of the admin llm_failures read path."""
    id: int
    user_id: str
    conversation_turn_id: str | None
    llm_call_id: int | None
    signal_type: str
    trigger: str
    llm_output_snippet: str | None
    trader_response_snippet: str | None
    detector_reasoning: str | None
    metadata_json: dict[str, Any]
    created_at: datetime


class AdminLlmFailureListResponse(BaseModel):
    rows: list[AdminLlmFailureRow]
