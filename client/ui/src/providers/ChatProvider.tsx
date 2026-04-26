import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  BuildStageEvent,
  ChatMessage,
  ChatMode,
  IntentOutput,
  InvestigationContext,
  PendingBlockCommand,
  PreviewResponse,
  ProposedBlockPayload,
  SynthesisOutput,
} from "../types";
import { streamFetchSSE } from "../services/api";
import {
  commitBlock,
  logFailure,
  previewBlock,
  streamBuildConverse,
} from "../services/buildApi";
import { parseAndStripCommands, executeNonInteractiveCommands } from "../services/engineCommands";

/** Bundle of everything the ProposalPreviewDrawer needs to render +
 *  commit: the payload (what to create), the intent (why), the synthesis
 *  (preset vs. custom derivation), and the preview diff.
 *
 *  ``conversation_turn_id`` is the orchestrator's audit identifier for
 *  the turn that produced this proposal — attached to any failure
 *  signals (preview_rejection) the client emits. */
export interface PendingProposal {
  payload: ProposedBlockPayload;
  intent: IntentOutput;
  synthesis: SynthesisOutput;
  preview: PreviewResponse;
  conversation_turn_id: string | null;
}

interface ChatState {
  messages: ChatMessage[];
  investigation: InvestigationContext | null;
  isStreaming: boolean;
  /** Whether the WorkbenchRail's Chat tab is currently surfaced. */
  drawerOpen: boolean;
  chatMode: ChatMode;
  /** Pending manual-block command awaiting review in BlockDrawer.
   *  Populated by the legacy engineCommands fence parser (Investigate
   *  mode only; Build mode now goes through pendingProposal). */
  pendingBlockCommand: PendingBlockCommand | null;
  /** Build-mode proposal awaiting Confirm / Cancel in the
   *  ProposalPreviewDrawer. Carries the full Stage 1–4 trace so the
   *  commit endpoint persists the intent triplet on approval. */
  pendingProposal: PendingProposal | null;
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
  /** User confirmed in the preview drawer — commit the block. */
  confirmProposal: () => Promise<void>;
  /** User cancelled — clear the pending proposal (no server call in M3). */
  cancelProposal: () => void;
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
  const [pendingProposal, setPendingProposal] =
    useState<PendingProposal | null>(null);
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

  const appendStage = useCallback((id: string, event: BuildStageEvent) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, stages: [...(m.stages ?? []), event] } : m,
      ),
    );
  }, []);

  const setMessageTurnId = useCallback((id: string, turn_id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, turn_id } : m)),
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

      // Build mode runs through the five-stage orchestrator endpoint.
      // Investigate + General keep the legacy fence-parsing path.
      if (chatMode === "build") {
        // Stage 2 and Stage 3 outputs arrive as separate SSE events
        // before the final proposal. Accumulate them so the commit
        // endpoint gets the full Stage 1–4 trace when the trader
        // confirms in the preview drawer.
        let latestIntent: IntentOutput | null = null;
        let latestSynthesis: SynthesisOutput | null = null;
        // Orchestrator's conversation_turn_id — captured from the Stage 1
        // event and threaded through into preview_rejection signals.
        let turnId: string | null = null;
        // Flipped when an error event is surfaced so ``onDone`` doesn't
        // clobber the shown error with "No response received".
        let hadError = false;

        const controller = streamBuildConverse(
          { conversation },
          {
            onDelta: (text) => {
              accumulated += text;
              updateMessage(assistantId, accumulated);
            },
            onTurnId: (id) => {
              turnId = id;
              setMessageTurnId(assistantId, id);
            },
            onStageOutput: (stage, output, meta) => {
              appendStage(assistantId, { kind: stage, output, ...meta });
              if (stage === "intent") {
                latestIntent = output as IntentOutput;
              } else if (stage === "synthesis") {
                latestSynthesis = output as SynthesisOutput;
              }
            },
            onProposal: (payload, meta) => {
              appendStage(assistantId, { kind: "proposal", payload, ...meta });
              const intent = latestIntent;
              const synthesis = latestSynthesis;
              if (!intent || !synthesis) {
                pushMessage(
                  "system",
                  "Internal error: proposal arrived before intent/synthesis.",
                );
                return;
              }
              const tail =
                payload.action === "create_manual_block"
                  ? "Preparing preview — review the impact and confirm to create the block."
                  : `Preparing to register ${payload.stream_name} — review and confirm.`;
              accumulated = accumulated
                ? `${accumulated}\n\n${tail}`
                : tail;
              updateMessage(assistantId, accumulated);

              const capturedTurnId = turnId;
              previewBlock(payload)
                .then((preview) => {
                  setPendingProposal({
                    payload, intent, synthesis, preview,
                    conversation_turn_id: capturedTurnId,
                  });
                })
                .catch((err) => {
                  const detail = err instanceof Error ? err.message : String(err);
                  pushMessage("system", `Preview failed: ${detail}`);
                });
            },
            onDone: () => {
              setIsStreaming(false);
              abortRef.current = null;
              if (!accumulated && !hadError) {
                updateMessage(assistantId, "No response received from the engine.");
              }
            },
            onError: (error) => {
              hadError = true;
              appendStage(assistantId, { kind: "error", message: error });
              setIsStreaming(false);
              abortRef.current = null;
              updateMessage(
                assistantId,
                accumulated
                  ? `${accumulated}\n\n⚠ ${error}`
                  : `⚠ ${error}`,
              );
            },
          },
        );
        abortRef.current = controller;
        return;
      }

      const controller = streamFetchSSE(
        "/api/investigate",
        { conversation, mode: chatMode },
        {
          onDelta: (raw) => {
            accumulated += typeof raw === "string" ? raw : String(raw);
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

  const cancelProposal = useCallback(() => {
    const proposal = pendingProposal;
    setPendingProposal(null);
    if (!proposal) return;
    // Fire-and-forget: the signal is analytics-only; if it fails the
    // trader has already moved on and shouldn't be bothered.
    logFailure({
      signal_type: "preview_rejection",
      conversation_turn_id: proposal.conversation_turn_id,
      metadata: {
        action: proposal.payload.action,
        stream_name: proposal.payload.stream_name,
      },
    }).catch(() => {});
  }, [pendingProposal]);

  const confirmProposal = useCallback(async () => {
    const proposal = pendingProposal;
    if (!proposal) return;
    try {
      const resp = await commitBlock({
        payload: proposal.payload,
        intent: proposal.intent,
        synthesis: proposal.synthesis,
        preview: proposal.preview,
      });
      pushMessage(
        "system",
        `\u2713 Stream '${resp.stream_name}' committed (intent id ${resp.stored_intent_id.slice(0, 8)}).`,
      );
      setPendingProposal(null);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      pushMessage("system", `\u2717 Commit failed: ${detail}`);
      // Keep the drawer open so the trader can retry.
      throw err;
    }
  }, [pendingProposal, pushMessage]);

  const value = useMemo<ChatState>(
    () => ({
      messages,
      investigation,
      isStreaming,
      drawerOpen,
      chatMode,
      pendingBlockCommand,
      pendingProposal,
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
      confirmProposal,
      cancelProposal,
    }),
    [
      messages,
      investigation,
      isStreaming,
      drawerOpen,
      chatMode,
      pendingBlockCommand,
      pendingProposal,
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
      confirmProposal,
      cancelProposal,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
