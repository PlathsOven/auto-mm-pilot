import { useMemo, useState } from "react";
import type { BuildStageEvent } from "../../types";

const STAGE_LABELS: Record<BuildStageEvent["kind"], string> = {
  router: "Router",
  intent: "Intent",
  synthesis: "Synthesis",
  critique: "Critique",
  proposal: "Proposal",
  error: "Error",
};

function stageSummary(ev: BuildStageEvent): string {
  if (ev.kind === "error") return ev.message.slice(0, 80);
  const source = ev.kind === "proposal" ? ev.payload : ev.output;
  if (source && typeof source === "object") {
    const obj = source as Record<string, unknown>;
    if (ev.kind === "router" && typeof obj.category === "string") {
      return typeof obj.confidence === "number"
        ? `${obj.category} (${obj.confidence.toFixed(2)})`
        : String(obj.category);
    }
    if (ev.kind === "intent") {
      if (typeof obj.clarifying_question === "string" && obj.clarifying_question) return "clarifying question";
      if (obj.structured && typeof obj.structured === "object") {
        const kind = (obj.structured as Record<string, unknown>).kind;
        return typeof kind === "string" ? `structured · ${kind}` : "structured";
      }
      if (obj.raw) return "raw";
    }
    if (ev.kind === "synthesis") {
      const choice = obj.choice as Record<string, unknown> | undefined;
      if (choice) {
        if (choice.mode === "preset" && typeof choice.preset_id === "string") {
          return `preset · ${choice.preset_id}`;
        }
        if (choice.mode === "custom") return "custom derivation";
      }
    }
    if (ev.kind === "critique") {
      if (typeof obj.passes === "boolean") {
        return obj.passes ? "passes" : "concerns raised";
      }
    }
    if (ev.kind === "proposal" && typeof obj.stream_name === "string") {
      return String(obj.stream_name);
    }
  }
  return "";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded bg-white/50 px-1.5 py-0.5 text-[9px] font-mono text-mm-text-subtle hover:text-mm-accent"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copy to clipboard"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function stageJsonBody(ev: BuildStageEvent): string {
  if (ev.kind === "error") return ev.message;
  const source = ev.kind === "proposal" ? ev.payload : ev.output;
  return JSON.stringify(source, null, 2);
}

function StageRow({ ev, idx }: { ev: BuildStageEvent; idx: number }) {
  const body = useMemo(() => stageJsonBody(ev), [ev]);
  const summary = stageSummary(ev);
  const isError = ev.kind === "error";
  // Metadata fields are present on all stage kinds except "error".
  const meta = !isError ? (ev as BuildStageEvent & {
    elapsed_ms?: number; model_used?: string | null;
    tokens_in?: number; tokens_out?: number;
  }) : null;
  const modelShort =
    meta?.model_used?.split("/").pop() ?? null;
  const tokensLabel =
    meta && (meta.tokens_in || meta.tokens_out)
      ? `${meta.tokens_in ?? 0} → ${meta.tokens_out ?? 0} tok`
      : null;
  return (
    <details className="group rounded border border-black/[0.06] bg-white/40">
      <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[10px] font-mono text-mm-text-subtle hover:text-mm-text">
        <span className="w-4 text-right tabular-nums text-mm-text-dim">{idx + 1}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
            isError
              ? "bg-mm-warn/15 text-mm-warn"
              : "bg-mm-accent/10 text-mm-accent"
          }`}
        >
          {STAGE_LABELS[ev.kind]}
        </span>
        {summary && (
          <span className="truncate text-mm-text-dim">{summary}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[9px] text-mm-text-dim">
          {meta?.elapsed_ms !== undefined && (
            <span className="tabular-nums">{meta.elapsed_ms.toFixed(0)} ms</span>
          )}
          {modelShort && <span>{modelShort}</span>}
          {tokensLabel && <span className="tabular-nums">{tokensLabel}</span>}
          <CopyButton text={body} />
        </span>
      </summary>
      <pre className="max-h-64 overflow-auto border-t border-black/[0.04] bg-white/60 px-2 py-1.5 font-mono text-[10px] leading-snug text-mm-text-subtle">
        {body}
      </pre>
    </details>
  );
}

function totalsLine(stages: BuildStageEvent[]): string {
  let total_ms = 0;
  let tokens_in = 0;
  let tokens_out = 0;
  for (const ev of stages) {
    if (ev.kind === "error") continue;
    const m = ev as BuildStageEvent & {
      elapsed_ms?: number; tokens_in?: number; tokens_out?: number;
    };
    total_ms += m.elapsed_ms ?? 0;
    tokens_in += m.tokens_in ?? 0;
    tokens_out += m.tokens_out ?? 0;
  }
  const parts = [`${stages.length} stage${stages.length === 1 ? "" : "s"}`];
  if (total_ms > 0) parts.push(`${total_ms.toFixed(0)} ms`);
  if (tokens_in + tokens_out > 0) parts.push(`${tokens_in + tokens_out} tok`);
  return parts.join(" · ");
}

export function StageThinking({
  stages, turnId,
}: { stages: BuildStageEvent[]; turnId?: string }) {
  if (stages.length === 0) return null;
  return (
    <details className="mb-1.5 rounded-md border border-black/[0.05] bg-black/[0.02]">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-mm-text-subtle hover:text-mm-text">
        <span>Thinking</span>
        <span className="font-mono text-[9px] normal-case tracking-normal text-mm-text-dim">
          {totalsLine(stages)}
        </span>
        {turnId && (
          <span className="ml-auto flex items-center gap-1 font-mono text-[9px] normal-case tracking-normal text-mm-text-dim">
            <span title="conversation_turn_id">turn {turnId.slice(0, 8)}</span>
            <CopyButton text={turnId} />
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-1 p-1.5">
        {stages.map((ev, i) => (
          <StageRow key={i} ev={ev} idx={i} />
        ))}
      </div>
    </details>
  );
}
