import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { RegisteredStream } from "../../../types";
import { PIPELINE_ORDER, STEP_LABELS, type StepKey } from "./anatomyGraph";
import type { AnatomySelection } from "./NodeDetailPanel";

interface Props {
  streams: RegisteredStream[];
  selection: AnatomySelection;
  onJumpStream: (streamName: string) => void;
  onJumpTransform: (stepKey: StepKey) => void;
  onJumpCorrelations: () => void;
  onJumpOutput: () => void;
}

const OUTPUT_ROW_LABEL = "Desired Positions";

/**
 * Top-left glassmorphic overlay listing every Anatomy node for instant
 * navigation. Click a row → the canvas pans/zooms to the node and opens
 * its inspector (same gesture as clicking the node itself). Collapses
 * to a chip-handle when the trader wants unobstructed access to the DAG.
 */
export function AnatomyNodeList({
  streams,
  selection,
  onJumpStream,
  onJumpTransform,
  onJumpCorrelations,
  onJumpOutput,
}: Props) {
  const [open, setOpen] = useState(true);

  const selectedStreamName =
    selection.kind === "stream" ? selection.streamName : null;
  const selectedStepKey =
    selection.kind === "transform" ? selection.stepKey : null;
  const correlationsSelected = selection.kind === "correlations";

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start">
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel pointer-events-auto flex w-[220px] flex-col overflow-hidden"
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2">
              <span className="zone-header">Nodes</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse node list"
                title="Collapse"
                className="rounded p-0.5 text-[11px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
              >
                ▾
              </button>
            </header>

            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-2 py-2">
              <Section title="Streams">
                {streams.length === 0 ? (
                  <EmptyRow label="No streams yet" />
                ) : (
                  streams.map((s) => (
                    <Row
                      key={s.stream_name}
                      label={s.stream_name}
                      mono
                      selected={selectedStreamName === s.stream_name}
                      dim={!s.active}
                      onClick={() => onJumpStream(s.stream_name)}
                    />
                  ))
                )}
              </Section>

              <Section title="Pipeline">
                {PIPELINE_ORDER.map((key, i) => (
                  <Row
                    key={key}
                    index={i + 1}
                    label={STEP_LABELS[key]}
                    selected={
                      key === "correlations"
                        ? correlationsSelected
                        : selectedStepKey === key
                    }
                    onClick={() =>
                      key === "correlations"
                        ? onJumpCorrelations()
                        : onJumpTransform(key)
                    }
                  />
                ))}
              </Section>

              <Section title="Output">
                <Row label={OUTPUT_ROW_LABEL} accent onClick={onJumpOutput} />
              </Section>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="collapsed"
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Expand node list"
            title="Nodes"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-mm-text transition-colors hover:text-mm-accent"
          >
            <span className="text-mm-text-dim">▸</span>
            <span>Nodes</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="px-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
        {title}
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

interface RowProps {
  label: string;
  onClick: () => void;
  selected?: boolean;
  index?: number;
  mono?: boolean;
  dim?: boolean;
  accent?: boolean;
}

function Row({ label, onClick, selected, index, mono, dim, accent }: RowProps) {
  const base =
    "group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors";
  const state = selected
    ? "bg-mm-accent/15 text-mm-accent ring-1 ring-mm-accent/30"
    : accent
      ? "text-mm-accent hover:bg-mm-accent/10"
      : dim
        ? "text-mm-text-subtle hover:bg-black/[0.04] hover:text-mm-text"
        : "text-mm-text hover:bg-black/[0.04]";
  return (
    <li>
      <button type="button" onClick={onClick} className={`${base} ${state}`}>
        {index !== undefined && (
          <span className="w-3 shrink-0 text-right font-mono text-[9px] text-mm-text-dim">
            {index}
          </span>
        )}
        <span className={`truncate ${mono ? "font-mono" : ""}`}>{label}</span>
      </button>
    </li>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <li>
      <span className="block px-2 py-1 text-[10px] italic text-mm-text-subtle">
        {label}
      </span>
    </li>
  );
}
