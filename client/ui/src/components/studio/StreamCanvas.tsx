import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRegisteredStreams } from "../../hooks/useRegisteredStreams";
import { useConnectorCatalog, findConnector } from "../../hooks/useConnectorCatalog";
import { IdentitySection } from "./sections/IdentitySection";
import { DataShapeSection } from "./sections/DataShapeSection";
import { TargetMappingSection } from "./sections/TargetMappingSection";
import { BlockShapeSection } from "./sections/BlockShapeSection";
import { ConfidenceSection } from "./sections/ConfidenceSection";
import { PreviewSection, parseCsvToRows } from "./sections/PreviewSection";
import { StreamCanvasFooter, type ActivationResult } from "./StreamCanvasFooter";
import {
  EMPTY_DRAFT,
  prefilledDraft,
  validateAll,
  isAllValid,
  type StreamDraft,
  type StreamDraftPrefill,
} from "./canvasState";
import { configureStream, createStream, ingestSnapshot } from "../../services/streamApi";
import type { ConnectorSchema, RegisteredStream } from "../../types";

interface Props {
  /** Stream name from the URL (#anatomy?stream={name}) — empty for a new draft. */
  streamName: string | null;
  /** Optional pre-filled draft values — used when deep-linking from the
   *  Notifications center with a captured unregistered push. Only applied
   *  when `streamName === "new"`. */
  prefill?: StreamDraftPrefill | null;
  /** Fired after a successful Activate. Parent (AnatomyCanvas) is expected
   *  to close the form, surface the Streams list, and pan the DAG to the
   *  newly-registered stream node so the user has a clear "it worked"
   *  signal — otherwise the form unmounting looks like an error. */
  onActivated?: (streamName: string) => void;
}

/** URL sentinel that means "open the form in create mode" — not a real name. */
const NEW_STREAM_SENTINEL = "new";

/**
 * The Studio Stream Canvas. Hosts all 6 sections plus the sticky Activate
 * footer.
 *
 * State model: a single `StreamDraft` lives in this component. Each section
 * receives its slice + an updater. Picking a connector in the Identity
 * section cascades through the whole draft — sections 3-6 reset to the
 * connector's recommended defaults and lock; the Data Shape panel switches
 * to a read-only schema; the Preview tab swaps the draft summary for an
 * SDK integration snippet.
 */
