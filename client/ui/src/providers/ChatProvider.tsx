import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { ChatMessage, InvestigationContext, CellNote } from "../types";
import { CURRENT_USER, MOCK_USERS, getCellNotes, addCellNote } from "./MockDataProvider";

interface NoteThread {
  cellKey: string;
  notes: CellNote[];
}

interface ChatState {
  messages: ChatMessage[];
  investigation: InvestigationContext | null;
  noteThread: NoteThread | null;
  sendMessage: (content: string) => void;
  investigate: (ctx: InvestigationContext) => void;
  clearInvestigation: () => void;
  openNoteThread: (cellKey: string) => void;
  closeNoteThread: () => void;
  addNote: (content: string) => void;
}

const ChatContext = createContext<ChatState>({
  messages: [],
  investigation: null,
  noteThread: null,
  sendMessage: () => {},
  investigate: () => {},
  clearInvestigation: () => {},
  openNoteThread: () => {},
  closeNoteThread: () => {},
  addNote: () => {},
});

export function useChat() {
  return useContext(ChatContext);
}

let msgCounter = 0;

function nextId(): string {
  msgCounter++;
  return `msg-${msgCounter}`;
}

/** Mock team chatter — other desk members occasionally post */
const TEAM_CHATTER = [
  { sender: "Anya Petrov", content: "BTC front-month gamma is getting heavy — anyone else seeing the same?" },
  { sender: "James Okafor", content: "Funding rates diverging again on ETH perps vs opts. Worth watching." },
  { sender: "Sarah Lin", content: "Risk limits all green. We have headroom if we want to lean into the back-month." },
  { sender: "Anya Petrov", content: "Just got off the phone with the OTC desk — large clip of BTC Apr puts traded." },
  { sender: "James Okafor", content: "The vol surface is starting to steepen. Could be a regime shift setting up." },
  { sender: "Sarah Lin", content: "Reminder: EOD P&L snapshot due in 45 min." },
];

/** Mock APT responses — investigation.py-style language */
const APT_RESPONSES = [
  "The engine is currently weighting the near-dated event window with elevated conviction. The tactical capture allocation reflects our short-term markout optimization — as we move past the catalyst timestamp, expect exposure to decay back toward the structural floor.",
  "Looking at the cross-asset sensitivity map, ETH and BTC are showing elevated co-movement. The engine is treating this as a temporary noise regime rather than a structural shift, so relative conviction in the independent signals remains intact.",
  "The position change you're seeing is primarily driven by signal erosion on the funding stream — the alpha horizon has shortened as the initial decay point passes. This is the engine transitioning from tactical to structural weighting naturally.",
  "Current desired exposure reflects a balance between elevated opportunity density on the back-month and compressed conviction on near-dated signals. The variance profile is dampening the front-end more aggressively given conflicting stream inputs.",
  "That's a good observation. The engine's relative conviction has shifted — the consensus smoothing across streams is now favoring the base volatility regime over the event-driven tactical overlay. Net effect is a compression in desired exposure.",
];

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [investigation, setInvestigation] =
    useState<InvestigationContext | null>(null);
  const [noteThread, setNoteThread] = useState<NoteThread | null>(null);

  const pushMessage = useCallback(
    (role: ChatMessage["role"], content: string, sender: string) => {
      const msg: ChatMessage = {
        id: nextId(),
        role,
        sender,
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg]);
    },
    [],
  );

  const sendMessage = useCallback(
    (content: string) => {
      pushMessage("user", content, CURRENT_USER.name);
      setInvestigation(null);

      const isAptQuery = /@APT\b/i.test(content);

      if (isAptQuery) {
        const stripped = content.replace(/@APT\s*/i, "").trim();
        setTimeout(() => {
          const response = stripped.length > 0
            ? APT_RESPONSES[Math.floor(Math.random() * APT_RESPONSES.length)]
            : "I'm ready to help. Click any cell or update card for context, or ask me directly about positions, edges, or uncertainty factors.";
          pushMessage("assistant", response, "APT");
        }, 800 + Math.random() * 1200);
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
    [pushMessage],
  );

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
      value={{ messages, investigation, noteThread, sendMessage, investigate, clearInvestigation, openNoteThread, closeNoteThread, addNote: addNoteToThread }}
    >
      {children}
    </ChatContext.Provider>
  );
}
