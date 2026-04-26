"""Integration test for the expiry-correlation apply-method endpoint.

Focus: the response must carry canonical ISO expiry keys (with full
time-of-day). The client's correlation axis is sourced from
``DesiredPosition.expiryIso`` — same canonicaliser — so ``canonicalPair``
lookups resolve 1:1 against server entries. Using DDMMMYY on the wire
would lose the 08:00 UTC exchange expiry convention and misalign against
the pipeline's expiry column.

If this test starts failing because the response is DDMMMYY, the symptom
on the UI is: "Apply to draft" fires, the store populates, but Stage H's
draft matrix degenerates to identity — no position change visible.
"""
from __future__ import annotations

import importlib
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch, tmp_path):
    db_path = tmp_path / "posit_test.db"
    monkeypatch.setenv("POSIT_DB_URL", f"sqlite:///{db_path}")
    import server.api.db as db_module
    importlib.reload(db_module)
    import server.api.main as main_module
    importlib.reload(main_module)
    with TestClient(main_module.app) as test_client:
        yield test_client


def _session(client: TestClient) -> str:
    """Signup a fresh user with a unique handle; return its session token.

    The app writes to the shared dev DB (the ``POSIT_DB_URL`` env var isn't
    read by ``server/api/config.py`` — only ``DATABASE_URL`` is — so the
    fixture's reload doesn't actually give us an isolated DB file). A
    uuid-suffixed username sidesteps stale ``trader`` / leftover correlation
    state from prior runs.
    """
    username = f"corrtest_{uuid.uuid4().hex[:8]}"
    signup = client.post(
        "/api/auth/signup",
        json={"username": username, "password": "password"},
    )
    assert signup.status_code == 201, signup.text
    return signup.json()["session_token"]


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_apply_method_populates_draft_with_iso_keys(client: TestClient):
    token = _session(client)

    resp = client.post(
        "/api/correlations/expiries/apply-method",
        json={
            "method_name": "forward_addition_blend",
            "params": {"alpha": 0.0},
            # Mix of DDMMMYY (lossy) and ISO (with exchange time-of-day)
            # — the server canonicalises both to the same ISO midnight
            # representation. Production callers should send ISO from
            # ``DesiredPosition.expiryIso`` so the time-of-day survives.
            "expiries": ["27MAR26", "26JUN26", "25SEP26"],
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    # Draft is populated with C(3, 2) = 3 pairs.
    assert payload["draft"] is not None
    assert len(payload["draft"]) == 3

    # Every emitted ``a``/``b`` must be canonical ISO, not DDMMMYY.
    for entry in payload["draft"]:
        for side in ("a", "b"):
            val = entry[side]
            # ISO shape: "YYYY-MM-DDTHH:MM:SS" = 19 chars.
            assert len(val) == 19, f"{side}={val!r} is not canonical ISO"
            assert val[4] == "-" and val[7] == "-" and val[10] == "T"

    # Pairs expected (canonical-ISO lex order — also chronological).
    got_pairs = {(e["a"], e["b"]) for e in payload["draft"]}
    assert ("2026-03-27T00:00:00", "2026-06-26T00:00:00") in got_pairs
    assert ("2026-03-27T00:00:00", "2026-09-25T00:00:00") in got_pairs
    assert ("2026-06-26T00:00:00", "2026-09-25T00:00:00") in got_pairs


def test_apply_method_preserves_time_of_day_when_iso_sent(client: TestClient):
    """Crypto options expire at 08:00 UTC, not midnight. When the client
    sends the pipeline's ``expiryIso`` (full datetime), the server must
    preserve that time-of-day in the store — otherwise Stage H's label
    lookup would miss and the draft matrix would degenerate to identity."""
    token = _session(client)
    resp = client.post(
        "/api/correlations/expiries/apply-method",
        json={
            "method_name": "forward_addition_blend",
            "params": {"alpha": 0.0},
            "expiries": ["2026-03-27T08:00:00", "2026-06-26T08:00:00"],
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200, resp.text
    draft = resp.json()["draft"]
    assert len(draft) == 1
    entry = draft[0]
    assert entry["a"] == "2026-03-27T08:00:00"
    assert entry["b"] == "2026-06-26T08:00:00"


def test_list_returns_iso_after_confirm(client: TestClient):
    token = _session(client)

    # Apply a draft.
    client.post(
        "/api/correlations/expiries/apply-method",
        json={
            "method_name": "forward_addition_blend",
            "params": {"alpha": 0.3},
            "expiries": ["27MAR26", "26JUN26"],
        },
        headers=_bearer(token),
    )

    # Promote → committed.
    confirm = client.post("/api/correlations/expiries/confirm", headers=_bearer(token))
    assert confirm.status_code == 200, confirm.text

    # Plain GET must also return ISO keys on the committed side.
    got = client.get("/api/correlations/expiries", headers=_bearer(token)).json()
    assert got["draft"] is None
    assert len(got["committed"]) == 1
    entry = got["committed"][0]
    for side in ("a", "b"):
        val = entry[side]
        assert len(val) == 19, val  # ISO datetime


def test_apply_method_unknown_calculator_404(client: TestClient):
    token = _session(client)
    resp = client.post(
        "/api/correlations/expiries/apply-method",
        json={
            "method_name": "not_a_real_method",
            "params": {},
            "expiries": ["27MAR26", "26JUN26"],
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 404


def test_apply_method_single_expiry_400(client: TestClient):
    token = _session(client)
    # After canonicalisation both DDMMMYY inputs collapse to the same ISO.
    resp = client.post(
        "/api/correlations/expiries/apply-method",
        json={
            "method_name": "forward_addition_blend",
            "params": {"alpha": 0.0},
            "expiries": ["27MAR26", "27MAR26"],
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 400


def test_apply_method_alpha_out_of_range_400(client: TestClient):
    token = _session(client)
    resp = client.post(
        "/api/correlations/expiries/apply-method",
        json={
            "method_name": "forward_addition_blend",
            "params": {"alpha": 2.0},
            "expiries": ["27MAR26", "26JUN26"],
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 400


def test_list_methods_exposes_forward_addition_blend(client: TestClient):
    token = _session(client)
    resp = client.get("/api/correlations/expiries/methods", headers=_bearer(token))
    assert resp.status_code == 200
    payload = resp.json()
    names = [m["name"] for m in payload["methods"]]
    assert "forward_addition_blend" in names
    method = next(m for m in payload["methods"] if m["name"] == "forward_addition_blend")
    param_names = [p["name"] for p in method["params"]]
    assert "alpha" in param_names
