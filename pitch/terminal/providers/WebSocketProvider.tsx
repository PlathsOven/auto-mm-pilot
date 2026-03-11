"use client";

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

const MOCK_INTERVAL_MS = 2000;

type ConnectionStatus = "MOCK";

interface WebSocketState {
  payload: ServerPayload | null;
  updateHistory: UpdateCard[];
  connectionStatus: ConnectionStatus;
}

const WebSocketContext = createContext<WebSocketState>({
  payload: null,
  updateHistory: [],
  connectionStatus: "MOCK",
});

export function useWebSocket() {
  return useContext(WebSocketContext);
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<ServerPayload | null>(null);
  const [updateHistory, setUpdateHistory] = useState<UpdateCard[]>([]);
  const connectionStatus: ConnectionStatus = "MOCK";
  const mockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyPayload = useCallback((data: ServerPayload) => {
    setPayload(data);
    setUpdateHistory((prev) => {
      const merged = [...data.updates, ...prev];
      return merged.slice(0, 100);
    });
  }, []);

  useEffect(() => {
    applyPayload(generateMockPayload());
    mockTimerRef.current = setInterval(() => {
      applyPayload(generateMockPayload());
    }, MOCK_INTERVAL_MS);

    return () => {
      if (mockTimerRef.current) {
        clearInterval(mockTimerRef.current);
        mockTimerRef.current = null;
      }
    };
  }, [applyPayload]);

  return (
    <WebSocketContext.Provider
      value={{ payload, updateHistory, connectionStatus }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}
