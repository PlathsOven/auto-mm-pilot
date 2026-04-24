import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useTransforms } from "../../../providers/TransformsProvider";
import { useMode } from "../../../providers/ModeProvider";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { useRegisteredStreams } from "../../../hooks/useRegisteredStreams";
import { useConnectorCatalog } from "../../../hooks/useConnectorCatalog";
import { ANATOMY_STARTUP_GRACE_MS } from "../../../constants";

import { StreamNode, type StreamNodeData } from "./nodes/StreamNode";
import { AddStreamNode } from "./nodes/AddStreamNode";
import { ConnectorNode } from "./nodes/ConnectorNode";
import { TransformNode } from "./nodes/TransformNode";
import { CorrelationsNode } from "./nodes/CorrelationsNode";
import { OutputNode } from "./nodes/OutputNode";
import { LaneBandNode } from "./nodes/LaneBandNode";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { PIPELINE_ORDER, type StepKey } from "./anatomyGraph";
import { buildAnatomyGraph } from "./buildAnatomyGraph";
import { useAnatomySelection } from "./useAnatomySelection";
import { useTransformEditors } from "./useTransformEditors";

const NODE_TYPES: NodeTypes = {
  stream: StreamNode,
  addStream: AddStreamNode,
  connector: ConnectorNode,
  transform: TransformNode,
  correlations: CorrelationsNode,
  output: OutputNode,
  laneBand: LaneBandNode,
};

