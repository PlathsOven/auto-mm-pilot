import type { Node, Edge } from "@xyflow/react";
import type {
  ConnectorSchema,
  RegisteredStream,
  TransformStep,
} from "../../../types";
import {
  CONNECTOR_OFFSET,
  LANE_BANDS,
  LANE_BOUNDARIES,
  NODE_TRACKS,
  OUTPUT_NODE_POSITION,
  PIPELINE_EDGES,
  PIPELINE_NARRATIVE,
  PIPELINE_ORDER,
  STEP_NODE_POSITIONS,
  STREAM_COLUMN_X,
  STREAM_EDGE_LABEL,
  STREAM_ROW_HEIGHT,
  TRACK_COLORS,
  type StepKey,
  type TrackKey,
} from "./anatomyGraph";

const STEP_LABELS: Record<StepKey, string> = {
  unit_conversion: "Unit Conversion",
  temporal_fair_value: "Temporal Distribution",
  risk_space_aggregation: "Risk-Space Aggregation",
  market_value_inference: "Market Value Inference",
  aggregation: "Space Aggregation",
  calc_to_target: "Calc → Target",
  smoothing: "Smoothing",
  position_sizing: "Position Sizing",
  correlations: "Correlations",
};

const STREAM_EDGE_STROKE = "rgba(129,140,248,0.5)";
const PIPELINE_EDGE_STROKE_FALLBACK = "rgba(129,140,248,0.6)";
const STREAM_EDGE_STROKE_WIDTH = 1.5;
const PIPELINE_EDGE_STROKE_WIDTH = 1.75;

// Explicit dimensions — matched to each custom node's Tailwind classes.
// React Flow v12 uses these for layout immediately, so <MiniMap/> renders
// the node rectangles on first paint instead of waiting for DOM
// measurement (which produced a blank minimap earlier).
const STREAM_NODE_SIZE = { width: 200, height: 90 };
const ADD_STREAM_NODE_SIZE = { width: 200, height: 44 };
const CONNECTOR_NODE_SIZE = { width: 200, height: 90 };
const TRANSFORM_NODE_SIZE = { width: 240, height: 140 };
const OUTPUT_NODE_SIZE = { width: 220, height: 140 };

// Spacing between the last stream node and the "+ New stream" tile. Smaller
// than STREAM_ROW_HEIGHT because the tile is half-height — too much gap and
// it looks orphaned from the column.
const ADD_STREAM_GAP = 24;

const EDGE_LABEL_STYLE = { fill: "#4a4a5a", fontSize: 9, fontWeight: 500 };
const EDGE_LABEL_BG_STYLE = { fill: "#f4f4f7", fillOpacity: 0.92 };
const EDGE_LABEL_BG_PADDING: [number, number] = [6, 3];
const EDGE_LABEL_BG_RADIUS = 4;

