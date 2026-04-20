import type { StreamDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { LiveEquationStrip } from "../../equation/LiveEquationStrip";
import { NUMERIC_RE } from "../../../utils";

interface Props {
  draft: StreamDraft;
  state: SectionState;
}

/**
 * Final canvas section. Shows live equation context and a read-only draft
 * summary. The Activate button lives in `<StreamCanvasFooter/>` so it stays
 * pinned at the bottom of the canvas — the architect doesn't have to scroll
 * through every section to find the CTA.
 */
export function PreviewSection({ draft, state }: Props) {
  return (
    <SectionCard
      title="Preview"
      number={6}
      status={state.status}
    >
      <div className="grid gap-3">
        <LiveEquationStrip size="lg" />

        <div className="rounded-md border border-black/[0.06] bg-black/[0.03] p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-mm-text-dim">
            Draft summary
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            <DraftRow label="Stream" value={draft.identity.stream_name || "—"} />
            <DraftRow label="Key cols" value={draft.identity.key_cols.join(", ") || "—"} />
            <DraftRow label="Scale" value={draft.target_mapping.scale.toString()} />
            <DraftRow label="Offset" value={draft.target_mapping.offset.toString()} />
            <DraftRow label="Exponent" value={draft.target_mapping.exponent.toString()} />
            <DraftRow label="var_fair_ratio" value={draft.confidence.var_fair_ratio.toString()} />
            <DraftRow label="Temporal" value={draft.block_shape.temporal_position} />
          </dl>
        </div>
      </div>
    </SectionCard>
  );
}

function DraftRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-mm-text-dim">{label}</dt>
      <dd className="font-mono text-mm-text">{value}</dd>
    </>
  );
}

/** Parse pasted CSV into row objects suitable for /api/snapshots. */
export function parseCsvToRows(csv: string): Record<string, unknown>[] {
  const lines = csv
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const cell = cells[i] ?? "";
      row[h] = NUMERIC_RE.test(cell) ? parseFloat(cell) : cell;
    });
    return row;
  });
}
