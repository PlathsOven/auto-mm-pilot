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
  const [payload, setPayload] = useState<ServerPayload | null>(null);
  const [updateHistory, setUpdateHistory] = useState<UpdateCard[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("CONNECTING");
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

  const connect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setConnectionStatus("CONNECTING");

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus("CONNECTED");
      };

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
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setConnectionStatus("DISCONNECTED");
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, RECONNECT_DELAY_MS);
    }
  }, [applyPayload]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

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
