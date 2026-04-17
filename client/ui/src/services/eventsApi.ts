import { apiFetch } from "./api";
import type { UsageEventRequest, UsageEventType } from "../types";

/**
 * Fire a client-instrumented usage event. Fire-and-forget — failures are
 * swallowed so analytics can't wedge a user-visible flow.
 */
export function logEvent(
  type: UsageEventType,
  metadata: Record<string, string | number | boolean> = {},
): void {
  const body: UsageEventRequest = { type, metadata };
  apiFetch<void>("/api/events", {
    method: "POST",
    body: JSON.stringify(body),
  }).catch(() => {
    /* analytics failures must never surface to the user */
  });
}
