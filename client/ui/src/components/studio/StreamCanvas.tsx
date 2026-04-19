import { useCallback, useEffect, useMemo, useState } from "react";
import { useRegisteredStreams } from "../../hooks/useRegisteredStreams";
import { IdentitySection } from "./sections/IdentitySection";
import { DataShapeSection } from "./sections/DataShapeSection";
import { TargetMappingSection } from "./sections/TargetMappingSection";
import { BlockShapeSection } from "./sections/BlockShapeSection";
import { AggregationSection } from "./sections/AggregationSection";
import { ConfidenceSection } from "./sections/ConfidenceSection";
import { PreviewSection } from "./sections/PreviewSection";
import {
  EMPTY_DRAFT,
  prefilledDraft,
  validateAll,
  isAllValid,
  type StreamDraft,
  type StreamDraftPrefill,
  type SectionId,
} from "./canvasState";
import { STREAM_TEMPLATES } from "./streamTemplates";
import { migrateLegacyStorageKey } from "../../utils";
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

const WALK_THROUGH_KEY = "posit.studio.walkthrough";
const LEGACY_WALK_THROUGH_KEY = "apt.studio.walkthrough";

/** URL sentinel that means "open the form in create mode" — not a real name. */
const NEW_STREAM_SENTINEL = "new";

/**
 * The Studio Stream Canvas. Hosts all 7 sections.
 *
 * State model: a single `StreamDraft` lives in this component. Each section
 * receives its slice + an updater. The Activate button (in PreviewSection)
 * is the single lifecycle trigger — it creates the stream if needed,
 * configures it, and ingests the sample rows in one call.
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
  const [walkThrough, setWalkThrough] = useState(() => {
    migrateLegacyStorageKey(LEGACY_WALK_THROUGH_KEY, WALK_THROUGH_KEY);
    try {
      const v = localStorage.getItem(WALK_THROUGH_KEY);
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  });
  const [focusedSection, setFocusedSection] = useState<SectionId>("identity");

  // Sync stream name draft → registry status
  useEffect(() => {
    if (!streamName) return;
    const existing = registry.find((s) => s.stream_name === streamName);
    if (existing) {
      setPendingStreamName(existing.stream_name);
      setDraft((prev) => ({
        ...prev,
        identity: { ...prev.identity, stream_name: existing.stream_name, key_cols: existing.key_cols },
      }));
    }
  }, [streamName, registry]);

  // Persist walk-through preference
  useEffect(() => {
    try {
      localStorage.setItem(WALK_THROUGH_KEY, String(walkThrough));
    } catch {
      // ignore
    }
  }, [walkThrough]);

  const states = useMemo(() => validateAll(draft), [draft]);
  const allValid = useMemo(() => isAllValid(states), [states]);

  const updateSlice = useCallback(<K extends keyof StreamDraft>(key: K, value: StreamDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** PreviewSection fires this the moment Activate creates the stream on
   *  the fly, so we can update the local pending-name state and seed the
   *  shared registry cache. We deliberately do NOT navigate the URL here —
   *  configure + ingest are still in-flight on the current instance, and a
   *  URL change at this point would trigger a `<StreamCanvas/>` remount
   *  that wipes the draft mid-activation. The post-success navigation
   *  happens once the whole lifecycle completes, via `onActivated`. */
  const handleStreamCreated = useCallback(
    (created: RegisteredStream) => {
      setPendingStreamName(created.stream_name);
      addStream(created);
    },
    [addStream],
  );

  const handleActivationSuccess = useCallback(
    (name: string) => {
      refreshRegistry();
      onActivated?.(name);
    },
    [onActivated, refreshRegistry],
  );

  const dimmed = (id: SectionId) => walkThrough && focusedSection !== id;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Main canvas — left 2/3 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="zone-header">Stream Canvas</h2>
            <p className="mt-1 text-[11px] text-mm-text-dim">
              Compose a stream definition. All sections must be valid before Activate unlocks.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[10px] text-mm-text-dim">
              <input
                type="checkbox"
                checked={walkThrough}
                onChange={(e) => setWalkThrough(e.target.checked)}
                className="h-3 w-3 accent-mm-accent"
              />
              Walk me through this
            </label>
          </div>
        </div>

        <div
          className="flex flex-col gap-3"
          onMouseLeave={() => walkThrough && setFocusedSection("identity")}
        >
          <div onMouseEnter={() => setFocusedSection("identity")}>
            <IdentitySection
              value={draft.identity}
              onChange={(v) => updateSlice("identity", v)}
              state={states.identity}
              dimmed={dimmed("identity")}
            />
          </div>
          <div onMouseEnter={() => setFocusedSection("data_shape")}>
            <DataShapeSection
              value={draft.data_shape}
              onChange={(v) => updateSlice("data_shape", v)}
              state={states.data_shape}
              dimmed={dimmed("data_shape")}
            />
          </div>
          <div onMouseEnter={() => setFocusedSection("target_mapping")}>
            <TargetMappingSection
              value={draft.target_mapping}
              onChange={(v) => updateSlice("target_mapping", v)}
              state={states.target_mapping}
              dimmed={dimmed("target_mapping")}
            />
          </div>
          <div onMouseEnter={() => setFocusedSection("block_shape")}>
            <BlockShapeSection
              value={draft.block_shape}
              onChange={(v) => updateSlice("block_shape", v)}
              state={states.block_shape}
              dimmed={dimmed("block_shape")}
            />
          </div>
          <div onMouseEnter={() => setFocusedSection("aggregation")}>
            <AggregationSection
              value={draft.aggregation}
              onChange={(v) => updateSlice("aggregation", v)}
              state={states.aggregation}
              dimmed={dimmed("aggregation")}
            />
          </div>
          <div onMouseEnter={() => setFocusedSection("confidence")}>
            <ConfidenceSection
              value={draft.confidence}
              onChange={(v) => updateSlice("confidence", v)}
              state={states.confidence}
              dimmed={dimmed("confidence")}
            />
          </div>
          <div onMouseEnter={() => setFocusedSection("preview")}>
            <PreviewSection
              draft={draft}
              state={states.preview}
              allValid={allValid}
              pendingStreamName={pendingStreamName}
              onStreamCreated={handleStreamCreated}
              onActivated={handleActivationSuccess}
              dimmed={dimmed("preview")}
            />
          </div>
        </div>
      </div>
    </div>
  );
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
