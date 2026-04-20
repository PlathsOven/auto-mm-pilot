import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRegisteredStreams } from "../../hooks/useRegisteredStreams";
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
import { STREAM_TEMPLATES } from "./streamTemplates";
import { configureStream, createStream, ingestSnapshot } from "../../services/streamApi";
import type { RegisteredStream } from "../../types";

interface Props {
  /** Stream name from the URL (#anatomy?stream={name}) — empty for a new draft. */
  streamName: string | null;
  /** Optional template id from URL query, e.g. #anatomy?stream=new&template=fomc_event */
  templateId: string | null;
  /** Optional pre-filled draft values — used when deep-linking from the
   *  Notifications center with a captured unregistered push. Only applied
   *  when `streamName === "new"` (templateId wins if also set). */
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
 * The Studio Stream Canvas. Hosts all 7 sections plus the sticky Activate
 * footer.
 *
 * State model: a single `StreamDraft` lives in this component. Each section
 * receives its slice + an updater. Activation state (in-flight flag,
 * result) is owned here so the footer can stay pinned and independent of
 * the scrolling sections.
 */
export function StreamCanvas({ streamName, templateId, prefill, onActivated }: Props) {
  const { streams: registry, refresh: refreshRegistry, addStream } = useRegisteredStreams();
  const [draft, setDraft] = useState<StreamDraft>(() =>
    initialDraft(streamName, templateId, prefill ?? null),
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
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!streamName) return;
    const existing = registry.find((s) => s.stream_name === streamName);
    if (!existing) return;
    if (hydratedFor.current === existing.stream_name) return;
    hydratedFor.current = existing.stream_name;
    setPendingStreamName(existing.stream_name);
    setDraft((prev) => hydrateDraftFromRegistry(prev, existing));
  }, [streamName, registry]);

  const states = useMemo(() => validateAll(draft), [draft]);
  const allValid = useMemo(() => isAllValid(states), [states]);

  const updateSlice = useCallback(<K extends keyof StreamDraft>(key: K, value: StreamDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

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
   *   2. POST /api/streams/{name}/configure with target_mapping + block_shape.
   *   3. If the sample CSV is non-empty, ingest those rows via POST
   *      /api/snapshots.
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
        sample_csv: draft.data_shape.sample_csv || null,
        value_column: draft.data_shape.value_column || null,
      });

      const csvRows = parseCsvToRows(draft.data_shape.sample_csv);
      if (csvRows.length > 0) {
        await ingestSnapshot(targetName, csvRows);
      }

      setActivationResult({
        type: "success",
        message: `Activated ${targetName}. Floor positions will update on the next pipeline tick.`,
      });
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
    onActivated,
    pendingStreamName,
    refreshRegistry,
  ]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Main canvas — left 2/3. The column is itself a flex column:
          sections scroll inside, footer stays pinned. Without the explicit
          flex-col + min-h-0 split the footer would push the scroll area
          off-screen instead of staying visible at the bottom. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
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
            />
            <DataShapeSection
              value={draft.data_shape}
              onChange={(v) => updateSlice("data_shape", v)}
              state={states.data_shape}
            />
            <TargetMappingSection
              value={draft.target_mapping}
              onChange={(v) => updateSlice("target_mapping", v)}
              state={states.target_mapping}
            />
            <BlockShapeSection
              value={draft.block_shape}
              onChange={(v) => updateSlice("block_shape", v)}
              state={states.block_shape}
            />
            <ConfidenceSection
              value={draft.confidence}
              onChange={(v) => updateSlice("confidence", v)}
              state={states.confidence}
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

/**
 * Merge a `RegisteredStream` from the server back into the draft shape so
 * the form re-opens with the exact values last activated. `prev` wins for
 * any field the registry doesn't persist (nothing today, but keeps the
 * merge safe against future section additions).
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
  };
}

function initialDraft(
  streamName: string | null,
  templateId: string | null,
  prefill: StreamDraftPrefill | null,
): StreamDraft {
  if (templateId) {
    const tpl = STREAM_TEMPLATES.find((t) => t.id === templateId);
    if (tpl) return tpl.draft;
  }
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
    };
  }
  return EMPTY_DRAFT;
}
