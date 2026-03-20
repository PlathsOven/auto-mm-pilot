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
import { fetchJustification } from "../services/llmApi";
import { WS_URL } from "../config";

const RECONNECT_DELAY_MS = 3000;
const JUSTIFICATION_PLACEHOLDER = "Generating justification…";

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

  /** Replace an update card's reason by its ID. */
  const patchCardReason = useCallback((cardId: string, reason: string) => {
    setUpdateHistory((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, reason } : c)),
    );
  }, []);

  /** Fire-and-forget: enrich each new card with a real LLM justification. */
  const enrichCards = useCallback(
    (cards: UpdateCard[]) => {
      for (const card of cards) {
        fetchJustification({
          asset: card.asset,
          expiry: card.expiry,
          old_pos: card.oldPos,
          new_pos: card.newPos,
          delta: card.delta,
        })
          .then((justification) => patchCardReason(card.id, justification))
          .catch((err) =>
            patchCardReason(
              card.id,
              `⚠ ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }
    },
    [patchCardReason],
  );

  const applyPayload = useCallback(
    (data: ServerPayload) => {
      setPayload(data);

      // Insert cards with placeholder reason, then enrich asynchronously
      const pendingCards = data.updates.map((c) => ({
        ...c,
        reason: JUSTIFICATION_PLACEHOLDER,
      }));

      setUpdateHistory((prev) => {
        const merged = [...pendingCards, ...prev];
        return merged.slice(0, 100);
      });

      if (pendingCards.length > 0) {
        enrichCards(pendingCards);
      }
    },
    [enrichCards],
  );

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

  return (
    <WebSocketContext.Provider
      value={{ payload, updateHistory, connectionStatus }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}
