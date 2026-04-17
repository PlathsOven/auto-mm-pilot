/**
 * Parse engine-command fenced code blocks from LLM markdown responses
 * and execute them via existing REST API calls.
 *
 * Two parse modes:
 *   1. Fenced:  ```engine-command\n{...}\n```
 *   2. Inline fallback:  engine-command {... balanced braces ...}
 */

import type { EngineCommand } from "../types";
import { createStream, configureStream } from "./streamApi";
import type { ConfigureStreamRequest } from "./streamApi";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Fenced code block with `engine-command` as the language identifier. */
const FENCED_RE = /```engine-command\n([\s\S]*?)```/g;

/**
 * Inline fallback — `engine-command` followed by a JSON object.
 * We match the opening `{` then walk braces to find the balanced close.
 */
const INLINE_PREFIX_RE = /engine-command\s*\{/g;

/** Walk from an opening `{` at `start` and return the balanced substring, or null. */
function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseCommand(json: string): EngineCommand | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed.action && parsed.params) {
      return { action: parsed.action, params: parsed.params };
    }
  } catch {
    // Malformed JSON — skip
  }
  return null;
}

/**
 * Extract all engine commands from markdown text.
 * Returns an array of { command, matchStart, matchEnd } so callers can strip
 * the command text from the displayed message.
 */
interface CommandMatch {
  command: EngineCommand;
  matchStart: number;
  matchEnd: number;
}

export function parseEngineCommandsWithRanges(text: string): CommandMatch[] {
  const matches: CommandMatch[] = [];
  const consumed = new Set<number>(); // start indices already matched

  // Pass 1: fenced code blocks (highest priority)
  for (const m of text.matchAll(FENCED_RE)) {
    const cmd = tryParseCommand(m[1]);
    if (cmd && m.index != null) {
      matches.push({ command: cmd, matchStart: m.index, matchEnd: m.index + m[0].length });
      consumed.add(m.index);
    }
  }

  // Pass 2: inline fallback (only if fenced didn't match)
  if (matches.length === 0) {
    for (const m of text.matchAll(INLINE_PREFIX_RE)) {
      if (m.index == null) continue;
      // The `{` is the last char of the match
      const braceStart = m.index + m[0].length - 1;
      if (consumed.has(m.index)) continue;
      const json = extractBalancedJson(text, braceStart);
      if (!json) continue;
      const cmd = tryParseCommand(json);
      if (cmd) {
        matches.push({ command: cmd, matchStart: m.index, matchEnd: braceStart + json.length });
        consumed.add(m.index);
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Strip + parse (used by ChatProvider)
// ---------------------------------------------------------------------------

export interface ParseResult {
  /** Message text with engine-command blocks removed. */
  cleanText: string;
  /** Parsed commands extracted from the text. */
  commands: EngineCommand[];
}

/**
 * Parse engine commands and strip their raw text from the message.
 * Returns cleaned text + the parsed commands.
 */
export function parseAndStripCommands(text: string): ParseResult {
  const matches = parseEngineCommandsWithRanges(text);
  if (matches.length === 0) return { cleanText: text, commands: [] };

  // Build clean text by removing matched ranges (iterate in reverse to preserve indices)
  const sorted = [...matches].sort((a, b) => b.matchStart - a.matchStart);
  let clean = text;
  for (const m of sorted) {
    clean = clean.slice(0, m.matchStart) + clean.slice(m.matchEnd);
  }

  // Trim leftover whitespace / blank lines
  clean = clean.replace(/\n{3,}/g, "\n\n").trim();

  return { cleanText: clean, commands: matches.map((m) => m.command) };
}

// ---------------------------------------------------------------------------
// Execution (for non-interactive commands like create_stream)
// ---------------------------------------------------------------------------

/**
 * Execute a single engine command and return a human-readable result message.
 * Only handles commands that should auto-execute (not create_manual_block).
 */
async function executeCommand(cmd: EngineCommand): Promise<string> {
  switch (cmd.action) {
    case "create_stream": {
      const p = cmd.params as Record<string, unknown>;
      const streamName = p.stream_name as string;
      const keyCols = p.key_cols as string[];
      await createStream(streamName, keyCols);
      try {
        const configPayload: ConfigureStreamRequest = {
          scale: p.scale as number,
          offset: p.offset as number,
          exponent: p.exponent as number,
          block: p.block as ConfigureStreamRequest["block"],
        };
        await configureStream(streamName, configPayload);
        return `\u2713 Stream '${streamName}' created and configured (READY). Connect your data source to start sending snapshots.`;
      } catch (configErr) {
        const detail = configErr instanceof Error ? configErr.message : String(configErr);
        return `\u2713 Stream '${streamName}' created, but configuration failed: ${detail}. Try configuring manually via Studio.`;
      }
    }
    default:
      return `Unknown engine-command action: ${cmd.action}`;
  }
}

/**
 * Execute commands that should auto-run (everything except create_manual_block).
 * Returns an array of result messages.
 */
export async function executeNonInteractiveCommands(
  commands: EngineCommand[],
): Promise<string[]> {
  const results: string[] = [];
  for (const cmd of commands) {
    if (cmd.action === "create_manual_block") continue; // handled by drawer
    try {
      const msg = await executeCommand(cmd);
      if (msg) results.push(msg);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const name =
        (cmd.params as Record<string, unknown>).stream_name ?? cmd.action;
      results.push(`\u2717 Failed to execute ${cmd.action} '${name}': ${detail}`);
    }
  }
  return results;
}
