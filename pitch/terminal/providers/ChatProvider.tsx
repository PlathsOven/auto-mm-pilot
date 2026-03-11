"use client";

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
  { sender: "Sjoerd Stevens", content: "BTC front-month gamma is getting heavy — anyone else seeing the same?" },
  { sender: "James Okafor", content: "Funding rates diverging again on ETH perps vs opts. Worth watching." },
  { sender: "Sarah Lin", content: "Risk limits all green. We have headroom if we want to lean into the back-month." },
  { sender: "Sjoerd Stevens", content: "Just got off the phone with the OTC desk — large clip of BTC Apr puts traded." },
  { sender: "James Okafor", content: "The vol surface is starting to steepen. Could be a regime shift setting up." },
  { sender: "Sarah Lin", content: "Reminder: EOD P&L snapshot due in 45 min." },
];

/** Mock APT responses — uses investigation.py §5/§6 compliant language */
const APT_RESPONSES = [
  "Realized vol stream is up over the last 6 hours. Fair value for BTC 27MAR increased. Market implied hasn't moved as much. Edge more positive — more long.",
  "Correlation between BTC and ETH is increasing. More long BTC near-dated, so less long ETH near-dated to keep net correlated exposure the same.",
  "FOMC event has passed. Fair value for expiries spanning that date is decreasing as the vol bump decays. Market implied getting offered but not as fast. Edge less positive — less long.",
  "Historical IV for ETH 25APR is at the 12th percentile. Fair value is above market implied. Edge positive — long. Back-month confidence is high given stable realized vol stream.",
  "Realized vol increased, but market implied got bid even higher. Edge actually less positive despite higher fair value. Less long BTC near-dated.",
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
