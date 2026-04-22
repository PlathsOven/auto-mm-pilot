"""REST client covering all /api/* endpoints."""
from __future__ import annotations

import httpx

from posit_sdk.exceptions import PositApiError, PositAuthError, PositZeroEdgeBlocked
from posit_sdk.models import (
    BankrollResponse,
    BlockConfig,
    BlockRowResponse,
    HealthResponse,
    MarketValueEntry,
    PositionPayload,
    SnapshotResponse,
    SnapshotRow,
    StreamResponse,
    StreamState,
)

_DEFAULT_TIMEOUT = 30.0


class RestClient:
    """Async HTTP client wrapping all /api/* REST endpoints.

    Use as an async context manager::

        async with RestClient(base_url, api_key) as rest:
            streams = await rest.list_streams()
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base = base_url.rstrip("/")
        self._api_key = api_key
        self._http: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "RestClient":
        self._http = httpx.AsyncClient(
            base_url=self._base,
            headers={"X-API-Key": self._api_key},
            timeout=_DEFAULT_TIMEOUT,
        )
        return self

    async def __aexit__(self, *args: object) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    @property
    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            raise RuntimeError("RestClient must be used as an async context manager")
        return self._http

    def _raise_for_status(self, resp: httpx.Response) -> None:
        if resp.status_code == 401:
            raise PositAuthError("Invalid or missing API key")
        if resp.is_success:
            return
        try:
            detail = resp.json().get("detail") or resp.text
        except Exception:
            detail = resp.text
        # Structured 422 with {"code": "ZERO_EDGE_BLOCKED", ...} → typed error.
        if (
            resp.status_code == 422
            and isinstance(detail, dict)
            and detail.get("code") == "ZERO_EDGE_BLOCKED"
        ):
            pairs = [
                (p["symbol"], p["expiry"])
                for p in detail.get("missing_pairs", [])
            ]
            raise PositZeroEdgeBlocked(
                stream_name=detail.get("stream", ""),
                missing_pairs=pairs,
                message=str(detail),
            )
        raise PositApiError(resp.status_code, str(detail))

    # ----- Pipeline config -----

    async def get_dimension_cols(self) -> list[str]:
        """Return the server's required risk-dimension key columns.

        The SDK caches this on first call — it is stable server config
        (currently ``["symbol", "expiry"]``) but fetched rather than
        hardcoded so it remains correct across server upgrades.
        """
        resp = await self._client.get("/api/pipeline/dimensions")
        self._raise_for_status(resp)
        data = resp.json()
        cols = data.get("dimensionCols") or data.get("dimension_cols") or []
        return list(cols)

    async def get_dimension_universe(self) -> list[tuple[str, str]]:
        """Return the current pipeline's (symbol, expiry) universe.

        Unlike ``get_dimension_cols`` (stable config), this one varies with
        the pipeline state — callers should re-fetch per fan-out operation
        rather than cache across ticks.
        """
        resp = await self._client.get("/api/pipeline/dimensions")
        self._raise_for_status(resp)
        data = resp.json()
        dims = data.get("dimensions") or []
        return [(d["symbol"], d["expiry"]) for d in dims]

    # ----- Observability -----

    async def health(self) -> HealthResponse:
        resp = await self._client.get("/api/health")
        self._raise_for_status(resp)
        return HealthResponse(**resp.json())

    async def describe_stream(self, stream_name: str) -> StreamState:
        resp = await self._client.get(f"/api/streams/{stream_name}")
        self._raise_for_status(resp)
        return StreamState(**resp.json())

    async def get_positions(self) -> PositionPayload:
        """One-shot REST snapshot of the latest pipeline broadcast payload."""
        resp = await self._client.get("/api/positions")
        self._raise_for_status(resp)
        return PositionPayload.model_validate(resp.json())

    # ----- Streams -----

    async def list_streams(self) -> list[StreamResponse]:
        resp = await self._client.get("/api/streams")
        self._raise_for_status(resp)
        return [StreamResponse(**s) for s in resp.json()["streams"]]

    async def create_stream(self, name: str, key_cols: list[str]) -> StreamResponse:
        resp = await self._client.post(
            "/api/streams",
            json={"stream_name": name, "key_cols": key_cols},
        )
        self._raise_for_status(resp)
        return StreamResponse(**resp.json())

    async def update_stream(
        self,
        stream_name: str,
        *,
        new_name: str | None = None,
        new_key_cols: list[str] | None = None,
    ) -> StreamResponse:
        payload: dict = {}
        if new_name is not None:
            payload["stream_name"] = new_name
        if new_key_cols is not None:
            payload["key_cols"] = new_key_cols
        resp = await self._client.patch(f"/api/streams/{stream_name}", json=payload)
        self._raise_for_status(resp)
        return StreamResponse(**resp.json())

    async def configure_stream(
        self,
        stream_name: str,
        *,
        scale: float,
        offset: float = 0.0,
        exponent: float = 1.0,
        block: BlockConfig | None = None,
    ) -> StreamResponse:
        payload: dict = {"scale": scale, "offset": offset, "exponent": exponent}
        if block is not None:
            payload["block"] = block.model_dump()
        resp = await self._client.post(
            f"/api/streams/{stream_name}/configure", json=payload,
        )
        self._raise_for_status(resp)
        return StreamResponse(**resp.json())

    async def delete_stream(self, stream_name: str) -> None:
        resp = await self._client.delete(f"/api/streams/{stream_name}")
        self._raise_for_status(resp)

    # ----- Snapshots -----

    async def ingest_snapshot(
        self,
        stream_name: str,
        rows: list[SnapshotRow],
        *,
        allow_zero_edge: bool = False,
    ) -> SnapshotResponse:
        body: dict = {
            "stream_name": stream_name,
            "rows": [r.model_dump() for r in rows],
        }
        if allow_zero_edge:
            body["allow_zero_edge"] = True
        resp = await self._client.post("/api/snapshots", json=body)
        self._raise_for_status(resp)
        return SnapshotResponse(**resp.json())

    # ----- Bankroll -----

    async def get_bankroll(self) -> BankrollResponse:
        resp = await self._client.get("/api/config/bankroll")
        self._raise_for_status(resp)
        return BankrollResponse(**resp.json())

    async def set_bankroll(self, bankroll: float) -> BankrollResponse:
        resp = await self._client.patch(
            "/api/config/bankroll", json={"bankroll": bankroll},
        )
        self._raise_for_status(resp)
        return BankrollResponse(**resp.json())

    # ----- Blocks -----

    async def list_blocks(self) -> list[BlockRowResponse]:
        resp = await self._client.get("/api/blocks")
        self._raise_for_status(resp)
        return [BlockRowResponse(**b) for b in resp.json()["blocks"]]

    async def create_manual_block(
        self,
        stream_name: str,
        snapshot_rows: list[SnapshotRow],
        *,
        key_cols: list[str] | None = None,
        scale: float = 1.0,
        offset: float = 0.0,
        exponent: float = 1.0,
        block: BlockConfig | None = None,
        space_id: str | None = None,
    ) -> BlockRowResponse:
        if block is None:
            block = BlockConfig()
        payload: dict = {
            "stream_name": stream_name,
            "snapshot_rows": [r.model_dump() for r in snapshot_rows],
            "key_cols": key_cols or ["symbol", "expiry"],
            "scale": scale,
            "offset": offset,
            "exponent": exponent,
            "block": block.model_dump(),
        }
        if space_id is not None:
            payload["space_id"] = space_id
        resp = await self._client.post("/api/blocks", json=payload)
        self._raise_for_status(resp)
        return BlockRowResponse(**resp.json())

    async def update_block(
        self,
        stream_name: str,
        *,
        scale: float | None = None,
        offset: float | None = None,
        exponent: float | None = None,
        block: BlockConfig | None = None,
        snapshot_rows: list[SnapshotRow] | None = None,
    ) -> BlockRowResponse:
        payload: dict = {}
        if scale is not None:
            payload["scale"] = scale
        if offset is not None:
            payload["offset"] = offset
        if exponent is not None:
            payload["exponent"] = exponent
        if block is not None:
            payload["block"] = block.model_dump()
        if snapshot_rows is not None:
            payload["snapshot_rows"] = [r.model_dump() for r in snapshot_rows]
        resp = await self._client.patch(f"/api/blocks/{stream_name}", json=payload)
        self._raise_for_status(resp)
        return BlockRowResponse(**resp.json())

    # ----- Market values -----

    async def list_market_values(self) -> list[MarketValueEntry]:
        resp = await self._client.get("/api/market-values")
        self._raise_for_status(resp)
        return [MarketValueEntry(**e) for e in resp.json()["entries"]]

    async def set_market_values(
        self, entries: list[MarketValueEntry],
    ) -> list[MarketValueEntry]:
        resp = await self._client.put(
            "/api/market-values",
            json={"entries": [e.model_dump() for e in entries]},
        )
        self._raise_for_status(resp)
        return [MarketValueEntry(**e) for e in resp.json()["entries"]]

    async def delete_market_value(self, symbol: str, expiry: str) -> None:
        resp = await self._client.delete(f"/api/market-values/{symbol}/{expiry}")
        self._raise_for_status(resp)
