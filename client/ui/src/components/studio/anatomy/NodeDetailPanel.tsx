import { useState } from "react";
import type { TransformParam, TransformStep } from "../../../types";
import type { StepKey } from "./anatomyGraph";
import { PIPELINE_NARRATIVE } from "./anatomyGraph";
import { StreamCanvas } from "../StreamCanvas";
import { StreamTable } from "../StreamTable";
import { NewStreamMenu } from "../NewStreamMenu";
import type { StreamDraftPrefill } from "../canvasState";

export type AnatomySelection =
  | { kind: "transform"; stepKey: StepKey }
  | { kind: "stream"; streamName: string }
  | { kind: "list" }
  | { kind: "none" };

interface Props {
  selection: AnatomySelection;
  steps: Record<string, TransformStep> | null;
  savingKey: string | null;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
  onClose: () => void;
  /** When the panel is in `list` mode and the user opens a specific stream
   *  from the table, the parent updates `selection` to the stream variant. */
  onOpenStream: (streamName: string) => void;
  /** Optional pre-filled values when deep-linking into a new stream form
   *  from the Notifications center. Applied only when `streamName === "new"`. */
  streamPrefill?: StreamDraftPrefill | null;
}

/**
 * Unified right-side inspector panel for the Anatomy canvas.
 *
 * Mounted whenever any node is selected — stream, transform, or otherwise.
 * Earlier the anatomy view had two competing sidebars (left for streams,
 * right for transforms); this single panel keeps the visual model
 * consistent: click a node → panel opens with that node's editor, click
 * the same node again or hit ✕ to close.
 *
 * For stream nodes the panel hosts the existing `<StreamCanvas/>` editor
 * (the same one the legacy left sidebar mounted), so stream configuration
 * lives in the same surface as transform configuration.
 */
