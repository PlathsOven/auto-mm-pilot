import { findConnector, useConnectorCatalog } from "../../../hooks/useConnectorCatalog";
import type { StreamDraft, SectionState } from "../canvasState";
import { SectionCard } from "./SectionCard";
import { LiveEquationStrip } from "../../equation/LiveEquationStrip";
import { NUMERIC_RE } from "../../../utils";

interface Props {
  draft: StreamDraft;
  state: SectionState;
}

/**
 * Final canvas section. Shows live equation context and either a draft
 * summary (user-fed streams) or an SDK integration snippet
 * (connector-fed streams). The Activate button lives in
 * `<StreamCanvasFooter/>` so the architect doesn't have to scroll past
 * every section to find the CTA.
 */
export function PreviewSection({ draft, state }: Props) {
  const { connectors } = useConnectorCatalog();
  const connector = findConnector(connectors, draft.connector_name);
  return (
    <SectionCard
      title="Preview"
      number={6}
      status={state.status}
    >
      <div className="grid gap-3">
        <LiveEquationStrip size="lg" />

        {connector ? (
          <ConnectorIntegrationSnippet
            streamName={draft.identity.stream_name || "<stream_name>"}
            connector={connector}
          />
        ) : (
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
        )}
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

function ConnectorIntegrationSnippet({
  streamName,
  connector,
}: {
  streamName: string;
  connector: { name: string; input_key_cols: string[]; input_value_fields: { name: string }[] };
}) {
  // Multi-line dict literal so the snippet wraps naturally inside the ~400px
  // sidebar — a single-line `[{...}]` overflowed even with overflow-x-auto
  // because the outer card had no inner max-width constraint.
  const fieldLines = [
    `      "timestamp": "2026-01-01T00:00:00",`,
    ...connector.input_key_cols.map((k) => `      "${k}": "BTC",`),
    ...connector.input_value_fields.map((f) => `      "${f.name}": 68500.0,`),
  ];
  const snippet = [
    `await client.push_connector_input(`,
    `  "${streamName}",`,
    `  [`,
    `    {`,
    ...fieldLines,
    `    },`,
    `  ],`,
    `)`,
  ].join("\n");
  return (
    <div className="min-w-0 rounded-md border border-mm-accent/30 bg-mm-accent/[0.05] p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-mm-text-dim">
          SDK integration
        </span>
        <span className="truncate text-[9px] font-mono text-mm-accent">connector: {connector.name}</span>
      </div>
      <pre className="whitespace-pre-wrap break-words rounded-sm bg-black/[0.04] p-2 text-[10px] leading-snug text-mm-text">
        <code className="font-mono">{snippet}</code>
      </pre>
      <p className="mt-2 text-[9px] text-mm-text-dim">
        Posit computes <code className="font-mono">raw_value</code> from your inputs;
        positions update on the next pipeline tick.
      </p>
    </div>
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