/**
 * Studio → Anatomy.
 *
 * Horizontal pipeline system diagram rendered with React Flow.
 *
 * - **Stream nodes** stack vertically on the left, each draggable, each
 *   feeding `unit_conversion`. Click → opens the right-side
 *   `<NodeDetailPanel/>` with that stream's `<StreamCanvas/>` editor.
 *   Hover → popover listing mapping / confidence / block-shape details
 *   plus an active toggle and delete.
 * - **"+ New stream" tile** sits directly below the last stream. Click →
 *   opens a blank StreamCanvas in the same right panel.
 * - **Transform nodes** sit in a left-to-right DAG with the fair-value /
 *   variance branch visible. Click → same right panel, with implementation
 *   picker + parameter editor.
 * - **The "Desired Positions" output node** links through to Floor.
 * - **Default view**: just the canvas — no side panel. The detail panel
 *   is opt-in based on user interaction.
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
  const { steps, error, refresh } = useTransforms();
  const { streams } = useRegisteredStreams();
  const { connectors } = useConnectorCatalog();
  const { setMode } = useMode();
  const { payload } = useWebSocket();
  const positionCount = payload?.positions.length ?? 0;
  const reactFlowInstance = useReactFlow();

  const {
    selection,
    streamPrefill,
    closePanel,
    openStream,
    openTransform,
    openCorrelations,
  } = useAnatomySelection();

  const { savingKey, saveError, onSelectTransform, onParamChange } = useTransformEditors();

  // Single-node fit helper — keeps the padding / zoom-range pair in sync
  // across the two sites that use it (click-to-focus + post-activation
  // auto-fit). Silently no-ops if the node isn't in the graph yet, which
  // happens on the very first post-registration fit before the DAG
  // rebuild has landed the new stream node.
  const fitNodeIntoView = useCallback(
    (nodeId: string, duration = 250) => {
      try {
        reactFlowInstance.fitView({
          nodes: [{ id: nodeId }],
          padding: 0.5,
          minZoom: 1,
          maxZoom: 1.6,
          duration,
        });
      } catch {
        // node not yet in graph — fallback silently.
      }
    },
    [reactFlowInstance],
  );

  const handleStreamActivated = useCallback(
    (name: string) => {
      // Close the detail panel so the "it worked" signal is the DAG pan +
      // the newly-rendered stream node, not a form still occupying the rail.
      closePanel();
      // Defer fitView a tick so the node is guaranteed to be in the DAG
      // (buildAnatomyGraph derives stream nodes from `streams`, which is
      // updated by StreamCanvas via `addStream()` on create). Node ids are
      // prefixed `stream-` in buildAnatomyGraph — passing the bare name
      // silently fits to nothing and the viewport stays stuck.
      setTimeout(() => fitNodeIntoView(`stream-${name}`, 500), 0);
    },
    [closePanel, fitNodeIntoView],
  );

  // Is the system "live"? Use the WS payload as the signal — when positions
  // are flowing, the DAG edges animate.
  const live = positionCount > 0;

  // Which stream nodes should the DAG highlight?
  //   - right panel inspecting a stream → just that one
  //   - otherwise → none
  const highlightedStreamNames = useMemo(() => {
    if (selection.kind === "stream") return new Set([selection.streamName]);
    return new Set<string>();
  }, [selection]);

  // ---------------------------------------------------------------------
  // Build React Flow nodes + edges
  // ---------------------------------------------------------------------
  const { nodes, edges } = useMemo(() => {
    if (!steps) return { nodes: [], edges: [] };
    return buildAnatomyGraph(steps, streams, savingKey, live, highlightedStreamNames, connectors);
  }, [steps, streams, savingKey, live, highlightedStreamNames, connectors]);

  // One-shot initial fit to the streams cluster. Driven by an effect
  // instead of the `<ReactFlow fitView fitViewOptions={...}/>` props
  // because those re-apply every time the nodes array identity changes
  // (e.g. on every click, since `highlightedStreamNames` is part of the
  // rebuild key) — which used to cancel per-click fit animations and
  // snap the viewport back onto the streams.
  //
  // Gate the fit on stream nodes being *present* — not just any nodes.
  // `useTransforms` and `useRegisteredStreams` resolve independently; if
  // `steps` wins the race, `nodes` is non-empty with only transform +
  // output nodes and the old fallback (`fitNodes = undefined` → fit-all)
  // locked in a full-DAG viewport before streams ever arrived.
  const hasInitiallyFit = useRef(false);
  useEffect(() => {
    if (hasInitiallyFit.current) return;
    const streamIds = nodes
      .filter((n) => n.type === "stream")
      .map((n) => ({ id: n.id }));
    if (streamIds.length === 0) return;
    const t = setTimeout(() => {
      reactFlowInstance.fitView({
        nodes: streamIds,
        padding: 0.4,
        minZoom: 0.9,
        maxZoom: 1.4,
      });
      hasInitiallyFit.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, [nodes, reactFlowInstance]);

  // ---------------------------------------------------------------------
  // Node click handling
  // ---------------------------------------------------------------------
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Lane bands are decorative and never interactive.
      if (node.type === "laneBand") return;

      // Toggle: clicking the currently-focused transform or stream closes
      // the panel.
      if (
        selection.kind === "transform"
        && node.type === "transform"
        && selection.stepKey === node.id
      ) {
        closePanel();
        return;
      }
      if (
        selection.kind === "stream"
        && node.type === "stream"
        && `stream-${selection.streamName}` === node.id
      ) {
        closePanel();
        return;
      }
      if (
        selection.kind === "correlations"
        && node.type === "correlations"
      ) {
        closePanel();
        return;
      }

      // Pan/zoom to the clicked node so it ends up centred regardless of
      // which slice of the DAG was previously visible.
      fitNodeIntoView(node.id);

      if (node.type === "stream") {
        // Open the editor for this specific stream. node.id is prefixed
        // `stream-{name}` — pull the real name from the node data so we
        // pass the bare name to openStream (a `stream-` prefix would
        // otherwise surface as the initial Stream Name in the editor and
        // fail snake_case validation).
        const streamName = (node.data as StreamNodeData).streamName;
        openStream(streamName);
      } else if (node.type === "addStream") {
        // StreamCanvas's initialDraft() treats "new" as the URL sentinel
        // for "open create mode with an empty identity".
        openStream("new");
      } else if (node.type === "transform") {
        openTransform(node.id as StepKey);
      } else if (node.type === "correlations") {
        openCorrelations();
      } else if (node.type === "output") {
        setMode("workbench");
      }
    },
    [fitNodeIntoView, setMode, selection, closePanel, openTransform, openStream, openCorrelations],
  );

  const onPaneClick = useCallback(() => {
    closePanel();
  }, [closePanel]);

  // ---------------------------------------------------------------------
  // Early returns
  // ---------------------------------------------------------------------
  // Startup grace window: the `/api/transforms` fetch races server boot +
  // first snapshot ingestion. A transient failure flips `loading → false`
  // and `error → "Failed to fetch"` before the next poll tick succeeds.
  // Showing the full error panel during that normal window is alarming and
  // wrong — fall through to the loading screen until the grace window
  // closes without any successful load.
  const [mountedAt] = useState(() => Date.now());
  const [, setNow] = useState(mountedAt);
  const withinGrace = !steps && Date.now() - mountedAt < ANATOMY_STARTUP_GRACE_MS;
  useEffect(() => {
    if (steps || !withinGrace) return;
    const remaining = ANATOMY_STARTUP_GRACE_MS - (Date.now() - mountedAt);
    const t = setTimeout(() => setNow(Date.now()), Math.max(remaining, 0));
    return () => clearTimeout(t);
  }, [steps, withinGrace, mountedAt]);

  if (!steps && withinGrace) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="glass-panel flex flex-col items-center gap-3 px-6 py-5 text-[11px]">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-mm-accent/30 border-t-mm-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Anatomy
          </span>
          <p className="text-mm-text-dim">Connecting to pipeline…</p>
        </div>
      </div>
    );
  }

  if (error) {
    const isNetwork = /failed to fetch|networkerror/i.test(error);
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="glass-panel flex max-w-md flex-col gap-3 p-5 text-[11px]">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-error">
            Anatomy could not load
          </span>
          <p className="text-mm-text">{error}</p>
          {isNetwork && (
            <p className="text-mm-text-dim">
              The pipeline-config endpoint (<code className="font-mono">/api/transforms</code>)
              didn't respond. Check that the server is running and that
              <code className="font-mono"> VITE_API_BASE</code> points at it.
            </p>
          )}
          <button
            type="button"
            onClick={() => { void refresh(); }}
            className="self-start rounded-md border border-mm-accent/40 bg-mm-accent/10 px-3 py-1 text-[11px] font-semibold text-mm-accent transition-colors hover:bg-mm-accent/15"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!steps) return null;

  // "correlations" is a pseudo-step — rendered as its own node type
  // (CorrelationsNode) without a server-side TransformStep entry, so
  // exclude it from the presence gate. Every other pipeline step must
  // be in the server catalog before the canvas renders.
  const allPresent = PIPELINE_ORDER
    .filter((k) => k !== "correlations")
    .every((k) => steps[k]);
  if (!allPresent) return null;

  const showDetailPanel = selection.kind !== "none";

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] bg-white/45 px-4 py-2">
          <div>
            <h2 className="zone-header">Anatomy</h2>
            <p className="mt-0.5 text-[10px] text-mm-text-dim">
              Live pipeline architecture. Click a node to inspect or edit it.
            </p>
          </div>
        </header>

        {saveError && (
          <p className="mx-4 mt-2 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
            {saveError}
          </p>
        )}

        <div className={`relative min-h-0 flex-1 bg-black/[0.03] ${live ? "anatomy-live" : ""}`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(0,0,0,0.06)" gap={24} />
            <Controls position="bottom-right" />
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeColor="#4f5bd5"
              nodeStrokeColor="#4f5bd5"
              nodeStrokeWidth={2}
              nodeBorderRadius={4}
              maskColor="rgba(15,23,42,0.18)"
            />
          </ReactFlow>
        </div>
      </div>

      {showDetailPanel && (
        <NodeDetailPanel
          selection={selection}
          steps={steps}
          savingKey={savingKey}
          onSelectTransform={onSelectTransform}
          onParamChange={onParamChange}
          onClose={closePanel}
          onStreamActivated={handleStreamActivated}
          streamPrefill={streamPrefill}
        />
      )}
    </div>
  );
}
