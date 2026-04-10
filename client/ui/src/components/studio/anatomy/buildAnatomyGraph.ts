import type { Node, Edge } from "@xyflow/react";
import type { TransformStep, RegisteredStream } from "../../../types";
import {
  PIPELINE_ORDER,
  PIPELINE_EDGES,
  PIPELINE_NARRATIVE,
  STEP_NODE_POSITIONS,
  OUTPUT_NODE_POSITION,
  STREAM_COLUMN_X,
  STREAM_ROW_HEIGHT,
  type StepKey,
} from "./anatomyGraph";

const STEP_LABELS: Record<StepKey, string> = {
  unit_conversion: "Unit Conversion",
  decay_profile: "Decay Profile",
  temporal_fair_value: "Temporal Fair Value",
  variance: "Variance",
  aggregation: "Aggregation",
  position_sizing: "Position Sizing",
  smoothing: "Smoothing",
};

const STREAM_EDGE_STYLE = { stroke: "rgba(129,140,248,0.5)", strokeWidth: 1.5 };
const PIPELINE_EDGE_STYLE = { stroke: "rgba(129,140,248,0.6)", strokeWidth: 1.5 };

export function buildAnatomyGraph(
  steps: Record<string, TransformStep>,
  streams: RegisteredStream[],
  savingKey: string | null,
  live: boolean,
  highlightedStreamNames: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const out: Node[] = [];
  const es: Edge[] = [];

  // Stream nodes stacked on the left
  const totalStreams = streams.length;
  const verticalCenter = 300 - (totalStreams * STREAM_ROW_HEIGHT) / 2;
  streams.forEach((s, i) => {
    out.push({
      id: `stream-${s.stream_name}`,
      type: "stream",
      position: {
        x: STREAM_COLUMN_X,
        y: verticalCenter + i * STREAM_ROW_HEIGHT,
      },
      data: {
        streamName: s.stream_name,
        status: s.status,
        keyCols: s.key_cols,
      },
      draggable: true,
      className: highlightedStreamNames.has(s.stream_name)
        ? "anatomy-node-highlighted"
        : undefined,
    });
    es.push({
      id: `e-stream-${s.stream_name}-uc`,
      source: `stream-${s.stream_name}`,
      target: "unit_conversion",
      type: "default",
      animated: live,
      style: STREAM_EDGE_STYLE,
    });
  });

  // Transform step nodes
  for (let i = 0; i < PIPELINE_ORDER.length; i++) {
    const key = PIPELINE_ORDER[i];
    const step = steps[key];
    if (!step) continue;
    out.push({
      id: key,
      type: "transform",
      position: STEP_NODE_POSITIONS[key],
      data: {
        stepNumber: i + 1,
        label: STEP_LABELS[key],
        selectedImpl: step.selected,
        subtitle: PIPELINE_NARRATIVE[key],
        saving: savingKey === key,
      },
      draggable: true,
    });
  }

  // Output node
  out.push({
    id: "output",
    type: "output",
    position: OUTPUT_NODE_POSITION,
    data: {},
    draggable: true,
  });

  // Pipeline edges (between transforms)
  for (const edge of PIPELINE_EDGES) {
    es.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "default",
      animated: live,
      style: PIPELINE_EDGE_STYLE,
      labelStyle: { fill: "#6e6e82", fontSize: 10, fontWeight: 500 },
      labelBgStyle: { fill: "#f4f4f7", fillOpacity: 0.9 },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 4,
    });
  }

  return { nodes: out, edges: es };
}
