import { useCallback, useEffect, useMemo, useState } from "react";
import { createStream } from "../../services/streamApi";
import { useMode } from "../../providers/ModeProvider";
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
  validateAll,
  isAllValid,
  type StreamDraft,
  type SectionId,
} from "./canvasState";
import { STREAM_TEMPLATES } from "./streamTemplates";
import { migrateLegacyStorageKey } from "../../utils";

interface Props {
  /** Stream name from the URL (#anatomy?stream={name}) — empty for a new draft. */
  streamName: string | null;
  /** Optional template id from URL query, e.g. #anatomy?stream=new&template=fomc_event */
  templateId: string | null;
}

const WALK_THROUGH_KEY = "posit.studio.walkthrough";
const LEGACY_WALK_THROUGH_KEY = "apt.studio.walkthrough";

/**
 * The Studio Stream Canvas. Hosts all 7 sections.
 *
 * State model: a single `StreamDraft` lives in this component. Each section
 * receives its slice + an updater. The Activate button (in PreviewSection)
 * commits via `POST /api/streams/{name}/configure` and `POST /api/snapshots`.
 */
export function StreamCanvas({ streamName, templateId }: Props) {
  const { navigate } = useMode();
  const { streams: registry, refresh: refreshRegistry, addStream } = useRegisteredStreams();
  const [draft, setDraft] = useState<StreamDraft>(() => initialDraft(streamName, templateId));
  const [pendingStreamName, setPendingStreamName] = useState<string | null>(streamName);
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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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


  const handleCreateStream = async () => {
    if (!draft.identity.stream_name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createStream(draft.identity.stream_name, draft.identity.key_cols);
      setPendingStreamName(created.stream_name);
      // Optimistically inject into the shared registry cache so subscribers
      // re-render immediately. We deliberately do NOT await refreshRegistry()
      // here — joining its in-flight polling promise was the source of the
      // "Creating…" hang.
      addStream(created);
      // Update URL so refresh keeps the canvas pinned to this stream inside
      // the Anatomy streams sidebar.
      navigate(`anatomy?stream=${encodeURIComponent(created.stream_name)}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

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

        {!pendingStreamName && draft.identity.stream_name && (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-mm-warn/40 bg-mm-warn/10 px-3 py-2">
            <span className="text-[11px] text-mm-warn">
              Stream <strong>{draft.identity.stream_name}</strong> is not yet registered. Create it to enable Activate.
            </span>
            <button
              type="button"
              disabled={creating || states.identity.status !== "valid"}
              onClick={handleCreateStream}
              className="rounded-md bg-mm-warn/20 px-3 py-1 text-[10px] font-semibold text-mm-warn transition-colors hover:bg-mm-warn/30 disabled:opacity-40"
            >
              {creating ? "Creating…" : "Register stream"}
            </button>
          </div>
        )}

        {createError && (
          <p className="mb-3 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
            {createError}
          </p>
        )}

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
              onActivated={() => refreshRegistry()}
              dimmed={dimmed("preview")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function initialDraft(streamName: string | null, templateId: string | null): StreamDraft {
  if (templateId) {
    const tpl = STREAM_TEMPLATES.find((t) => t.id === templateId);
    if (tpl) return tpl.draft;
  }
  if (streamName) {
    return {
      ...EMPTY_DRAFT,
      identity: { ...EMPTY_DRAFT.identity, stream_name: streamName },
    };
  }
  return EMPTY_DRAFT;
}
