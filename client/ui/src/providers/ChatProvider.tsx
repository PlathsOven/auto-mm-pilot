import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ChatMessage, InvestigationContext, CellNote } from "../types";
import { CURRENT_USER, MOCK_USERS, getCellNotes, addCellNote } from "./MockDataProvider";
import { streamInvestigation } from "../services/llmApi";
import { createIdGenerator } from "../utils";

interface NoteThread {
  cellKey: string;
  notes: CellNote[];
}

interface ChatState {
  messages: ChatMessage[];
  investigation: InvestigationContext | null;
  noteThread: NoteThread | null;
  isStreaming: boolean;
  sendMessage: (content: string) => void;
  investigate: (ctx: InvestigationContext) => void;
  clearInvestigation: () => void;
  openNoteThread: (cellKey: string) => void;
  closeNoteThread: () => void;
  addNote: (content: string) => void;
  cancelStream: () => void;
}

const ChatContext = createContext<ChatState>({
  messages: [],
  investigation: null,
  noteThread: null,
  isStreaming: false,
  sendMessage: () => {},
  investigate: () => {},
  clearInvestigation: () => {},
  openNoteThread: () => {},
  closeNoteThread: () => {},
  addNote: () => {},
  cancelStream: () => {},
});

export function useChat() {
  return useContext(ChatContext);
}

const nextId = createIdGenerator("msg-");

/** Mock team chatter — other desk members occasionally post */
const TEAM_CHATTER = [
  { sender: "Sjoerd Stevens", content: "BTC front-month gamma is getting heavy — anyone else seeing the same?" },
  { sender: "James Okafor", content: "Funding rates diverging again on ETH perps vs opts. Worth watching." },
  { sender: "Sarah Lin", content: "Risk limits all green. We have headroom if we want to lean into the back-month." },
  { sender: "Sjoerd Stevens", content: "Just got off the phone with the OTC desk — large clip of BTC Apr puts traded." },
  { sender: "James Okafor", content: "The vol surface is starting to steepen. Could be a regime shift setting up." },
  { sender: "Sarah Lin", content: "Reminder: EOD P&L snapshot due in 45 min." },
];

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [investigation, setInvestigation] =
    useState<InvestigationContext | null>(null);
  const [noteThread, setNoteThread] = useState<NoteThread | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const pushMessage = useCallback(
    (role: ChatMessage["role"], content: string, sender: string): string => {
      const id = nextId();
      const msg: ChatMessage = { id, role, sender, content, timestamp: Date.now() };
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
      pushMessage("user", content, CURRENT_USER.name);
      setInvestigation(null);

      const isAptQuery = /@APT\b/i.test(content);

      if (isAptQuery) {
        // Build conversation history for the LLM (last 20 user+assistant messages)
        const recentMessages = [...messagesRef.current, { id: "", role: "user" as const, sender: CURRENT_USER.name, content, timestamp: Date.now() }];
        const conversation = recentMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-20)
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          }));

        // Create a placeholder assistant message for streaming
        const assistantId = pushMessage("assistant", "", "APT");
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
      } else {
        if (Math.random() < 0.5) {
          const others = MOCK_USERS.filter((u) => u.id !== CURRENT_USER.id);
          const responder = others[Math.floor(Math.random() * others.length)];
          const chatter = TEAM_CHATTER[Math.floor(Math.random() * TEAM_CHATTER.length)];
          setTimeout(() => {
            pushMessage("team", chatter.content, responder.name);
          }, 1500 + Math.random() * 3000);
        }
      }
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
    },
    [],
  );

  const clearInvestigation = useCallback(() => {
    setInvestigation(null);
  }, []);

  const openNoteThread = useCallback((cellKey: string) => {
    const notes = getCellNotes().filter((n) => n.cellKey === cellKey);
    setNoteThread({ cellKey, notes });
  }, []);

  const closeNoteThread = useCallback(() => {
    setNoteThread(null);
  }, []);

  const addNoteToThread = useCallback((content: string) => {
    if (!noteThread) return;
    const note = addCellNote(noteThread.cellKey, content);
    setNoteThread((prev) => prev ? { ...prev, notes: [note, ...prev.notes] } : null);
  }, [noteThread]);

  return (
    <ChatContext.Provider
      value={{ messages, investigation, noteThread, isStreaming, sendMessage, investigate, clearInvestigation, openNoteThread, closeNoteThread, addNote: addNoteToThread, cancelStream }}
    >
      {children}
    </ChatContext.Provider>
  );
}
