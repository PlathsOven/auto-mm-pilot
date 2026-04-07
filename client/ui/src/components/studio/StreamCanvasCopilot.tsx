import { useEffect, useRef, useState } from "react";
import { draftStreamFromDescription } from "../../services/llmApi";
import type { StreamDraft } from "./canvasState";

interface Props {
  /** Initial seed text from the Identity section's "what's your idea?" field. */
  seed: string;
  /**
   * Called when the LLM produces a parseable JSON draft. The canvas merges
   * the suggestion as ghost values that the architect accepts/rejects.
   */
  onSuggestion: (partial: Partial<StreamDraft>) => void;
}

interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Streaming LLM co-pilot for the Stream Canvas.
 *
 * Reuses `/api/investigate` SSE via `draftStreamFromDescription`. The directive
 * asks the model to return a structured JSON object; the parser tolerates
 * fenced code blocks and surrounding prose.
 */
export function StreamCanvasCopilot({ seed, onSuggestion }: Props) {
  const [input, setInput] = useState(seed);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseInfo, setParseInfo] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Re-seed if the parent's identity description changes
  useEffect(() => {
    setInput(seed);
  }, [seed]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    setError(null);
    setParseInfo(null);
    let acc = "";

    abortRef.current = draftStreamFromDescription(text, {
      onDelta: (delta) => {
        acc += delta;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: acc };
          return next;
        });
      },
      onDone: () => {
        setStreaming(false);
        abortRef.current = null;
        const parsed = parseStreamDraftJson(acc);
        if (parsed) {
          onSuggestion(parsed);
          setParseInfo("Suggestion applied — review the highlighted fields above.");
        } else {
          setParseInfo("Couldn't parse a structured draft from the response. Try rephrasing.");
        }
      },
      onError: (e) => {
        setStreaming(false);
        abortRef.current = null;
        setError(e);
      },
    });
  };

  const cancel = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-mm-border/40 px-3 py-2">
        <h3 className="text-xs font-semibold text-mm-accent">Stream Co-pilot</h3>
        <p className="mt-0.5 text-[10px] text-mm-text-dim">
          Describe the idea — the LLM drafts canvas values you can accept or reject.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <p className="text-[10px] text-mm-text-dim">
            Try: "I want to track CPI surprise as a vol predictor for BTC weeklies."
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-md px-2 py-1.5 text-[10px] ${
              m.role === "user"
                ? "bg-mm-bg/60 text-mm-text"
                : "border-l-2 border-mm-accent/50 bg-mm-accent/5 text-mm-text"
            }`}
          >
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-mm-text-dim">
              {m.role === "user" ? "You" : "APT"}
            </div>
            <pre className="whitespace-pre-wrap font-sans">{m.content || (streaming && i === messages.length - 1 ? "…" : "")}</pre>
          </div>
        ))}
        {error && (
          <p className="rounded-md border border-mm-error/40 bg-mm-error/10 p-1.5 text-[10px] text-mm-error">
            {error}
          </p>
        )}
        {parseInfo && (
          <p className="rounded-md border border-mm-border/40 bg-mm-bg/40 p-1.5 text-[10px] text-mm-text-dim">
            {parseInfo}
          </p>
        )}
      </div>

      <div className="border-t border-mm-border/40 p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your stream idea…"
          rows={2}
          className="form-input resize-none"
        />
        <div className="mt-1.5 flex justify-end gap-1.5">
          {streaming ? (
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-mm-warn/40 px-3 py-1 text-[10px] text-mm-warn transition-colors hover:bg-mm-warn/10"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              className="rounded-md bg-mm-accent/20 px-3 py-1 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30"
            >
              Draft
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON parsing — tolerant of fenced code blocks and surrounding prose.
// ---------------------------------------------------------------------------

function parseStreamDraftJson(raw: string): Partial<StreamDraft> | null {
  // Try to extract a JSON block (fenced or bare).
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/```\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const json = candidate.slice(start, end + 1);
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const partial: Partial<StreamDraft> = {};
    if (obj.identity && typeof obj.identity === "object") {
      const id = obj.identity as Record<string, unknown>;
      partial.identity = {
        stream_name: typeof id.stream_name === "string" ? id.stream_name : "",
        key_cols: Array.isArray(id.key_cols) ? id.key_cols.map(String) : ["symbol", "expiry"],
        description: typeof id.description === "string" ? id.description : "",
      };
    }
    if (obj.target_mapping && typeof obj.target_mapping === "object") {
      const tm = obj.target_mapping as Record<string, unknown>;
      partial.target_mapping = {
        scale: Number(tm.scale) || 1,
        offset: Number(tm.offset) || 0,
        exponent: Number(tm.exponent) || 1,
      };
    }
    if (obj.block_shape && typeof obj.block_shape === "object") {
      const bs = obj.block_shape as Record<string, unknown>;
      partial.block_shape = {
        annualized: bs.annualized !== false,
        size_type: (bs.size_type === "relative" ? "relative" : "fixed") as "fixed" | "relative",
        temporal_position: (bs.temporal_position === "static" ? "static" : "shifting") as
          | "static"
          | "shifting",
        decay_end_size_mult: Number(bs.decay_end_size_mult) || 1,
        decay_rate_prop_per_min: Number(bs.decay_rate_prop_per_min) || 0,
      };
    }
    if (obj.aggregation && typeof obj.aggregation === "object") {
      const ag = obj.aggregation as Record<string, unknown>;
      partial.aggregation = {
        aggregation_logic: (ag.aggregation_logic === "offset" ? "offset" : "average") as
          | "average"
          | "offset",
      };
    }
    if (obj.confidence && typeof obj.confidence === "object") {
      const c = obj.confidence as Record<string, unknown>;
      partial.confidence = { var_fair_ratio: Number(c.var_fair_ratio) || 1 };
    }
    return partial;
  } catch {
    return null;
  }
}
