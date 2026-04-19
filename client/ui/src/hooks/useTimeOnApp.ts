import { useEffect, useRef } from "react";

import { logEvent } from "../services/eventsApi";

/**
 * Fire ``app_focus`` / ``app_blur`` events as the tab's ``visibilitychange``
 * state flips. The admin dashboard aggregates these into total time-on-app
 * per user.
 */
export function useTimeOnApp(): void {
  // Per-instance guard so React StrictMode's double-mount doesn't emit a
  // second focus event on the initial render.
  const attached = useRef(false);

  useEffect(() => {
    if (attached.current) return;
    attached.current = true;

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        logEvent("app_focus");
      } else {
        logEvent("app_blur");
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    // Also fire an initial focus event so a session that starts with the
    // tab already visible is counted in total_time_seconds.
    if (document.visibilityState === "visible") logEvent("app_focus");

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      attached.current = false;
    };
  }, []);
}
