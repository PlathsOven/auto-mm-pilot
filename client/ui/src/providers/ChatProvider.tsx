import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ChatMessage, ChatMode, InvestigationContext, PendingBlockCommand } from "../types";
import { streamFetchSSE } from "../services/api";
import { parseAndStripCommands, executeNonInteractiveCommands } from "../services/engineCommands";

interface ChatState {
  messages: ChatMessage[];
  investigation: InvestigationContext | null;
  isStreaming: boolean;
  /** Whether the WorkbenchRail's Chat tab is currently surfaced. */
  drawerOpen: boolean;
  chatMode: ChatMode;
  /** Pending manual-block command awaiting review in BlockDrawer. */
  pendingBlockCommand: PendingBlockCommand | null;
  setChatMode: (mode: ChatMode) => void;
  sendMessage: (content: string) => void;
  pushSystemMessage: (content: string) => void;
  clearMessages: () => void;
  investigate: (ctx: InvestigationContext) => void;
  clearInvestigation: () => void;
  cancelStream: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  clearPendingBlockCommand: () => void;
}

const ChatContext = createContext<ChatState | null>(null);

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}

let messageCounter = 0;
const nextId = (): string => `msg-${++messageCounter}`;

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [investigation, setInvestigation] =
    useState<InvestigationContext | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("investigate");
  const [pendingBlockCommand, setPendingBlockCommand] =
    useState<PendingBlockCommand | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), []);
  const clearPendingBlockCommand = useCallback(() => setPendingBlockCommand(null), []);

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
        .filter((m) => m.role !== "system")
        .slice(-20)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }));

      // Create a placeholder assistant message for streaming
      const assistantId = pushMessage("assistant", "");
      setIsStreaming(true);
      let accumulated = "";

      const controller = streamFetchSSE(
        "/api/investigate",
        { conversation, mode: chatMode },
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
            } else {
              const { cleanText, commands } = parseAndStripCommands(accumulated);

              // If commands were stripped, update the displayed message
              if (commands.length > 0 && cleanText !== accumulated) {
                const suffix = commands.some((c) => c.action === "create_manual_block")
                  ? "\n\nReview the pre-filled form and submit when ready."
                  : "";
                updateMessage(assistantId, (cleanText || "Preparing your block.") + suffix);
              }

              // Route create_manual_block → BlockDrawer
              const blockCmd = commands.find((c) => c.action === "create_manual_block");
              if (blockCmd) {
                setPendingBlockCommand({ params: blockCmd.params });
              }

              // Auto-execute non-interactive commands (create_stream, etc.)
              executeNonInteractiveCommands(commands).then((results) => {
                for (const msg of results) {
                  pushMessage("system", msg);
                }
              });
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
    [pushMessage, updateMessage, chatMode],
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
      // Phase 1 redesign: investigate() no longer auto-opens any drawer. The
      // workbench rail listens for `investigation` and surfaces its Chat tab
      // when set. Cell clicks set focus only — chat is now a deliberate
      // gesture from the Inspector ("Ask @Posit") or the explicit Chat
      // toggle (⌘/), never a side-effect of clicking on a value.
      setInvestigation(ctx);
    },
    [],
  );

  const clearInvestigation = useCallback(() => {
    setInvestigation(null);
  }, []);

  const pushSystemMessage = useCallback(
    (content: string) => {
      pushMessage("system", content);
    },
    [pushMessage],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setInvestigation(null);
  }, []);

  const value = useMemo<ChatState>(
    () => ({
      messages,
      investigation,
      isStreaming,
      drawerOpen,
      chatMode,
      pendingBlockCommand,
      setChatMode,
      sendMessage,
      pushSystemMessage,
      clearMessages,
      investigate,
      clearInvestigation,
      cancelStream,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      clearPendingBlockCommand,
    }),
    [
      messages,
      investigation,
      isStreaming,
      drawerOpen,
      chatMode,
      pendingBlockCommand,
      sendMessage,
      pushSystemMessage,
      clearMessages,
      investigate,
      clearInvestigation,
      cancelStream,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      clearPendingBlockCommand,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
