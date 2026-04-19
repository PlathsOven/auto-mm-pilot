import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SilentStreamAlert, UnregisteredPushAttempt } from "../types";
import {
  dismissSilentStream,
  dismissUnregisteredPush,
  fetchSilentStreams,
  fetchUnregisteredPushes,
} from "../services/notificationsApi";
import { useWebSocket } from "./WebSocketProvider";
import { useAuth } from "./AuthProvider";

/**
 * Hoisted state for the global Notifications center.
 *
 * Two kinds of notifications today:
 *   - ``unregistered`` — feeder pushed to a stream the server doesn't
 *     know. Surfaced in the slide-over panel and inline in Anatomy →
 *     Streams list so the user can register in a loop.
 *   - ``silent`` — READY stream sent only ``raw_value`` for N+ rows;
 *     market_value defaults to fair, edge collapses to zero, positions
 *     read zero. Surfaced in the slide-over panel only (no inline
 *     counterpart — the Streams list already shows READY status).
 *
 * Source of truth: the WS tick payload, with a one-shot HTTP hydration
 * per session so the panel is populated before the first tick arrives.
 */
interface NotificationsState {
  open: boolean;
  /** Total across both notification kinds — powers the badge. */
  count: number;
  unregistered: UnregisteredPushAttempt[];
  silentStreams: SilentStreamAlert[];
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  dismissUnregistered: (streamName: string) => Promise<void>;
  dismissSilentStream: (streamName: string) => Promise<void>;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { payload } = useWebSocket();
  const { sessionToken } = useAuth();
  const [hydratedUnregistered, setHydratedUnregistered] =
    useState<UnregisteredPushAttempt[] | null>(null);
  const [hydratedSilent, setHydratedSilent] =
    useState<SilentStreamAlert[] | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      setHydratedUnregistered(null);
      setHydratedSilent(null);
      return;
    }
    const controller = new AbortController();
    fetchUnregisteredPushes(controller.signal)
      .then(setHydratedUnregistered)
      .catch(() => setHydratedUnregistered([]));
    fetchSilentStreams(controller.signal)
      .then(setHydratedSilent)
      .catch(() => setHydratedSilent([]));
    return () => controller.abort();
  }, [sessionToken]);

  const unregistered = useMemo<UnregisteredPushAttempt[]>(
    () => payload?.unregisteredPushes ?? hydratedUnregistered ?? [],
    [payload, hydratedUnregistered],
  );
  const silentStreams = useMemo<SilentStreamAlert[]>(
    () => payload?.silentStreams ?? hydratedSilent ?? [],
    [payload, hydratedSilent],
  );

  const count = unregistered.length + silentStreams.length;

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);
  const togglePanel = useCallback(() => setOpen((v) => !v), []);

  const handleDismissUnregistered = useCallback(async (streamName: string) => {
    try {
      await dismissUnregisteredPush(streamName);
      setHydratedUnregistered((prev) =>
        prev ? prev.filter((e) => e.streamName !== streamName) : prev,
      );
    } catch {
      // Server list is authoritative on the next tick.
    }
  }, []);

  const handleDismissSilent = useCallback(async (streamName: string) => {
    try {
      await dismissSilentStream(streamName);
      setHydratedSilent((prev) =>
        prev ? prev.filter((e) => e.streamName !== streamName) : prev,
      );
    } catch {
      // Server list is authoritative on the next tick.
    }
  }, []);

  const value = useMemo(
    () => ({
      open,
      count,
      unregistered,
      silentStreams,
      openPanel,
      closePanel,
      togglePanel,
      dismissUnregistered: handleDismissUnregistered,
      dismissSilentStream: handleDismissSilent,
    }),
    [
      open,
      count,
      unregistered,
      silentStreams,
      openPanel,
      closePanel,
      togglePanel,
      handleDismissUnregistered,
      handleDismissSilent,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
