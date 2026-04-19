import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useWebSocket } from "./WebSocketProvider";

/**
 * Hoisted state for the global Notifications center.
 *
 * The center itself is a slide-over rendered once inside `<AppShell/>`. The
 * trigger live in two places for discoverability:
 *   - `<LeftNav/>` — a "Notifications" tab with an always-visible badge,
 *     treated as a first-class workspace entry.
 *   - `<StatusBar/>` — a compact ⚑ indicator so the badge stays visible
 *     even when the left nav is collapsed.
 * Both route through this provider so the open state + count stay in sync.
 */
interface NotificationsState {
  open: boolean;
  count: number;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { payload } = useWebSocket();
  const count = payload?.unregisteredPushes?.length ?? 0;

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);
  const togglePanel = useCallback(() => setOpen((v) => !v), []);

  const value = useMemo(
    () => ({ open, count, openPanel, closePanel, togglePanel }),
    [open, count, openPanel, closePanel, togglePanel],
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
