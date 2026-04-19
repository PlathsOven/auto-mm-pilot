/**
 * HTTP client for the notifications surface.
 *
 * Today: unregistered-stream push attempts. The WS tick payload already
 * carries the list (~2s latency), but:
 *   - Initial hydration uses `fetchUnregisteredPushes()` so the center is
 *     populated immediately on app load without waiting for the next tick.
 *   - `dismissUnregisteredPush()` lets the user manually close a
 *     notification; the server removes it from the shared store so other
 *     tabs / devices stop seeing it on the next tick.
 */

import type { UnregisteredPushAttempt } from "../types";
import { apiFetch } from "./api";

export async function fetchUnregisteredPushes(
  signal?: AbortSignal,
): Promise<UnregisteredPushAttempt[]> {
  return apiFetch<UnregisteredPushAttempt[]>(
    "/api/notifications/unregistered",
    { signal },
  );
}

export async function dismissUnregisteredPush(
  streamName: string,
): Promise<void> {
  await apiFetch<void>(
    `/api/notifications/unregistered/${encodeURIComponent(streamName)}`,
    { method: "DELETE" },
  );
}
