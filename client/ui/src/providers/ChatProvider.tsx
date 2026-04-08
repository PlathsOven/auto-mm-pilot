import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ChatMessage, InvestigationContext } from "../types";
import { streamInvestigation } from "../services/llmApi";
import { createIdGenerator } from "../utils";

interface ChatState {
  messages: ChatMessage[];
  investigation: InvestigationContext | null;
  isStreaming: boolean;
  /** Whether the global ChatDrawer is currently visible. */
  drawerOpen: boolean;
  sendMessage: (content: string) => void;
  investigate: (ctx: InvestigationContext) => void;
  clearInvestigation: () => void;
  cancelStream: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

const ChatContext = createContext<ChatState>({
  messages: [],
  investigation: null,
  isStreaming: false,
  drawerOpen: false,
  sendMessage: () => {},
  investigate: () => {},
  clearInvestigation: () => {},
  cancelStream: () => {},
  openDrawer: () => {},
  closeDrawer: () => {},
  toggleDrawer: () => {},
});

export function useChat() {
  return useContext(ChatContext);
}

const nextId = createIdGenerator("msg-");

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [investigation, setInvestigation] =
    useState<InvestigationContext | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), []);

  const pushMessage = useCallback(
    (role: ChatMessage["role"], content: string): string => {
      const id = nextId();
      const msg: ChatMessage = { id, role, content, timestamp: Date.now() };
      setMessages((prev) => [...prev, msg]);
      return id;
    },
    [],
  );

  const updateMessage = useCallback((id: string, content: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content } : m)),
    );
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      pushMessage("user", content);
      setInvestigation(null);

      // Build conversation history for the LLM (last 20 messages)
      const recentMessages = [
        ...messagesRef.current,
        { id: "", role: "user" as const, content, timestamp: Date.now() },
      ];
      const conversation = recentMessages
        .slice(-20)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }));

      // Create a placeholder assistant message for streaming
      const assistantId = pushMessage("assistant", "");
      setIsStreaming(true);
      let accumulated = "";

      const controller = streamInvestigation(
        { conversation },
        {
          onDelta: (text) => {
            accumulated += text;
            updateMessage(assistantId, accumulated);
          },
          onDone: () => {
            setIsStreaming(false);
            abortRef.current = null;
            if (!accumulated) {
              updateMessage(assistantId, "No response received from the engine.");
            }
          },
          onError: (error) => {
            setIsStreaming(false);
            abortRef.current = null;
            updateMessage(
              assistantId,
              accumulated
                ? `${accumulated}\n\n⚠ Stream interrupted: ${error}`
                : `⚠ ${error}`,
            );
          },
        },
      );
      abortRef.current = controller;
    },
    [pushMessage, updateMessage],
  );

  const cancelStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  const investigate = useCallback(
    (ctx: InvestigationContext) => {
      setInvestigation(ctx);
      setDrawerOpen(true);
    },
    [],
  );

  const clearInvestigation = useCallback(() => {
    setInvestigation(null);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        investigation,
        isStreaming,
        drawerOpen,
        sendMessage,
        investigate,
        clearInvestigation,
        cancelStream,
        openDrawer,
        closeDrawer,
        toggleDrawer,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
