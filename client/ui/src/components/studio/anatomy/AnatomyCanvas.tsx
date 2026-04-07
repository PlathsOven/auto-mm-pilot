import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useTransforms } from "../../../providers/TransformsProvider";
import { useMode } from "../../../providers/ModeProvider";
import { useRegisteredStreams } from "../../../hooks/useRegisteredStreams";
import { updateTransforms } from "../../../services/transformApi";
import type { TransformStep } from "../../../types";

import { StreamNode } from "./nodes/StreamNode";
import { TransformNode } from "./nodes/TransformNode";
import { OutputNode } from "./nodes/OutputNode";
import { NodeDetailPanel, type AnatomySelection } from "./NodeDetailPanel";
import { StreamSidebar } from "./StreamSidebar";
import { AnatomyStreamDrawer } from "./AnatomyStreamDrawer";
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

const NODE_TYPES: NodeTypes = {
  stream: StreamNode,
  transform: TransformNode,
  output: OutputNode,
};

const STEP_LABELS: Record<StepKey, string> = {
  unit_conversion: "Unit Conversion",
  decay_profile: "Decay Profile",
  temporal_fair_value: "Temporal Fair Value",
  variance: "Variance",
  aggregation: "Aggregation",
  position_sizing: "Position Sizing",
  smoothing: "Smoothing",
};

/**
 * Studio → Anatomy.
 *
 * Horizontal pipeline system diagram rendered with React Flow.
 *
 * - **Streams** are stacked vertically on the left; each one is a draggable
 *   node that feeds `unit_conversion`.
 * - **Transform nodes** are positioned in a left-to-right DAG with the
 *   fair-value / variance branch visible: `temporal_fair_value` has edges to
 *   both `variance` and `aggregation` (fair); `variance` rejoins at
 *   `aggregation`.
 * - **The "Desired Positions" output node** links through to Floor.
 * - **NodeDetailPanel** (right, always visible) shows the implementation
 *   picker + parameter editor for the selected transform node, or the
 *   pipeline-level Bankroll/MarketPricing/LiveEquationStrip when nothing is
 *   selected.
 * - **StreamSidebar** (left, collapsible) hosts the sortable StreamTable for
 *   bulk comparison and the + New stream split button.
 *
 * Owns the optimistic `localSteps` state machine + PATCH /api/transforms
 * round-trip lifted from the deleted PipelineComposer.
 */
export function AnatomyCanvas() {
  return (
    <ReactFlowProvider>
      <AnatomyCanvasInner />
    </ReactFlowProvider>
  );
}

