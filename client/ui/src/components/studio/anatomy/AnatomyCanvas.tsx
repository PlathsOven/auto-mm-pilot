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
import { ANATOMY_STARTUP_GRACE_MS } from "../../../constants";

import { StreamNode } from "./nodes/StreamNode";
import { TransformNode } from "./nodes/TransformNode";
import { OutputNode } from "./nodes/OutputNode";
import { LaneBandNode } from "./nodes/LaneBandNode";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { PIPELINE_ORDER, type StepKey } from "./anatomyGraph";
import { buildAnatomyGraph } from "./buildAnatomyGraph";
import { useAnatomySelection } from "./useAnatomySelection";
import { useTransformEditors } from "./useTransformEditors";

const NODE_TYPES: NodeTypes = {
  stream: StreamNode,
  transform: TransformNode,
  output: OutputNode,
  laneBand: LaneBandNode,
};

/**
 * Studio → Anatomy.
 *
 * Horizontal pipeline system diagram rendered with React Flow.
 *
 * - **Stream nodes** stack vertically on the left, each draggable, each
 *   feeding `unit_conversion`. Click → opens the unified right-side
 *   `<NodeDetailPanel/>` with that stream's `<StreamCanvas/>` editor.
 * - **Transform nodes** sit in a left-to-right DAG with the fair-value /
 *   variance branch visible. Click → same right panel, with implementation
 *   picker + parameter editor.
 * - **The header "Streams list" button** opens the same right panel in
 *   list mode (browse/sort all streams). One panel, three contents — click
 *   any node again to close.
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
  const { steps, error, refresh } = useTransforms();
  const { streams } = useRegisteredStreams();
  const { setMode, navigate } = useMode();
  const { payload } = useWebSocket();
  const positionCount = payload?.positions.length ?? 0;
  const reactFlowInstance = useReactFlow();

  const {
    selection,
    streamPrefill,
    closePanel,
    openStream,
    openTransform,
    toggleListPanel,
    showList,
  } = useAnatomySelection();

  const { savingKey, saveError, onSelectTransform, onParamChange } = useTransformEditors();

  /** Post-Activate feedback: jump to the Streams list (so the user sees
   *  their new row) and pan the DAG to the new stream node so the canvas
   *  visually signals "this is the thing you just created." Waiting until
   *  the full lifecycle completes — before this point a navigation would
   *  remount the form mid-activation and wipe the draft.
   *
   *  `navigate` is load-bearing: if we only updated local `selection` and
   *  left the URL as `?stream=new&prefill…`, a subsequent "Register this
   *  stream" click from another notification would write the same
   *  `stream=new` URL, `query.stream` wouldn't change, and the sync
   *  useEffect wouldn't fire — the panel would stay stuck on the list.
   *  Navigating here keeps URL and state consistent so the next
   *  notification click produces a real `query.stream` transition. */
  const handleStreamActivated = useCallback(
    (name: string) => {
      navigate("anatomy?streams=list");
      // Defer fitView a tick so the node is guaranteed to be in the DAG
      // (buildAnatomyGraph derives stream nodes from `streams`, which is
      // updated by StreamCanvas via `addStream()` on create).
      // Node ids are prefixed `stream-` in buildAnatomyGraph — passing the
      // bare name silently fits to nothing and the viewport stays wherever
      // it was, which is exactly the "centred on the wrong place" bug.
      setTimeout(() => {
        try {
          reactFlowInstance.fitView({
            nodes: [{ id: `stream-${name}` }],
            padding: 0.5,
            minZoom: 1,
            maxZoom: 1.6,
            duration: 500,
          });
        } catch {
          // Node may not be in the graph yet on very first registration —
          // fall back silently; the Streams list still surfaces it.
        }
      }, 0);
    },
    [navigate, reactFlowInstance],
  );

  // Is the system "live"? Use the WS payload as the signal — when positions
  // are flowing, the DAG edges animate.
  const live = positionCount > 0;

  // Which stream nodes should the DAG highlight?
  //   - right panel inspecting a stream → just that one
  //   - right panel showing the stream list → every stream
  //   - otherwise → none
  const highlightedStreamNames = useMemo(() => {
    if (selection.kind === "stream") return new Set([selection.streamName]);
    if (selection.kind === "list") return new Set(streams.map((s) => s.stream_name));
    return new Set<string>();
  }, [selection, streams]);

  // ---------------------------------------------------------------------
  // Build React Flow nodes + edges
  // ---------------------------------------------------------------------
  const { nodes, edges } = useMemo(() => {
    if (!steps) return { nodes: [], edges: [] };
    return buildAnatomyGraph(steps, streams, savingKey, live, highlightedStreamNames);
  }, [steps, streams, savingKey, live, highlightedStreamNames]);

  // One-shot initial fit to the streams cluster. Driven by an effect
  // instead of the `<ReactFlow fitView fitViewOptions={...}/>` props
  // because those re-apply every time the nodes array identity changes
  // (e.g. on every click, since `highlightedStreamNames` is part of the
  // rebuild key) — which used to cancel per-click fit animations and
  // snap the viewport back onto the streams.
  const hasInitiallyFit = useRef(false);
  useEffect(() => {
    if (hasInitiallyFit.current) return;
    if (nodes.length === 0) return;
    const streamIds = nodes
      .filter((n) => n.type === "stream")
      .map((n) => ({ id: n.id }));
    const fitNodes = streamIds.length > 0 ? streamIds : undefined;
    const t = setTimeout(() => {
      reactFlowInstance.fitView({
        nodes: fitNodes,
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

      // Toggle: clicking the currently-focused transform closes the panel.
      // Stream clicks always go to the list (see below) — they don't
      // self-toggle, since the list is shared across every stream node.
      if (
        selection.kind === "transform"
        && node.type === "transform"
        && selection.stepKey === node.id
      ) {
        closePanel();
        return;
      }

      // Pan/zoom to the clicked node so it ends up centred regardless of
      // which slice of the DAG was previously visible.
      reactFlowInstance.fitView({ nodes: [{ id: node.id }], duration: 250, padding: 0.5, minZoom: 1, maxZoom: 1.6 });

      if (node.type === "stream") {
        // Stream nodes open the streams list, not the per-stream editor.
        // The user picks a row in the list to open the editor for that one.
        // (Earlier this passed `node.id` to openStream, but node.id is the
        // ReactFlow id `stream-{name}` — that prefix then surfaced as the
        // initial Stream Name in the editor and failed snake_case validation.)
        showList();
      } else if (node.type === "transform") {
        openTransform(node.id as StepKey);
      } else if (node.type === "output") {
        setMode("workbench");
      }
    },
    [reactFlowInstance, setMode, selection, closePanel, openTransform, showList],
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

  const allPresent = PIPELINE_ORDER.every((k) => steps[k]);
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleListPanel}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                selection.kind === "list"
                  ? "border-mm-accent/60 bg-mm-accent/10 text-mm-accent"
                  : "border-black/[0.06] text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
              }`}
            >
              {selection.kind === "list" ? "Hide streams" : "Streams list"}
            </button>
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
          onOpenStream={openStream}
          onShowList={showList}
          onStreamActivated={handleStreamActivated}
          streamPrefill={streamPrefill}
        />
      )}
    </div>
  );
}