export function StreamCanvas({ streamName, prefill, onActivated }: Props) {
  const { streams: registry, refresh: refreshRegistry, addStream } = useRegisteredStreams();
  const { connectors: connectorCatalog } = useConnectorCatalog();
  const [draft, setDraft] = useState<StreamDraft>(() =>
    initialDraft(streamName, prefill ?? null),
  );
  // `streamName === "new"` is a URL sentinel, not a registered stream — the
  // pending name stays null until Activate creates the real one.
  const [pendingStreamName, setPendingStreamName] = useState<string | null>(
    streamName === NEW_STREAM_SENTINEL ? null : streamName,
  );
  const [activating, setActivating] = useState(false);
  const [activationResult, setActivationResult] = useState<ActivationResult | null>(null);

  // Hydrate the full draft from the registry the first time a registered
  // stream resolves. After that, the useState draft is authoritative —
  // re-hydrating on every registry poll would clobber in-flight edits.
  const hydratedStreamName = useRef<string | null>(null);
  useEffect(() => {
    if (!streamName) return;
    const existing = registry.find((s) => s.stream_name === streamName);
    if (!existing) return;
    if (hydratedStreamName.current === existing.stream_name) return;
    hydratedStreamName.current = existing.stream_name;
    setPendingStreamName(existing.stream_name);
    setDraft((prev) => hydrateDraftFromRegistry(prev, existing));
  }, [streamName, registry]);

  const isConnectorFed = draft.connector_name !== null;
  const states = useMemo(() => validateAll(draft), [draft]);
  const allValid = useMemo(() => isAllValid(states), [states]);

  const updateSlice = useCallback(<K extends keyof StreamDraft>(key: K, value: StreamDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleConnectorChange = useCallback(
    (next: string | null) => {
      setDraft((prev) => applyConnectorSelection(prev, next, connectorCatalog));
    },
    [connectorCatalog],
  );

  const handleStreamCreated = useCallback(
    (created: RegisteredStream) => {
      setPendingStreamName(created.stream_name);
      addStream(created);
    },
    [addStream],
  );

  /**
   * Activate lifecycle:
   *   1. Create the stream on the fly if we're in create-mode (no
   *      pendingStreamName), updating the local registry cache.
   *   2. POST /api/streams/{name}/configure with the resolved parameters
   *      — connector_name + connector_params if connector-fed, or
   *      target_mapping + block_shape if user-fed.
   *   3. For user-fed streams with a non-empty sample CSV, ingest those
   *      rows via POST /api/snapshots. Connector-fed streams skip this
   *      step — pushes happen via the SDK after activation.
   *
   * We deliberately do NOT update the URL after step 1 — a hash change at
   * that point would remount <StreamCanvas/> mid-activation and wipe the
   * draft. Post-success navigation happens once the whole lifecycle
   * completes, via `onActivated`.
   */
  const handleActivate = useCallback(async () => {
    if (!allValid) return;
    setActivating(true);
    setActivationResult(null);
    try {
      let targetName = pendingStreamName;
      if (!targetName) {
        if (!draft.identity.stream_name) {
          setActivationResult({ type: "error", message: "Stream name is required." });
          return;
        }
        const created = await createStream(
          draft.identity.stream_name,
          draft.identity.key_cols,
        );
        targetName = created.stream_name;
        handleStreamCreated(created);
      }

      await configureStream(targetName, {
        scale: draft.target_mapping.scale,
        offset: draft.target_mapping.offset,
        exponent: draft.target_mapping.exponent,
        block: {
          annualized: draft.block_shape.annualized,
          temporal_position: draft.block_shape.temporal_position,
          decay_end_size_mult: draft.block_shape.decay_end_size_mult,
          decay_rate_prop_per_min: draft.block_shape.decay_rate_prop_per_min,
          decay_profile: "linear",
          var_fair_ratio: draft.confidence.var_fair_ratio,
        },
        description: draft.identity.description || null,
        sample_csv: isConnectorFed ? null : draft.data_shape.sample_csv || null,
        value_column: isConnectorFed ? null : draft.data_shape.value_column || null,
        connector_name: draft.connector_name,
        connector_params: isConnectorFed ? draft.connector_params : null,
      });

      if (!isConnectorFed) {
        const csvRows = parseCsvToRows(draft.data_shape.sample_csv);
        if (csvRows.length > 0) {
          await ingestSnapshot(targetName, csvRows);
        }
      }

      const message = isConnectorFed
        ? `Activated ${targetName}. Push connector inputs via the SDK to start producing positions.`
        : `Activated ${targetName}. Floor positions will update on the next pipeline tick.`;
      setActivationResult({ type: "success", message });
      refreshRegistry();
      onActivated?.(targetName);
    } catch (err) {
      setActivationResult({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActivating(false);
    }
  }, [
    allValid,
    draft,
    handleStreamCreated,
    isConnectorFed,
    onActivated,
    pendingStreamName,
    refreshRegistry,
  ]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 py-4">
          <div className="mb-4">
            <h2 className="zone-header">Stream Canvas</h2>
            <p className="mt-1 text-[11px] text-mm-text-dim">
              Compose a stream definition. All sections must be valid before Activate unlocks.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <IdentitySection
              value={draft.identity}
              onChange={(v) => updateSlice("identity", v)}
              state={states.identity}
              connectorName={draft.connector_name}
              onConnectorChange={handleConnectorChange}
            />
            <DataShapeSection
              value={draft.data_shape}
              onChange={(v) => updateSlice("data_shape", v)}
              state={states.data_shape}
              connectorName={draft.connector_name}
            />
            <TargetMappingSection
              value={draft.target_mapping}
              onChange={(v) => updateSlice("target_mapping", v)}
              state={states.target_mapping}
              readOnly={isConnectorFed}
            />
            <BlockShapeSection
              value={draft.block_shape}
              onChange={(v) => updateSlice("block_shape", v)}
              state={states.block_shape}
              readOnly={isConnectorFed}
            />
            <ConfidenceSection
              value={draft.confidence}
              onChange={(v) => updateSlice("confidence", v)}
              state={states.confidence}
              readOnly={isConnectorFed}
            />
            <PreviewSection
              draft={draft}
              state={states.preview}
            />
          </div>
        </div>

        <StreamCanvasFooter
          allValid={allValid}
          activating={activating}
          result={activationResult}
          onActivate={handleActivate}
        />
      </div>
    </div>
  );
}

/** Cascade a connector pick through the whole draft. Sections 3-6 inherit
 *  the connector's recommended defaults; clearing the picker leaves the
 *  current values in place (the user is now editing manually).
 */
function applyConnectorSelection(
  prev: StreamDraft,
  next: string | null,
  catalog: ConnectorSchema[],
): StreamDraft {
  if (next === null) {
    return { ...prev, connector_name: null, connector_params: {} };
  }
  const schema = findConnector(catalog, next);
  if (!schema) return prev;
  return {
    ...prev,
    connector_name: next,
    connector_params: Object.fromEntries(
      schema.params.map((p) => [p.name, p.default]),
    ),
    target_mapping: {
      scale: schema.recommended_scale,
      offset: schema.recommended_offset,
      exponent: schema.recommended_exponent,
    },
    block_shape: {
      annualized: schema.recommended_block.annualized,
      temporal_position: schema.recommended_block.temporal_position,
      decay_end_size_mult: schema.recommended_block.decay_end_size_mult,
      decay_rate_prop_per_min: schema.recommended_block.decay_rate_prop_per_min,
    },
    confidence: { var_fair_ratio: schema.recommended_block.var_fair_ratio },
  };
}

/**
 * Merge a `RegisteredStream` from the server back into the draft shape so
 * the form re-opens with the exact values last activated. `prev` wins for
 * any field the registry doesn't persist.
 */
function hydrateDraftFromRegistry(prev: StreamDraft, s: RegisteredStream): StreamDraft {
  return {
    ...prev,
    identity: {
      ...prev.identity,
      stream_name: s.stream_name,
      key_cols: s.key_cols,
      description: s.description ?? prev.identity.description,
    },
    data_shape: {
      ...prev.data_shape,
      sample_csv: s.sample_csv ?? prev.data_shape.sample_csv,
      value_column: s.value_column ?? prev.data_shape.value_column,
    },
    target_mapping: {
      scale: s.scale ?? prev.target_mapping.scale,
      offset: s.offset ?? prev.target_mapping.offset,
      exponent: s.exponent ?? prev.target_mapping.exponent,
    },
    block_shape: s.block
      ? {
          annualized: s.block.annualized,
          temporal_position: s.block.temporal_position,
          decay_end_size_mult: s.block.decay_end_size_mult,
          decay_rate_prop_per_min: s.block.decay_rate_prop_per_min,
        }
      : prev.block_shape,
    confidence: s.block
      ? { var_fair_ratio: s.block.var_fair_ratio }
      : prev.confidence,
    connector_name: s.connector_name ?? null,
    connector_params: s.connector_params ?? {},
  };
}

function initialDraft(
  streamName: string | null,
  prefill: StreamDraftPrefill | null,
): StreamDraft {
  // Prefill takes precedence over the bare streamName path because it
  // carries more information (example row → sample CSV, inferred key_cols).
  // It only applies to a brand-new draft — we never stomp a stream the
  // user is editing in place.
  if (prefill && (streamName === null || streamName === NEW_STREAM_SENTINEL)) {
    return prefilledDraft(prefill);
  }
  // `streamName === "new"` is the URL sentinel for create-mode; don't pre-fill
  // the identity field with the literal string — the user needs an empty
  // field to type the real name into.
  if (streamName && streamName !== NEW_STREAM_SENTINEL) {
    return {
      ...EMPTY_DRAFT,
      identity: { ...EMPTY_DRAFT.identity, stream_name: streamName },
      connector_params: { ...EMPTY_DRAFT.connector_params },
    };
  }
  return { ...EMPTY_DRAFT, connector_params: { ...EMPTY_DRAFT.connector_params } };
}
