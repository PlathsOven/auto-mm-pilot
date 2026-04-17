import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { ServerPayload, UpdateCard } from "../types";
import { WS_URL } from "../config";
import { UPDATE_HISTORY_MAX_LENGTH } from "../constants";
import { useAuth } from "./AuthProvider";

const RECONNECT_DELAY_MS = 3000;

type ConnectionStatus = "CONNECTED" | "CONNECTING" | "DISCONNECTED";

interface WebSocketState {
  payload: ServerPayload | null;
  updateHistory: UpdateCard[];
  connectionStatus: ConnectionStatus;
}

const WebSocketContext = createContext<WebSocketState>({
  payload: null,
  updateHistory: [],
  connectionStatus: "DISCONNECTED",
});

export function useWebSocket() {
  return useContext(WebSocketContext);
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { sessionToken } = useAuth();
  const [payload, setPayload] = useState<ServerPayload | null>(null);
  const [updateHistory, setUpdateHistory] = useState<UpdateCard[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("DISCONNECTED");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyPayload = useCallback((data: ServerPayload) => {
    setPayload(data);

    if (data.updates.length > 0) {
      setUpdateHistory((prev) => {
        const merged = [...data.updates, ...prev];
        return merged.slice(0, UPDATE_HISTORY_MAX_LENGTH);
      });
    }
  }, []);

  const connect = useCallback(
    (token: string) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnectionStatus("CONNECTING");

      try {
        const url = `${WS_URL}?session_token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => setConnectionStatus("CONNECTED");

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && Array.isArray(data.positions)) {
              applyPayload(data as ServerPayload);
            }
          } catch {
            /* ignore malformed messages */
          }
        };

        ws.onclose = () => {
          setConnectionStatus("DISCONNECTED");
          // Only schedule a reconnect if the user is still signed in. On
          // logout the effect cleanup closes the socket intentionally and
          // we don't want to keep retrying.
          reconnectTimerRef.current = setTimeout(() => {
            if (wsRef.current === ws) connect(token);
          }, RECONNECT_DELAY_MS);
        };

        ws.onerror = () => ws.close();
      } catch {
        setConnectionStatus("DISCONNECTED");
        reconnectTimerRef.current = setTimeout(() => connect(token), RECONNECT_DELAY_MS);
      }
    },
    [applyPayload],
  );

  useEffect(() => {
    if (!sessionToken) {
      // Signed-out: tear down and stay disconnected.
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setPayload(null);
      setUpdateHistory([]);
      setConnectionStatus("DISCONNECTED");
      return;
    }

    connect(sessionToken);

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, sessionToken]);

  const value = useMemo(
    () => ({ payload, updateHistory, connectionStatus }),
    [payload, updateHistory, connectionStatus],
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