function AnatomyCanvasInner() {
  const { steps, loading, error, refresh } = useTransforms();
  const { streams } = useRegisteredStreams();
  const { query, setMode } = useMode();

  const [localSteps, setLocalSteps] = useState<Record<string, TransformStep> | null>(steps);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<AnatomySelection>({ kind: "none" });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Sync provider → local state
  useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  // Drawer opens when the URL query has `?stream=<name>`
  const drawerStreamName = query.stream ?? null;
  const drawerTemplateId = query.template ?? null;
  const closeDrawer = useCallback(() => setMode("studio", "anatomy"), [setMode]);
  const openDrawer = useCallback(
    (name: string) => setMode("studio", `anatomy?stream=${encodeURIComponent(name)}`),
    [setMode],
  );

  // ---------------------------------------------------------------------
  // Transform state machine (lifted verbatim from the old PipelineComposer)
  // ---------------------------------------------------------------------
  const persist = useCallback(
    async (stepKey: string, nextStep: TransformStep) => {
      setSavingKey(stepKey);
      setSaveError(null);
      try {
        const config: Record<string, unknown> = {
          [stepKey]: nextStep.selected,
          [`${stepKey}_params`]: nextStep.params,
        };
        const res = await updateTransforms(config);
        setLocalSteps(res.steps);
        refresh();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingKey(null);
      }
    },
    [refresh],
  );

  const onSelectTransform = useCallback(
    (stepKey: string, name: string) => {
      setLocalSteps((prev) => {
        if (!prev) return prev;
        const step = prev[stepKey];
        if (!step) return prev;
        const info = step.transforms.find((t) => t.name === name);
        const defaults: Record<string, unknown> = {};
        if (info) for (const p of info.params) defaults[p.name] = p.default;
        const nextStep: TransformStep = { ...step, selected: name, params: defaults };
        persist(stepKey, nextStep);
        return { ...prev, [stepKey]: nextStep };
      });
    },
    [persist],
  );

  const onParamChange = useCallback(
    (stepKey: string, paramName: string, value: unknown) => {
      setLocalSteps((prev) => {
        if (!prev) return prev;
        const step = prev[stepKey];
        if (!step) return prev;
        const nextStep: TransformStep = {
          ...step,
          params: { ...step.params, [paramName]: value },
        };
        persist(stepKey, nextStep);
        return { ...prev, [stepKey]: nextStep };
      });
    },
    [persist],
  );

  // ---------------------------------------------------------------------
  // Build React Flow nodes + edges
  // ---------------------------------------------------------------------
  const { nodes, edges } = useMemo(() => {
    if (!localSteps) return { nodes: [], edges: [] };

    const out: Node[] = [];
    const es: Edge[] = [];

    // Stream nodes stacked on the left
    const totalStreams = streams.length;
    const verticalCenter = 280 - (totalStreams * STREAM_ROW_HEIGHT) / 2;
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
      });
      es.push({
        id: `e-stream-${s.stream_name}-uc`,
        source: `stream-${s.stream_name}`,
        target: "unit_conversion",
        type: "default",
        style: { stroke: "rgba(129,140,248,0.35)" },
      });
    });

    // Transform step nodes
    for (let i = 0; i < PIPELINE_ORDER.length; i++) {
      const key = PIPELINE_ORDER[i];
      const step = localSteps[key];
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
        style: { stroke: "rgba(129,140,248,0.5)", strokeWidth: 1.5 },
        labelStyle: { fill: "#a5a5ae", fontSize: 10 },
        labelBgStyle: { fill: "#18181b" },
        labelBgPadding: [4, 2],
      });
    }

    return { nodes: out, edges: es };
  }, [localSteps, streams, savingKey]);

  // ---------------------------------------------------------------------
  // Node click handling
  // ---------------------------------------------------------------------
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "stream") {
        const streamName = (node.data as { streamName?: string }).streamName;
        if (streamName) {
          setSelection({ kind: "stream", streamName });
        }
      } else if (node.type === "transform") {
        setSelection({ kind: "transform", stepKey: node.id as StepKey });
      } else if (node.type === "output") {
        setMode("floor");
      }
    },
    [setMode],
  );

  const onPaneClick = useCallback(() => {
    setSelection({ kind: "none" });
  }, []);

  // ---------------------------------------------------------------------
  // Early returns
  // ---------------------------------------------------------------------
  if (loading && !localSteps) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-mm-text-dim">Loading transforms…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-mm-error">{error}</p>
      </div>
    );
  }

  if (!localSteps) return null;

  const allPresent = PIPELINE_ORDER.every((k) => localSteps[k]);
  if (!allPresent) return null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-mm-border/40 bg-mm-surface/40 px-4 py-2">
          <div>
            <h2 className="zone-header">Anatomy</h2>
            <p className="mt-0.5 text-[10px] text-mm-text-dim">
              Live pipeline architecture. Click a node to inspect or edit it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-md border border-mm-border/40 px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
          >
            {sidebarOpen ? "Hide streams list" : "Streams list"}
          </button>
        </header>

        {saveError && (
          <p className="mx-4 mt-2 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
            {saveError}
          </p>
        )}

        <div className="relative min-h-0 flex-1 bg-mm-bg-deep/40">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#27272a" gap={24} />
            <Controls
              position="bottom-right"
              className="!border-mm-border/60 !bg-mm-surface/80 !text-mm-text"
            />
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeColor="#818cf8"
              maskColor="rgba(9,9,11,0.7)"
              className="!border !border-mm-border/60 !bg-mm-surface/80"
            />
          </ReactFlow>

          <StreamSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        </div>
      </div>

      <NodeDetailPanel
        selection={selection}
        steps={localSteps}
        savingKey={savingKey}
        onSelectTransform={onSelectTransform}
        onParamChange={onParamChange}
        onOpenStreamDrawer={openDrawer}
      />

      <AnatomyStreamDrawer
        streamName={drawerStreamName}
        templateId={drawerTemplateId}
        onClose={closeDrawer}
      />
    </div>
  );
}
