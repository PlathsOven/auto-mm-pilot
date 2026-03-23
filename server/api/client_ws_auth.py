"""
Authentication and IP whitelisting for the client-facing WebSocket endpoint.

Security layers:
  1. **IP whitelist** — reject connections from unknown source IPs.
  2. **API key**     — validate a shared secret passed as a query param or header.

Both checks run during the WS handshake *before* ``accept()``.
"""

from __future__ import annotations

import logging
from ipaddress import ip_address, ip_network, IPv4Address, IPv6Address

from fastapi import WebSocket

from server.api.config import CLIENT_WS_ALLOWED_IPS, CLIENT_WS_API_KEY

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# IP whitelist
# ---------------------------------------------------------------------------

def _parse_allowed_ips(raw: str) -> list[ip_network]:
    """Parse comma-separated IPs/CIDRs into a list of network objects."""
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
    """Lazy-init and cache the parsed whitelist."""
    global _allowed_networks
    if _allowed_networks is None:
        _allowed_networks = _parse_allowed_ips(CLIENT_WS_ALLOWED_IPS)
        if _allowed_networks:
            log.info("Client WS IP whitelist: %s", [str(n) for n in _allowed_networks])
        else:
            log.warning("CLIENT_WS_ALLOWED_IPS is empty — IP whitelist disabled (all IPs allowed)")
    return _allowed_networks


def check_ip(client_host: str) -> bool:
    """Return True if *client_host* passes the whitelist (or whitelist is empty)."""
    networks = _get_allowed_networks()
    if not networks:
        return True  # no whitelist configured → allow all
    try:
        addr: IPv4Address | IPv6Address = ip_address(client_host)
    except ValueError:
        log.warning("Could not parse client IP: %s — rejecting", client_host)
        return False
    return any(addr in net for net in networks)


# ---------------------------------------------------------------------------
# API key validation
# ---------------------------------------------------------------------------

def check_api_key(websocket: WebSocket) -> bool:
    """Validate the API key from query param ``api_key`` or header ``X-API-Key``.

    Returns True if the key matches, False otherwise.
    If ``CLIENT_WS_API_KEY`` is not configured, rejects all connections.
    """
    if not CLIENT_WS_API_KEY:
        log.error("CLIENT_WS_API_KEY is not set — all client WS connections will be rejected")
        return False

    # Prefer header, fall back to query param
    key = websocket.headers.get("x-api-key") or websocket.query_params.get("api_key")
    if not key:
        return False

    return key == CLIENT_WS_API_KEY


# ---------------------------------------------------------------------------
# Combined gate (called before websocket.accept())
# ---------------------------------------------------------------------------

async def authenticate_client_ws(websocket: WebSocket) -> bool:
    """Run all auth checks. Returns True if the connection should be accepted.

    On failure, closes the WS with an appropriate code and returns False.
    """
    client_host = websocket.client.host if websocket.client else "unknown"

    # 1. IP whitelist (checked before accept — reject by accepting then closing)
    if not check_ip(client_host):
        log.warning("Client WS rejected — IP %s not in whitelist", client_host)
        await websocket.accept()
        await websocket.close(code=1008, reason="IP not allowed")
        return False

    # 2. API key
    if not check_api_key(websocket):
        log.warning("Client WS rejected — invalid or missing API key from %s", client_host)
        await websocket.accept()
        await websocket.close(code=1008, reason="Invalid API key")
        return False

    log.info("Client WS authenticated from %s", client_host)
    return True
