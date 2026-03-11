import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { ServerPayload, UpdateCard } from "../types";
import { generateMockPayload } from "./MockDataProvider";

const WS_URL = "ws://localhost:8000/ws";
const MOCK_INTERVAL_MS = 2000;
const RECONNECT_DELAY_MS = 3000;

type ConnectionStatus = "CONNECTED" | "CONNECTING" | "DISCONNECTED" | "MOCK";

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
  const mockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyPayload = useCallback((data: ServerPayload) => {
    setPayload(data);
    setUpdateHistory((prev) => {
      const merged = [...data.updates, ...prev];
      return merged.slice(0, 100);
    });
  }, []);

  const startMockMode = useCallback(() => {
    setConnectionStatus("MOCK");
    applyPayload(generateMockPayload());
    mockTimerRef.current = setInterval(() => {
      applyPayload(generateMockPayload());
    }, MOCK_INTERVAL_MS);
  }, [applyPayload]);

  const stopMock = useCallback(() => {
    if (mockTimerRef.current) {
      clearInterval(mockTimerRef.current);
      mockTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    stopMock();
    setConnectionStatus("CONNECTING");

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus("CONNECTED");
      };

      ws.onmessage = (event) => {
        try {
          const data: ServerPayload = JSON.parse(event.data);
          applyPayload(data);
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onclose = () => {
        setConnectionStatus("DISCONNECTED");
        reconnectTimerRef.current = setTimeout(() => {
          startMockMode();
        }, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      startMockMode();
    }
  }, [applyPayload, startMockMode, stopMock]);

  useEffect(() => {
    connect();

    return () => {
      stopMock();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect, stopMock]);

  return (
    <WebSocketContext.Provider
      value={{ payload, updateHistory, connectionStatus }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}
