"""Integration tests for the connector REST surface.

Covers:
* GET /api/connectors returns the catalog with the realized_vol entry.
* Configure flow: create stream → configure with connector → push
  connector inputs → describe stream returns warmup summary.
* Cross-mode pushes are blocked: snapshot → connector-fed = 409
  STREAM_IS_CONNECTOR_FED, connector-input → user-fed = 409
  STREAM_IS_NOT_CONNECTOR_FED.
* Configuration errors: unknown connector = 400 UNKNOWN_CONNECTOR;
  invalid params = 422.
* Lifecycle: deleting a connector-fed stream evicts the connector state.
"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch, tmp_path):
    """Spin up a fresh app + per-test SQLite DB.

    The app reads ``POSIT_DB_URL`` at import time via ``server.api.db.init_db``;
    pointing it at a temp file gives every test a clean signup state without
    touching the developer's working DB.
    """
    db_path = tmp_path / "posit_test.db"
    monkeypatch.setenv("POSIT_DB_URL", f"sqlite:///{db_path}")

    # Reload the modules that captured the env var at import time.
    import server.api.db as db_module
    importlib.reload(db_module)
    import server.api.main as main_module
    importlib.reload(main_module)

    with TestClient(main_module.app) as test_client:
        yield test_client


def _signup(client: TestClient, username: str = "trader") -> tuple[str, str]:
    """Sign up + log in; return (api_key, session_token)."""
    client.post("/api/auth/signup", json={"username": username, "password": "password"})
    login = client.post("/api/auth/login", json={"username": username, "password": "password"})
    token = login.json()["session_token"]
    key_resp = client.get("/api/account/key", headers={"Authorization": f"Bearer {token}"})
    return key_resp.json()["api_key"], token


def _auth(api_key: str) -> dict:
    return {"x-api-key": api_key}


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

def test_catalog_lists_realized_vol(client: TestClient) -> None:
    api_key, _ = _signup(client)
    r = client.get("/api/connectors", headers=_auth(api_key))
    assert r.status_code == 200
    catalog = r.json()
    assert {c["name"] for c in catalog["connectors"]} == {"realized_vol"}
    rv = catalog["connectors"][0]
    assert rv["display_name"] == "Realized Volatility"
    assert rv["input_key_cols"] == ["symbol"]
    assert {f["name"] for f in rv["input_value_fields"]} == {"price"}
    assert rv["recommended_exponent"] == 2.0
    assert rv["recommended_block"]["annualized"] is True
    assert {p["name"] for p in rv["params"]} == {
        "halflife_minutes",
        "snapshot_lengths_seconds",
    }


# ---------------------------------------------------------------------------
# Configure flow + happy path ingest
# ---------------------------------------------------------------------------

def _seed_dim_universe(client: TestClient, h: dict, pairs: list[tuple[str, str]]) -> None:
    """Configure a tiny user-fed stream so the dim universe is non-empty.

    The connector's emit-rows fan-out reads the universe from every other
    configured stream's snap_rows. Without a "shape provider" stream
    nothing fans out and the connector path becomes a no-op.
    """
    client.post("/api/streams", headers=h, json={
        "stream_name": "_universe_seed", "key_cols": ["symbol", "expiry"],
    })
    client.post(
        "/api/streams/_universe_seed/configure",
        headers=h,
        json={"scale": 1.0, "offset": 0.0, "exponent": 1.0},
    )
    # Non-zero raw_value so the seed stream produces non-degenerate variance
    # — the pipeline rerun would otherwise hit a zero-divide collapse path
    # in position sizing and yield empty downstream frames.
    rows = [
        {"timestamp": "2026-01-01T00:00:00", "raw_value": 0.5, "symbol": s, "expiry": e}
        for s, e in pairs
    ]
    client.post(
        "/api/snapshots",
        headers=h,
        json={"stream_name": "_universe_seed", "rows": rows, "allow_zero_edge": True},
    )


def test_create_configure_push_describe_round_trip(client: TestClient) -> None:
    api_key, _ = _signup(client)
    h = _auth(api_key)

    _seed_dim_universe(client, h, [("BTC", "27MAR27")])

    # Create + configure with realized_vol.
    create = client.post(
        "/api/streams",
        headers=h,
        json={"stream_name": "rv_btc", "key_cols": ["symbol", "expiry"]},
    )
    assert create.status_code == 201, create.text

    cfg = client.post(
        "/api/streams/rv_btc/configure",
        headers=h,
        json={
            "scale": 1.0,
            "offset": 0.0,
            "exponent": 2.0,
            "block": {
                "annualized": True,
                "temporal_position": "shifting",
                "decay_end_size_mult": 1.0,
                "decay_rate_prop_per_min": 0.0,
                "decay_profile": "linear",
                "var_fair_ratio": 1.0,
            },
            "connector_name": "realized_vol",
            "connector_params": {
                "halflife_minutes": 60,
                "snapshot_lengths_seconds": [1],
            },
        },
    )
    assert cfg.status_code == 200, cfg.text
    body = cfg.json()
    assert body["status"] == "READY"
    assert body["connector_name"] == "realized_vol"
    assert body["connector_params"]["halflife_minutes"] == 60

    # Push a 2-row batch — second row crosses the 1s horizon.
    push = client.post(
        "/api/streams/rv_btc/connector-input",
        headers=h,
        json={
            "stream_name": "rv_btc",
            "rows": [
                {"timestamp": "2026-01-01T00:00:00", "symbol": "BTC", "price": 100.0},
                {"timestamp": "2026-01-01T00:00:01", "symbol": "BTC", "price": 100.5},
            ],
        },
    )
    assert push.status_code == 200, push.text
    push_body = push.json()
    assert push_body["rows_accepted"] == 2
    # One emit (avg_rv changed) fanned across one (BTC, 27MAR26) pair.
    assert push_body["rows_emitted"] == 1

    # Describe — connector_state_summary should be populated.
    state = client.get("/api/streams/rv_btc", headers=h)
    assert state.status_code == 200
    state_body = state.json()
    assert state_body["connector_name"] == "realized_vol"
    assert state_body["connector_state_summary"]["min_n_eff"] >= 0.0
    assert state_body["connector_state_summary"]["symbols_tracked"] == 1
    assert state_body["row_count"] == 1


# ---------------------------------------------------------------------------
# Cross-mode push gates (409)
# ---------------------------------------------------------------------------

def test_snapshot_push_to_connector_fed_stream_is_409(client: TestClient) -> None:
    api_key, _ = _signup(client)
    h = _auth(api_key)

    client.post("/api/streams", headers=h, json={"stream_name": "rv_btc", "key_cols": ["symbol", "expiry"]})
    client.post(
        "/api/streams/rv_btc/configure",
        headers=h,
        json={
            "scale": 1.0,
            "offset": 0.0,
            "exponent": 2.0,
            "connector_name": "realized_vol",
        },
    )

    snap = client.post(
        "/api/snapshots",
        headers=h,
        json={
            "stream_name": "rv_btc",
            "rows": [{
                "timestamp": "2026-01-01T00:00:00",
                "raw_value": 0.5,
                "symbol": "BTC",
                "expiry": "27MAR27",
            }],
            "allow_zero_edge": True,
        },
    )
    assert snap.status_code == 409
    assert snap.json()["detail"]["code"] == "STREAM_IS_CONNECTOR_FED"


def test_connector_input_to_user_fed_stream_is_409(client: TestClient) -> None:
    api_key, _ = _signup(client)
    h = _auth(api_key)

    client.post("/api/streams", headers=h, json={"stream_name": "manual_iv", "key_cols": ["symbol", "expiry"]})
    client.post(
        "/api/streams/manual_iv/configure",
        headers=h,
        json={
            "scale": 1.0,
            "offset": 0.0,
            "exponent": 1.0,
        },
    )
    push = client.post(
        "/api/streams/manual_iv/connector-input",
        headers=h,
        json={
            "stream_name": "manual_iv",
            "rows": [{"timestamp": "2026-01-01T00:00:00", "symbol": "BTC", "price": 100.0}],
        },
    )
    assert push.status_code == 409
    assert push.json()["detail"]["code"] == "STREAM_IS_NOT_CONNECTOR_FED"


# ---------------------------------------------------------------------------
# Configuration errors
# ---------------------------------------------------------------------------

def test_unknown_connector_at_configure_is_400(client: TestClient) -> None:
    api_key, _ = _signup(client)
    h = _auth(api_key)
    client.post("/api/streams", headers=h, json={"stream_name": "x", "key_cols": ["symbol", "expiry"]})
    cfg = client.post(
        "/api/streams/x/configure",
        headers=h,
        json={
            "scale": 1.0, "offset": 0.0, "exponent": 1.0,
            "connector_name": "made_up_connector",
        },
    )
    assert cfg.status_code == 400
    assert cfg.json()["detail"]["code"] == "UNKNOWN_CONNECTOR"


def test_invalid_connector_param_is_422(client: TestClient) -> None:
    api_key, _ = _signup(client)
    h = _auth(api_key)
    client.post("/api/streams", headers=h, json={"stream_name": "x", "key_cols": ["symbol", "expiry"]})
    cfg = client.post(
        "/api/streams/x/configure",
        headers=h,
        json={
            "scale": 1.0, "offset": 0.0, "exponent": 1.0,
            "connector_name": "realized_vol",
            "connector_params": {"halflife_minutes": -10},
        },
    )
    assert cfg.status_code == 422


def test_missing_input_field_is_422(client: TestClient) -> None:
    api_key, _ = _signup(client)
    h = _auth(api_key)
    client.post("/api/streams", headers=h, json={"stream_name": "rv", "key_cols": ["symbol", "expiry"]})
    client.post(
        "/api/streams/rv/configure",
        headers=h,
        json={"scale": 1.0, "offset": 0.0, "exponent": 2.0, "connector_name": "realized_vol"},
    )
    push = client.post(
        "/api/streams/rv/connector-input",
        headers=h,
        json={
            "stream_name": "rv",
            "rows": [{"timestamp": "2026-01-01T00:00:00", "symbol": "BTC"}],  # no price
        },
    )
    assert push.status_code == 422


# ---------------------------------------------------------------------------
# Stream delete evicts connector state
# ---------------------------------------------------------------------------

def test_delete_stream_evicts_connector_state(client: TestClient) -> None:
    api_key, _ = _signup(client)
    h = _auth(api_key)

    client.post("/api/streams", headers=h, json={"stream_name": "rv_btc", "key_cols": ["symbol", "expiry"]})
    client.post(
        "/api/streams/rv_btc/configure",
        headers=h,
        json={"scale": 1.0, "offset": 0.0, "exponent": 2.0, "connector_name": "realized_vol"},
    )
    client.post(
        "/api/streams/rv_btc/connector-input",
        headers=h,
        json={
            "stream_name": "rv_btc",
            "rows": [
                {"timestamp": "2026-01-01T00:00:00", "symbol": "BTC", "price": 100.0},
                {"timestamp": "2026-01-01T00:00:01", "symbol": "BTC", "price": 100.5},
            ],
        },
    )
    delete = client.delete("/api/streams/rv_btc", headers=h)
    assert delete.status_code == 204

    # Recreate identically — describe should show no warmed-up state.
    client.post("/api/streams", headers=h, json={"stream_name": "rv_btc", "key_cols": ["symbol", "expiry"]})
    client.post(
        "/api/streams/rv_btc/configure",
        headers=h,
        json={"scale": 1.0, "offset": 0.0, "exponent": 2.0, "connector_name": "realized_vol"},
    )
    state = client.get("/api/streams/rv_btc", headers=h)
    summary = state.json()["connector_state_summary"]
    # No state allocated yet → summary is None until first push.
    assert summary is None
