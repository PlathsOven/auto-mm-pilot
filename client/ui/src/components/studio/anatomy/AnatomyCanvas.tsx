import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useTransforms } from "../../../providers/TransformsProvider";
import { useMode } from "../../../providers/ModeProvider";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { useRegisteredStreams } from "../../../hooks/useRegisteredStreams";
import { updateTransforms } from "../../../services/transformApi";
import type { TransformStep } from "../../../types";

import { StreamNode } from "./nodes/StreamNode";
import { TransformNode } from "./nodes/TransformNode";
import { OutputNode } from "./nodes/OutputNode";
import { NodeDetailPanel, type AnatomySelection } from "./NodeDetailPanel";
import { StreamSidebar, type StreamSidebarMode } from "./StreamSidebar";
import { PipelineConfigPopover } from "./PipelineConfigPopover";
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
 *   node that feeds `unit_conversion`. Clicking a stream node opens the
 *   left-side `StreamSidebar` with that stream's `StreamCanvas` editor.
 * - **Transform nodes** are positioned in a left-to-right DAG with the
 *   fair-value / variance branch visible: `temporal_fair_value` has edges to
 *   both `variance` and `aggregation` (fair); `variance` rejoins at
 *   `aggregation`. Clicking a transform node opens the right-side
 *   `NodeDetailPanel` with the implementation picker + parameter editor.
 * - **The "Desired Positions" output node** links through to Floor.
 * - **Default view**: just the canvas — no side panels. The detail panel and
 *   streams sidebar are opt-in based on user interaction.
 * - **Live flow**: when the WS payload carries positions, all edges gain
 *   React Flow's animated dashes plus a CSS stroke-opacity pulse (via the
 *   `anatomy-live` root class in index.css).
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
  const { payload } = useWebSocket();
  const reactFlowInstance = useReactFlow();

  const [localSteps, setLocalSteps] = useState<Record<string, TransformStep> | null>(steps);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<AnatomySelection>({ kind: "none" });
  const [configOpen, setConfigOpen] = useState(false);

  // Sync provider → local state
  useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  // Sidebar mode is driven by URL query so it's shareable and survives nav:
  //   #studio/anatomy                       → sidebar closed
  //   #studio/anatomy?streams=list          → sidebar in list mode
  //   #studio/anatomy?stream=<name>         → sidebar in canvas mode
  const sidebarMode: StreamSidebarMode = useMemo(() => {
    if (query.stream) {
      return {
        kind: "canvas",
        streamName: query.stream,
        templateId: query.template ?? null,
      };
    }
    if (query.streams === "list") return { kind: "list" };
    return { kind: "closed" };
  }, [query.stream, query.template, query.streams]);

  const openSidebarList = useCallback(
    () => setMode("studio", "anatomy?streams=list"),
    [setMode],
  );
  const openSidebarCanvas = useCallback(
    (name: string | null, templateId: string | null) => {
      const params = new URLSearchParams();
      params.set("stream", name ?? "new");
      if (templateId) params.set("template", templateId);
      setMode("studio", `anatomy?${params.toString()}`);
    },
    [setMode],
  );
  const closeSidebar = useCallback(
    () => setMode("studio", "anatomy"),
    [setMode],
  );

  // After the sidebar opens or closes, the canvas column resizes via flexbox
  // — refit the ReactFlow viewport so nodes don't get clipped or stranded
  // off-screen. Watch `sidebarMode.kind` (not the object) to avoid extra
  // recomputes from upstream identity churn.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      reactFlowInstance.fitView({ duration: 200, padding: 0.2 });
    });
    return () => cancelAnimationFrame(id);
  }, [sidebarMode.kind, reactFlowInstance]);

  // Is the system "live"? Use the WS payload as the signal — when positions
  // are flowing, the DAG edges animate.
  const live = (payload?.positions.length ?? 0) > 0;

  // Which stream nodes should the DAG highlight?
  //   - sidebar in "list" mode → every stream
  //   - sidebar in "canvas" mode for a specific stream → just that one
  //   - sidebar closed → none
  const highlightedStreamNames = useMemo(() => {
    if (sidebarMode.kind === "list") {
      return new Set(streams.map((s) => s.stream_name));
    }
    if (sidebarMode.kind === "canvas" && sidebarMode.streamName) {
      return new Set([sidebarMode.streamName]);
    }
    return new Set<string>();
  }, [sidebarMode, streams]);

  // ---------------------------------------------------------------------
  // Transform state machine (lifted from the old PipelineComposer)
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
        style: { stroke: "rgba(129,140,248,0.5)", strokeWidth: 1.5 },
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
        animated: live,
        style: { stroke: "rgba(129,140,248,0.6)", strokeWidth: 1.5 },
        labelStyle: { fill: "#a1a1aa", fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: "#18181b", fillOpacity: 0.9 },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 4,
      });
    }

    return { nodes: out, edges: es };
  }, [localSteps, streams, savingKey, live, highlightedStreamNames]);

  // ---------------------------------------------------------------------
  // Node click handling
  // ---------------------------------------------------------------------
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "stream") {
        openSidebarList();
        setSelection({ kind: "none" });
      } else if (node.type === "transform") {
        setSelection({ kind: "transform", stepKey: node.id as StepKey });
      } else if (node.type === "output") {
        setMode("floor");
      }
    },
    [setMode, openSidebarList],
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

  const showDetailPanel = selection.kind !== "none";

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {sidebarMode.kind !== "closed" && (
        <StreamSidebar
          mode={sidebarMode}
          onOpenList={openSidebarList}
          onOpenCanvas={openSidebarCanvas}
          onClose={closeSidebar}
        />
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-mm-border/40 bg-mm-surface/40 px-4 py-2">
          <div>
            <h2 className="zone-header">Anatomy</h2>
            <p className="mt-0.5 text-[10px] text-mm-text-dim">
              Live pipeline architecture. Click a node to inspect or edit it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfigOpen((v) => !v)}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                configOpen
                  ? "border-mm-accent/60 bg-mm-accent/15 text-mm-accent"
                  : "border-mm-border/40 text-mm-text-dim hover:bg-mm-border/30 hover:text-mm-text"
              }`}
              title="Pipeline configuration (bankroll, market pricing)"
            >
              ⚙ Config
            </button>
            <button
              type="button"
              onClick={() =>
                sidebarMode.kind === "closed" ? openSidebarList() : closeSidebar()
              }
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                sidebarMode.kind !== "closed"
                  ? "border-mm-accent/60 bg-mm-accent/15 text-mm-accent"
                  : "border-mm-border/40 text-mm-text-dim hover:bg-mm-border/30 hover:text-mm-text"
              }`}
            >
              {sidebarMode.kind === "closed" ? "Streams list" : "Hide streams"}
            </button>
          </div>
        </header>

        <PipelineConfigPopover open={configOpen} onClose={() => setConfigOpen(false)} />

        {saveError && (
          <p className="mx-4 mt-2 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
            {saveError}
          </p>
        )}

        <div className={`relative min-h-0 flex-1 bg-mm-bg-deep/40 ${live ? "anatomy-live" : ""}`}>
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
            <Controls position="bottom-right" />
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeColor="#818cf8"
              maskColor="rgba(9,9,11,0.7)"
            />
          </ReactFlow>
        </div>
      </div>

      {showDetailPanel && (
        <NodeDetailPanel
          selection={selection}
          steps={localSteps}
          savingKey={savingKey}
          onSelectTransform={onSelectTransform}
          onParamChange={onParamChange}
          onClose={() => setSelection({ kind: "none" })}
        />
      )}
    </div>
  );
}