export function buildAnatomyGraph(
  steps: Record<string, TransformStep>,
  streams: RegisteredStream[],
  savingKey: string | null,
  live: boolean,
  highlightedStreamNames: Set<string>,
  connectorCatalog: ConnectorSchema[] = [],
): { nodes: Node[]; edges: Edge[] } {
  const out: Node[] = [];
  const es: Edge[] = [];

  // Lane bands first — React Flow renders nodes in array order, so
  // pushing the bands ahead of everything else keeps them beneath
  // transform cards. zIndex: -1 reinforces this against later reorders.
  for (const band of LANE_BANDS) {
    out.push({
      id: band.id,
      type: "laneBand",
      position: { x: band.x, y: band.y },
      width: band.width,
      height: band.height,
      data: {
        label: band.label,
        width: band.width,
        height: band.height,
        tint: band.tint,
      },
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
  }

  // Stream nodes stacked on the left. The column is centred around y=300;
  // the trailing "+ New stream" tile counts as an extra row so the whole
  // column stays balanced regardless of stream count.
  const totalStreams = streams.length;
  const totalRows = totalStreams + 1;
  const verticalCenter = 300 - (totalRows * STREAM_ROW_HEIGHT) / 2;
  streams.forEach((s, i) => {
    const yPos = verticalCenter + i * STREAM_ROW_HEIGHT;
    out.push({
      id: `stream-${s.stream_name}`,
      type: "stream",
      position: {
        x: STREAM_COLUMN_X,
        y: yPos,
      },
      ...STREAM_NODE_SIZE,
      data: {
        streamName: s.stream_name,
        status: s.status,
        keyCols: s.key_cols,
        active: s.active,
        scale: s.scale,
        offset: s.offset,
        exponent: s.exponent,
        block: s.block,
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
      label: STREAM_EDGE_LABEL,
      style: { stroke: STREAM_EDGE_STROKE, strokeWidth: STREAM_EDGE_STROKE_WIDTH },
      labelStyle: EDGE_LABEL_STYLE,
      labelBgStyle: EDGE_LABEL_BG_STYLE,
      labelBgPadding: EDGE_LABEL_BG_PADDING,
      labelBgBorderRadius: EDGE_LABEL_BG_RADIUS,
    });

    // Connector-fed streams get a ConnectorNode upstream + an extra edge
    // labelled with the connector's input/output unit so the trader can
    // read provenance (input → connector → stream → pipeline) at a glance.
    if (s.connector_name) {
      const schema = connectorCatalog.find((c) => c.name === s.connector_name);
      const displayName = schema?.display_name ?? s.connector_name;
      const inputLabel = schema
        ? `${schema.input_key_cols.join(", ")} + ${schema.input_value_fields.map((f) => f.name).join(", ")}`
        : "input";
      const outputLabel = schema?.output_unit_label ?? "raw_value";
      const connectorId = `connector-${s.stream_name}`;
      out.push({
        id: connectorId,
        type: "connector",
        position: {
          x: STREAM_COLUMN_X - CONNECTOR_OFFSET,
          y: yPos,
        },
        ...CONNECTOR_NODE_SIZE,
        data: {
          streamName: s.stream_name,
          connectorName: s.connector_name,
          displayName,
          inputLabel,
          outputLabel,
        },
        draggable: true,
      });
      es.push({
        id: `e-${connectorId}-stream-${s.stream_name}`,
        source: connectorId,
        target: `stream-${s.stream_name}`,
        type: "default",
        animated: live,
        label: outputLabel,
        style: { stroke: STREAM_EDGE_STROKE, strokeWidth: STREAM_EDGE_STROKE_WIDTH },
        labelStyle: EDGE_LABEL_STYLE,
        labelBgStyle: EDGE_LABEL_BG_STYLE,
        labelBgPadding: EDGE_LABEL_BG_PADDING,
        labelBgBorderRadius: EDGE_LABEL_BG_RADIUS,
      });
    }
  });

  // "+ New stream" tile — sits directly under the last stream. Click routes
  // through AnatomyCanvas.onNodeClick → openStream("new") which opens a
  // blank StreamCanvas in the right detail panel.
  out.push({
    id: "add-stream",
    type: "addStream",
    position: {
      x: STREAM_COLUMN_X,
      y: verticalCenter + totalStreams * STREAM_ROW_HEIGHT + ADD_STREAM_GAP,
    },
    ...ADD_STREAM_NODE_SIZE,
    data: {},
    draggable: false,
    selectable: false,
  });

  // Main transform step nodes.
  let displayedIdx = 0;
  for (const key of PIPELINE_ORDER) {
    const pos = STEP_NODE_POSITIONS[key];
    if (!pos) continue;

    // Correlations is a control surface, not a server-registered
    // TransformStep — it's rendered as its own node type so it doesn't
    // need the server catalog's implementation picker + numeric params.
    if (key === "correlations") {
      out.push({
        id: key,
        type: "correlations",
        position: pos,
        ...TRANSFORM_NODE_SIZE,
        data: {
          stepNumber: displayedIdx + 1,
          label: STEP_LABELS[key],
          subtitle: PIPELINE_NARRATIVE[key],
          // Live draft / singular flags land on the node in M7 once the
          // editor + singular-alert channel are wired. Keep the fields
          // typed here so the node shell is final.
          draftPending: false,
          singular: false,
        },
        draggable: true,
      });
      displayedIdx++;
      continue;
    }

    const step = steps[key];
    if (!step) continue;

    const trackSpec = NODE_TRACKS[key];

    out.push({
      id: key,
      type: "transform",
      position: pos,
      ...TRANSFORM_NODE_SIZE,
      data: {
        stepNumber: displayedIdx + 1,
        label: STEP_LABELS[key],
        selectedImpl: step.selected,
        subtitle: PIPELINE_NARRATIVE[key],
        saving: savingKey === key,
        laneBoundary: LANE_BOUNDARIES[key],
        inTracks: trackSpec?.in ?? [],
        outTracks: trackSpec?.out ?? [],
      },
      draggable: true,
    });
    displayedIdx++;
  }

  // Output node.
  out.push({
    id: "output",
    type: "output",
    position: OUTPUT_NODE_POSITION,
    ...OUTPUT_NODE_SIZE,
    data: {},
    draggable: true,
  });

  // Pipeline edges — each per-track edge picks up its track colour.
  for (const edge of PIPELINE_EDGES) {
    const track = edge.sourceHandle as TrackKey | undefined;
    const stroke = track ? TRACK_COLORS[track] : PIPELINE_EDGE_STROKE_FALLBACK;
    es.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      type: "default",
      animated: live,
      style: { stroke, strokeWidth: PIPELINE_EDGE_STROKE_WIDTH },
      labelStyle: EDGE_LABEL_STYLE,
      labelBgStyle: EDGE_LABEL_BG_STYLE,
      labelBgPadding: EDGE_LABEL_BG_PADDING,
      labelBgBorderRadius: EDGE_LABEL_BG_RADIUS,
    });
  }

  return { nodes: out, edges: es };
}