export function NodeDetailPanel({
  selection,
  steps,
  savingKey,
  onSelectTransform,
  onParamChange,
  onClose,
  onOpenStream,
  streamPrefill,
}: Props) {
  const [streamFilter, setStreamFilter] = useState("");
  if (selection.kind === "none") return null;

  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-black/[0.08] bg-white/55">
      {selection.kind === "transform" && (
        <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
          {(() => {
            const step = steps?.[selection.stepKey];
            if (!step) {
              return <p className="text-[11px] text-mm-text-dim">Step not loaded.</p>;
            }
            return (
              <TransformDetail
                stepKey={selection.stepKey}
                step={step}
                saving={savingKey === selection.stepKey}
                onSelectTransform={onSelectTransform}
                onParamChange={onParamChange}
                onClose={onClose}
              />
            );
          })()}
        </div>
      )}

      {selection.kind === "stream" && (
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3">
            <div>
              <h3 className="zone-header">Stream</h3>
              <p className="mt-0.5 font-mono text-[10px] text-mm-text-dim">{selection.streamName}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
              title="Close (Esc)"
            >
              ✕
            </button>
          </header>
          {/* flex-col here is load-bearing: StreamCanvas's top-level div
              uses `flex-1` to take its parent's height, and `flex-1` only
              works inside a flex container. Without this, StreamCanvas
              stayed at content height and its internal `overflow-y-auto`
              had nothing to scroll against. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* The `key` forces a remount when either the target stream or
                the prefill identity changes. StreamCanvas uses `useState`
                initializers for its draft + pending-name state, so without
                remounting a second "Register this stream" CTA from the
                Notifications panel would see stale draft values. */}
            <StreamCanvas
              key={`${selection.streamName}:${streamPrefill?.streamName ?? ""}`}
              streamName={selection.streamName}
              templateId={null}
              prefill={streamPrefill ?? null}
            />
          </div>
        </div>
      )}

      {selection.kind === "list" && (
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3">
            <div>
              <h3 className="zone-header">Streams</h3>
              <p className="mt-0.5 text-[10px] text-mm-text-dim">Every data source feeding the pipeline.</p>
            </div>
            <div className="flex items-center gap-2">
              <NewStreamMenu
                onOpenBlank={() => onOpenStream("new")}
                onOpenTemplate={(_id) => onOpenStream("new")}
              />
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
          </header>
          <div className="border-b border-black/[0.06] px-4 py-3">
            <input
              type="text"
              value={streamFilter}
              onChange={(e) => setStreamFilter(e.target.value)}
              placeholder="Filter by name or key column…"
              className="form-input w-full"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <StreamTable filter={streamFilter} onFilterChange={setStreamFilter} onOpenStream={onOpenStream} />
          </div>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Transform detail (implementation picker + param editor)
// ---------------------------------------------------------------------------

function TransformDetail({
  stepKey,
  step,
  saving,
  onSelectTransform,
  onParamChange,
  onClose,
}: {
  stepKey: StepKey;
  step: TransformStep;
  saving: boolean;
  onSelectTransform: (stepKey: string, name: string) => void;
  onParamChange: (stepKey: string, paramName: string, value: unknown) => void;
  onClose: () => void;
}) {
  const selected = step.transforms.find((t) => t.name === step.selected);

  return (
    <section className="rounded-xl border border-black/[0.08] bg-black/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-mm-text">{step.label}</h3>
        <div className="flex items-center gap-2">
          {saving && <span className="text-[9px] text-mm-text-dim">saving…</span>}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <p className="mb-3 text-[10px] italic text-mm-text-dim">
        {PIPELINE_NARRATIVE[stepKey]}
      </p>

      <label className="mb-3 flex flex-col gap-1">
        <span className="text-[10px] font-medium text-mm-text-dim">Implementation</span>
        <select
          value={step.selected}
          onChange={(e) => onSelectTransform(stepKey, e.target.value)}
          className="form-input font-mono"
        >
          {step.transforms.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {selected?.description && (
        <p className="mb-3 text-[10px] leading-relaxed text-mm-text-dim">
          {selected.description}
        </p>
      )}

      {selected && selected.params.length > 0 && (
        <div className="mb-3 flex flex-col gap-2 border-t border-black/[0.04] pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Parameters
          </span>
          <div className="grid grid-cols-2 gap-2">
            {selected.params.map((param) => (
              <ParamInput
                key={param.name}
                param={param}
                value={step.params[param.name] ?? param.default}
                onChange={(name, val) => onParamChange(stepKey, name, val)}
              />
            ))}
          </div>
        </div>
      )}

      {selected?.formula && (
        <div className="mt-2 rounded-md border border-black/[0.06] bg-black/[0.03] p-2">
          <div className="text-[9px] uppercase tracking-wider text-mm-text-dim">Formula</div>
          <div className="mt-0.5 font-mono text-xs text-mm-accent">{selected.formula}</div>
        </div>
      )}

      <p
        className="mt-3 truncate border-t border-black/[0.04] pt-2 font-mono text-[9px] text-mm-text-dim"
        title={step.contract}
      >
        {step.contract}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Schema-driven param input (lifted verbatim from the old PipelineStepCard)
// ---------------------------------------------------------------------------

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: TransformParam;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}) {
  if (param.type === "bool") {
    return (
      <label className="flex items-center gap-2 rounded-md border border-black/[0.06] bg-black/[0.03] px-2 py-1.5">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(param.name, e.target.checked)}
          className="h-3 w-3 accent-mm-accent"
        />
        <span className="text-[10px] text-mm-text-dim">{param.name}</span>
      </label>
    );
  }

  if (param.type === "str" && param.options && param.options.length > 0) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-mm-text-dim">{param.name}</span>
        <select
          value={String(value ?? param.default ?? "")}
          onChange={(e) => onChange(param.name, e.target.value)}
          className="form-input font-mono"
        >
          {param.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (param.type === "float" || param.type === "int") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-mm-text-dim">{param.name}</span>
        <input
          type="number"
          value={value != null ? String(value) : ""}
          step={param.type === "int" ? 1 : "any"}
          min={param.min ?? undefined}
          max={param.max ?? undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(param.name, param.default);
              return;
            }
            onChange(
              param.name,
              param.type === "int" ? parseInt(raw, 10) : parseFloat(raw),
            );
          }}
          className="form-input font-mono"
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-mm-text-dim">{param.name}</span>
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(param.name, e.target.value)}
        className="form-input font-mono"
      />
    </label>
  );
}
