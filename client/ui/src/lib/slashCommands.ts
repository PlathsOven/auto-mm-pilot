import type { ChatMode } from "../types";

/**
 * Slash-command registry for the chat input.
 *
 * Each command consumes ``/name args...`` style input if the user's text
 * starts with ``/``. Commands are routed before the message is sent to the
 * LLM — if ``run`` returns ``true`` the input is absorbed locally (no LLM
 * round-trip).
 */

export interface SlashCtx {
  setChatMode: (mode: ChatMode) => void;
  clearMessages: () => void;
  pushSystemMessage: (text: string) => void;
  lastAssistantContent: string | null;
}

export interface SlashCommand {
  name: string;
  description: string;
  /** Returns true if the input was consumed (don't send to LLM). */
  run: (args: string, ctx: SlashCtx) => boolean;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "/clear",
    description: "Clear all messages in the conversation",
    run: (_args, { clearMessages, pushSystemMessage }) => {
      clearMessages();
      pushSystemMessage("Conversation cleared. Type /help for commands.");
      return true;
    },
  },
  {
    name: "/explain",
    description: "Switch to Investigate mode",
    run: (_args, { setChatMode, pushSystemMessage }) => {
      setChatMode("investigate");
      pushSystemMessage("Mode → Investigate");
      return true;
    },
  },
  {
    name: "/build",
    description: "Switch to Build mode (stream / opinion creation)",
    run: (_args, { setChatMode, pushSystemMessage }) => {
      setChatMode("build");
      pushSystemMessage("Mode → Build");
      return true;
    },
  },
  {
    name: "/general",
    description: "Switch to General mode (catch-all chat)",
    run: (_args, { setChatMode, pushSystemMessage }) => {
      setChatMode("general");
      pushSystemMessage("Mode → General");
      return true;
    },
  },
  {
    name: "/copy",
    description: "Copy the last assistant response to the clipboard",
    run: (_args, { lastAssistantContent, pushSystemMessage }) => {
      if (!lastAssistantContent) {
        pushSystemMessage("No assistant message to copy.");
        return true;
      }
      navigator.clipboard
        .writeText(lastAssistantContent)
        .then(() => pushSystemMessage("Copied last response to clipboard."))
        .catch(() => pushSystemMessage("Copy failed — clipboard permission denied."));
      return true;
    },
  },
  {
    name: "/help",
    description: "List available slash commands",
    run: (_args, { pushSystemMessage }) => {
      const lines = ["Slash commands:"];
      for (const c of SLASH_COMMANDS) lines.push(`  ${c.name} — ${c.description}`);
      lines.push("History: ↑ / ↓ to walk through previous prompts. Enter to send · Shift+Enter for newline.");
      pushSystemMessage(lines.join("\n"));
      return true;
    },
  },
];

/** Dispatch a ``/name args...`` string to the registry. Returns ``true`` if
 *  a command matched (caller should absorb the input). */
export function tryRunSlash(text: string, ctx: SlashCtx): boolean {
  if (!text.startsWith("/")) return false;
  const [name, ...rest] = text.split(/\s+/);
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  if (!cmd) return false;
  cmd.run(rest.join(" "), ctx);
  return true;
}
