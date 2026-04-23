import { apiFetch } from "./api";
import type { ConnectorCatalogResponse } from "../types";

/** Fetch the server's connector catalog (metadata only — no implementations).
 *  Stable per session — see `useConnectorCatalog` for the cached hook.
 */
export function fetchConnectorCatalog(): Promise<ConnectorCatalogResponse> {
  return apiFetch<ConnectorCatalogResponse>("/api/connectors");
}
