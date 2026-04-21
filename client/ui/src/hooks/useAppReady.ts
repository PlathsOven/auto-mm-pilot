import { useEffect, useState } from "react";
import { useAuth } from "../providers/AuthProvider";
import { useWebSocket } from "../providers/WebSocketProvider";

/** Splash must always display for at least this long so it lands as a moment
 *  instead of flashing. Mock-mode ticks can arrive in <50ms which otherwise
 *  yields a jarring strobe. */
const SPLASH_MIN_MS = 400;

/** Hard ceiling on splash duration. If the first tick never arrives (server
 *  down, WS auth rejected, network stall), the splash dismisses anyway so the
 *  trader can see the AppShell's StatusBar — which exposes WS state + the
 *  ability to sign back out. Prevents the splash from masking connectivity
 *  failures, which would violate the "never silent staleness" invariant. */
const SPLASH_MAX_MS = 4000;

interface AppReady {
  /** True once the trader can use the app: authenticated + first WS tick
   *  received + splash has been visible long enough to read — OR the hard
   *  timeout has elapsed, in which case the AppShell becomes visible with
   *  its native CONNECTING/DISCONNECTED indicators so the trader is never
   *  stranded on the splash. */
  ready: boolean;
  /** Copy shown under the wordmark while waiting. Reflects which signal is
   *  outstanding so the trader knows whether we're blocked on connection. */
  message: string;
}

/**
 * Gate for `<PositSplash>`. Splash is shown after login until (a) the first
 * WebSocket payload arrives and (b) a minimum display time elapses. Pre-login
 * the splash is not shown — `<LoginPage>` owns that surface itself.
 */
export function useAppReady(): AppReady {
  const { user } = useAuth();
  const { payload, connectionStatus } = useWebSocket();
  const [minElapsed, setMinElapsed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Restart both timers on every sign-in so a logout/login cycle always
  // re-shows the splash for the full min duration, and the max-ceiling is
  // evaluated against the new session, not the previous one.
  useEffect(() => {
    if (!user) {
      setMinElapsed(false);
      setTimedOut(false);
      return;
    }
    const tMin = setTimeout(() => setMinElapsed(true), SPLASH_MIN_MS);
    const tMax = setTimeout(() => setTimedOut(true), SPLASH_MAX_MS);
    return () => {
      clearTimeout(tMin);
      clearTimeout(tMax);
    };
  }, [user]);

  const tickReceived = payload != null;
  const ready =
    user != null && minElapsed && (tickReceived || timedOut);

  let message = "Connecting to your workspace";
  if (connectionStatus === "CONNECTING") message = "Connecting to your workspace";
  else if (connectionStatus === "CONNECTED" && !tickReceived) message = "Syncing pipeline";
  else if (connectionStatus === "DISCONNECTED") message = "Reconnecting";

  return { ready, message };
}
