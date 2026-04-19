import { useCallback, useEffect, useMemo, useState } from "react";
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
import { updateTransforms } from "../../../services/transformApi";
import type { TransformStep } from "../../../types";

import { StreamNode } from "./nodes/StreamNode";
import { TransformNode } from "./nodes/TransformNode";
import { OutputNode } from "./nodes/OutputNode";
import { NodeDetailPanel, type AnatomySelection } from "./NodeDetailPanel";
import { PipelineConfigPopover } from "./PipelineConfigPopover";
import { PIPELINE_ORDER, type StepKey } from "./anatomyGraph";
import { buildAnatomyGraph } from "./buildAnatomyGraph";
import type { StreamDraftPrefill } from "../canvasState";

const NODE_TYPES: NodeTypes = {
  stream: StreamNode,
  transform: TransformNode,
  output: OutputNode,
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
  const { steps, setSteps, loading, error, refresh } = useTransforms();
  const { streams } = useRegisteredStreams();
  const { query, setMode, navigate } = useMode();
  const { payload } = useWebSocket();
  const positionCount = payload?.positions.length ?? 0;
  const reactFlowInstance = useReactFlow();

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Initial selection comes from the URL query so deep links still work:
  //   #anatomy?streams=list   → right panel open in "list" mode
  //   #anatomy?stream=<name>  → right panel open on that stream
  // After mount the right panel is driven entirely by node clicks + the
  // header "Streams list" toggle (NOT routed through the URL — keeps the
  // hash clean during normal use).
  const [selection, setSelection] = useState<AnatomySelection>(() => {
    if (query.stream) return { kind: "stream", streamName: query.stream };
    if (query.streams === "list") return { kind: "list" };
    return { kind: "none" };
  });
  const [configOpen, setConfigOpen] = useState(false);

  // When the URL changes while Anatomy is already mounted (e.g. the
  // Notifications "Register this stream" CTA navigates to
  // `#anatomy?stream=new&prefill…`), sync the panel to the new target.
  // The `useState` initializer above only runs once on mount, so without
  // this effect subsequent deep-link navigations are silent.
  //
  // We only react to the positive cases — a URL that explicitly names a
  // stream or requests the list mode. Clearing the hash should not stomp
  // a panel the user opened via node clicks.
  useEffect(() => {
    if (query.stream) {
      setSelection({ kind: "stream", streamName: query.stream });
    } else if (query.streams === "list") {
      setSelection({ kind: "list" });
    }
  }, [query.stream, query.streams]);

  // Parse prefill query params (from the Notifications center deep-link).
  // Only applied when the panel is opened on a "new" stream — editing an
  // existing stream must not have its draft stomped.
  const streamPrefill = useMemo<StreamDraftPrefill | null>(() => {
    if (query.stream !== "new") return null;
    let exampleRow: Record<string, unknown> | undefined;
    if (query.prefillRow) {
      try {
        const parsed = JSON.parse(query.prefillRow);
        if (parsed && typeof parsed === "object") {
          exampleRow = parsed as Record<string, unknown>;
        }
      } catch {
        // Ignore — malformed prefillRow shouldn't block the form from opening.
      }
    }
    const keyCols = query.prefillKeyCols
      ? query.prefillKeyCols.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    if (!query.prefillName && !keyCols && !exampleRow) return null;
    return {
      streamName: query.prefillName || undefined,
      keyCols,
      exampleRow,
    };
  }, [query.stream, query.prefillName, query.prefillKeyCols, query.prefillRow]);

  const closePanel = useCallback(() => setSelection({ kind: "none" }), []);
  const openStream = useCallback(
    (name: string) => setSelection({ kind: "stream", streamName: name }),
    [],
  );
  const toggleListPanel = useCallback(
    () => setSelection((s) => (s.kind === "list" ? { kind: "none" } : { kind: "list" })),
    [],
  );

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
      setTimeout(() => {
        try {
          reactFlowInstance.fitView({
            nodes: [{ id: name }],
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

  // The viewport-recenter effect lives below the `nodes` useMemo so it
  // can reference it without hitting a TDZ in the deps array.

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
        setSteps(res.steps);
        refresh();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingKey(null);
      }
    },
    [refresh, setSteps],
  );

  const onSelectTransform = useCallback(
    (stepKey: string, name: string) => {
      setSteps((prev) => {
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
    [persist, setSteps],
  );

  const onParamChange = useCallback(
    (stepKey: string, paramName: string, value: unknown) => {
      setSteps((prev) => {
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
    [persist, setSteps],
  );

  // ---------------------------------------------------------------------
  // Build React Flow nodes + edges
  // ---------------------------------------------------------------------
  const { nodes, edges } = useMemo(() => {
    if (!steps) return { nodes: [], edges: [] };
    return buildAnatomyGraph(steps, streams, savingKey, live, highlightedStreamNames);
  }, [steps, streams, savingKey, live, highlightedStreamNames]);

  // Pre-compute stream node IDs so ReactFlow's initial `fitView` lands on
  // the streams cluster, not the whole DAG. This is what eliminates the
  // visible two-step zoom — the same fit our useEffect would do, but
  // applied at first paint.
  const streamNodeIds = useMemo(
    () => nodes.filter((n) => n.type === "stream").map((n) => ({ id: n.id })),
    [nodes],
  );

  // No automatic refit — the initial view comes from ReactFlow's own
  // `fitView` prop with `streamNodeIds`, and subsequent fits are owned by
  // explicit user actions (node clicks). This is what eliminates the
  // historical two-step zoom on every interaction. Drag + pan + zoom
  // happen freely without us interfering.

  // ---------------------------------------------------------------------
  // Node click handling
  // ---------------------------------------------------------------------
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Toggle: clicking the currently-focused node closes the panel.
      const isAlreadyFocused =
        (selection.kind === "transform" && node.type === "transform" && selection.stepKey === node.id)
        || (selection.kind === "stream" && node.type === "stream" && selection.streamName === node.id);

      if (isAlreadyFocused) {
        setSelection({ kind: "none" });
        return;
      }

      // Pan/zoom to the clicked node so it ends up centred regardless of
      // which slice of the DAG was previously visible. The sidebar-mode
      // useEffect no longer fires on node clicks, so this is the only fit
      // that runs (single zoom step).
      reactFlowInstance.fitView({ nodes: [{ id: node.id }], duration: 250, padding: 0.5, minZoom: 1, maxZoom: 1.6 });

      if (node.type === "stream") {
        setSelection({ kind: "stream", streamName: node.id });
      } else if (node.type === "transform") {
        setSelection({ kind: "transform", stepKey: node.id as StepKey });
      } else if (node.type === "output") {
        setMode("workbench");
      }
    },
    [reactFlowInstance, setMode, selection],
  );

  const onPaneClick = useCallback(() => {
    setSelection({ kind: "none" });
  }, []);

  // ---------------------------------------------------------------------
  // Early returns
  // ---------------------------------------------------------------------
  if (loading && !steps) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-mm-text-dim">Loading transforms…</p>
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
              onClick={() => setConfigOpen((v) => !v)}
              className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                configOpen
                  ? "border-mm-accent/60 bg-mm-accent/10 text-mm-accent"
                  : "border-black/[0.06] text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
              }`}
              title="Pipeline configuration (bankroll)"
            >
              ⚙ Config
            </button>
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

        <PipelineConfigPopover open={configOpen} onClose={() => setConfigOpen(false)} />

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
            fitView
            fitViewOptions={{
              nodes: streamNodeIds.length > 0 ? streamNodeIds : undefined,
              padding: 0.4,
              minZoom: 0.9,
              maxZoom: 1.4,
            }}
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
              maskColor="rgba(244,244,247,0.7)"
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
          onStreamActivated={handleStreamActivated}
          streamPrefill={streamPrefill}
        />
      )}
    </div>
  );
}
