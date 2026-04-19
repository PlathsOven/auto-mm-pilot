import { useState } from "react";
import type { StreamDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { LiveEquationStrip } from "../../equation/LiveEquationStrip";
import { configureStream, createStream, ingestSnapshot } from "../../../services/streamApi";
import type { RegisteredStream } from "../../../types";

interface Props {
  draft: StreamDraft;
  state: SectionState;
  allValid: boolean;
  /** Name of the already-registered stream when the form is editing an
   *  existing one. Null for brand-new drafts — Activate creates it on the fly. */
  pendingStreamName: string | null;
  /** Fired when Activate had to create the stream before configuring it,
   *  so the parent can update its local `pendingStreamName` + registry
   *  cache (they need to stay in sync). Does NOT navigate — the URL change
   *  is deferred to `onActivated` to avoid a mid-activation remount. */
  onStreamCreated: (created: RegisteredStream) => void;
  /** Fired once the full Activate lifecycle (create if needed → configure
   *  → ingest) succeeds. Receives the final stream name so the parent can
   *  navigate + pan the DAG. */
  onActivated: (streamName: string) => void;
  dimmed?: boolean;
}

interface ActivationResult {
  type: "success" | "error";
  message: string;
}

/**
 * Final canvas section. Shows live equation context and an Activate button.
 *
 * Activate flow:
 *   1. Call POST /api/streams/{name}/configure with target_mapping + block_shape
 *   2. If sample CSV is non-empty, ingest those rows via POST /api/snapshots
 *   3. Stream transitions PENDING → READY and Floor positions update
 */
export function PreviewSection({
  draft,
  state,
  allValid,
  pendingStreamName,
  onStreamCreated,
  onActivated,
  dimmed,
}: Props) {
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState<ActivationResult | null>(null);

  const handleActivate = async () => {
    if (!allValid) return;
    setActivating(true);
    setResult(null);
    try {
      // Create-on-the-fly: if the form is in create mode (no pendingStreamName),
      // Activate owns the full lifecycle — create, configure, ingest — so the
      // user doesn't have to press two separate buttons. Configure + ingest
      // stay identical to the edit-mode flow below, just with the freshly
      // created name.
      let targetName = pendingStreamName;
      if (!targetName) {
        if (!draft.identity.stream_name) {
          setResult({ type: "error", message: "Stream name is required." });
          return;
        }
        const created = await createStream(
          draft.identity.stream_name,
          draft.identity.key_cols,
        );
        targetName = created.stream_name;
        onStreamCreated(created);
      }

      await configureStream(targetName, {
        scale: draft.target_mapping.scale,
        offset: draft.target_mapping.offset,
        exponent: draft.target_mapping.exponent,
        block: {
          annualized: draft.block_shape.annualized,
          size_type: draft.block_shape.size_type,
          aggregation_logic: draft.aggregation.aggregation_logic,
          temporal_position: draft.block_shape.temporal_position,
          decay_end_size_mult: draft.block_shape.decay_end_size_mult,
          decay_rate_prop_per_min: draft.block_shape.decay_rate_prop_per_min,
          decay_profile: "linear",
          var_fair_ratio: draft.confidence.var_fair_ratio,
        },
      });

      const csvRows = parseCsvToRows(draft.data_shape.sample_csv);
      if (csvRows.length > 0) {
        await ingestSnapshot(targetName, csvRows);
      }

      setResult({
        type: "success",
        message: `Activated ${targetName}. Floor positions will update on the next pipeline tick.`,
      });
      onActivated(targetName);
    } catch (err) {
      setResult({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActivating(false);
    }
  };

  return (
    <SectionCard
      title="Preview & Activate"
      number={7}
      status={state.status}
      dimmed={dimmed}
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
            <DraftRow label="Aggregation" value={draft.aggregation.aggregation_logic} />
            <DraftRow label="Temporal" value={draft.block_shape.temporal_position} />
          </dl>
        </div>

        {result && (
          <div
            className={`rounded-md border p-2 text-[10px] ${
              result.type === "success"
                ? "border-mm-accent/40 bg-mm-accent/10 text-mm-accent"
                : "border-mm-error/40 bg-mm-error/10 text-mm-error"
            }`}
          >
            {result.message}
          </div>
        )}

        <button
          type="button"
          disabled={!allValid || activating}
          onClick={handleActivate}
          className="rounded-lg bg-mm-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {activating ? "Activating…" : "Activate stream"}
        </button>
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

// Strict numeric — matches whole-string integers, decimals, scientific
// notation, with an optional leading sign. Critically rejects `"27MAR26"`
// which `parseFloat` would otherwise parse as `27`.
const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/** Parse pasted CSV into row objects suitable for /api/snapshots. */
function parseCsvToRows(csv: string): Record<string, unknown>[] {
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
