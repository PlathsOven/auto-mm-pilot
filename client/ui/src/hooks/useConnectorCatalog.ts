import { useEffect, useState } from "react";
import { fetchConnectorCatalog } from "../services/connectorApi";
import type { ConnectorSchema } from "../types";

/** In-memory module cache — the catalog is server-wide config, not per-user
 *  state, so a single fetch per page load is enough. The hook returns a
 *  reference to the same array on every render after the first.
 */
let _cached: ConnectorSchema[] | null = null;
let _inflight: Promise<ConnectorSchema[]> | null = null;

async function loadCatalog(): Promise<ConnectorSchema[]> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;
  _inflight = fetchConnectorCatalog()
    .then((resp) => {
      _cached = resp.connectors;
      return _cached;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export interface ConnectorCatalogState {
  connectors: ConnectorSchema[];
  loading: boolean;
  error: string | null;
}

/** Read the connector catalog. Cached for the lifetime of the SPA — calling
 *  this from N components fires at most one network request.
 */
export function useConnectorCatalog(): ConnectorCatalogState {
  const [connectors, setConnectors] = useState<ConnectorSchema[]>(_cached ?? []);
  const [loading, setLoading] = useState(_cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (_cached) return;
    let cancelled = false;
    loadCatalog()
      .then((list) => {
        if (cancelled) return;
        setConnectors(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { connectors, loading, error };
}

/** Look up a connector by machine name within the cached catalog. */
export function findConnector(
  connectors: ConnectorSchema[],
  name: string | null,
): ConnectorSchema | null {
  if (!name) return null;
  return connectors.find((c) => c.name === name) ?? null;
}
