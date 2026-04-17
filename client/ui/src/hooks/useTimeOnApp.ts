import { useEffect } from "react";

import { logEvent } from "../services/eventsApi";

/**
 * Fire ``app_focus`` / ``app_blur`` events as the tab's ``visibilitychange``
 * state flips. The admin dashboard aggregates these into total time-on-app
 * per user.
 *
 * One listener per mount; the guard prevents duplicate events if multiple
 * consumers ever mount the hook simultaneously.
 */
let _mounted = false;

export function useTimeOnApp(): void {
  useEffect(() => {
    if (_mounted) return;
    _mounted = true;

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
      _mounted = false;
    };
  }, []);
}
