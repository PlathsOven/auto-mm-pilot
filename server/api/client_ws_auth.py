"""
Authentication + IP whitelisting for the client-facing WebSocket endpoint.

The SDK authenticates with the user's per-account API key (surfaced on the
Account page). The key resolves to a ``user_id`` during the handshake so
inbound frames route into that user's pipeline only.

Security layers:
  1. **IP whitelist** — reject connections from unknown source IPs.
  2. **API key → user** — validate the key against the ``api_keys`` table.
Both checks run during the WS handshake *before* ``accept()``.
"""

from __future__ import annotations

import logging
from ipaddress import ip_address, ip_network, IPv4Address, IPv6Address

from fastapi import WebSocket

from server.api.auth.tokens import resolve_user_id_from_api_key
from server.api.config import CLIENT_WS_ALLOWED_IPS

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# IP whitelist
# ---------------------------------------------------------------------------

def _parse_allowed_ips(raw: str) -> list[ip_network]:
    if not raw.strip():
        return []
    networks: list[ip_network] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            networks.append(ip_network(entry, strict=False))
        except ValueError:
            log.warning("Ignoring invalid IP/CIDR in CLIENT_WS_ALLOWED_IPS: %s", entry)
    return networks


_allowed_networks: list[ip_network] | None = None


def _get_allowed_networks() -> list[ip_network]:
    global _allowed_networks
    if _allowed_networks is None:
        _allowed_networks = _parse_allowed_ips(CLIENT_WS_ALLOWED_IPS)
        if _allowed_networks:
            log.info("Client WS IP whitelist: %s", [str(n) for n in _allowed_networks])
        else:
            log.warning("CLIENT_WS_ALLOWED_IPS empty — IP whitelist disabled")
    return _allowed_networks


def check_ip(client_host: str) -> bool:
    networks = _get_allowed_networks()
    if not networks:
        return True
    try:
        addr: IPv4Address | IPv6Address = ip_address(client_host)
    except ValueError:
        log.warning("Could not parse client IP: %s — rejecting", client_host)
        return False
    return any(addr in net for net in networks)


# ---------------------------------------------------------------------------
# API key → user resolution
# ---------------------------------------------------------------------------

def _extract_api_key(websocket: WebSocket) -> str | None:
    return websocket.headers.get("x-api-key") or websocket.query_params.get("api_key")


async def authenticate_client_ws(websocket: WebSocket) -> tuple[str, str] | None:
    """Run all auth checks. Returns ``(user_id, api_key)`` on success.

    On failure closes the WS with code 1008 and returns None.
    """
    client_host = websocket.client.host if websocket.client else "unknown"

    if not check_ip(client_host):
        log.warning("Client WS rejected — IP %s not in whitelist", client_host)
        await websocket.accept()
        await websocket.close(code=1008, reason="IP not allowed")
        return None

    api_key = _extract_api_key(websocket)
    if not api_key:
        log.warning("Client WS rejected — missing API key from %s", client_host)
        await websocket.accept()
        await websocket.close(code=1008, reason="Missing API key")
        return None

    user_id = resolve_user_id_from_api_key(api_key)
    if user_id is None:
        log.warning("Client WS rejected — invalid API key from %s", client_host)
        await websocket.accept()
        await websocket.close(code=1008, reason="Invalid API key")
        return None

    log.info("Client WS authenticated from %s (user=%s)", client_host, user_id)
    return user_id, api_key
