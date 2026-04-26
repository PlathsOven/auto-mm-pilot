import { useCallback, useEffect, useMemo, useState } from "react";
import { useMode } from "../../../providers/ModeProvider";
import type { AnatomySelection } from "./NodeDetailPanel";
import type { StreamDraftPrefill } from "../canvasState";
import type { StepKey } from "./anatomyGraph";

/** Parse the Notifications-center prefill params off the URL query. */
function parsePrefill(
  streamParam: string | undefined,
  nameParam: string | undefined,
  keyColsParam: string | undefined,
  rowParam: string | undefined,
): StreamDraftPrefill | null {
  if (streamParam !== "new") return null;
  let exampleRow: Record<string, unknown> | undefined;
  if (rowParam) {
    try {
      const parsed = JSON.parse(rowParam);
      if (parsed && typeof parsed === "object") {
        exampleRow = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed prefillRow shouldn't block the form from opening.
    }
  }
  const keyCols = keyColsParam
    ? keyColsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  if (!nameParam && !keyCols && !exampleRow) return null;
  return {
    streamName: nameParam || undefined,
    keyCols,
    exampleRow,
  };
}

export interface AnatomySelectionState {
  selection: AnatomySelection;
  streamPrefill: StreamDraftPrefill | null;
  closePanel: () => void;
  openStream: (name: string) => void;
  openTransform: (stepKey: StepKey) => void;
  openCorrelations: () => void;
}

/**
 * Owns the Anatomy right-panel selection state plus the URL-query sync.
 *
 * Initial selection and subsequent `query.stream` changes are reflected
 * into the panel. Clearing the hash does *not* stomp a panel the user
 * opened manually via node clicks — we only react to the positive cases.
 */
export function useAnatomySelection(): AnatomySelectionState {
  const { query } = useMode();

  const [selection, setSelection] = useState<AnatomySelection>(() => {
    if (query.stream) return { kind: "stream", streamName: query.stream };
    return { kind: "none" };
  });

  useEffect(() => {
    if (query.stream) {
      setSelection({ kind: "stream", streamName: query.stream });
    }
  }, [query.stream]);

  const streamPrefill = useMemo<StreamDraftPrefill | null>(
    () => parsePrefill(query.stream, query.prefillName, query.prefillKeyCols, query.prefillRow),
    [query.stream, query.prefillName, query.prefillKeyCols, query.prefillRow],
  );

  const closePanel = useCallback(() => setSelection({ kind: "none" }), []);
  const openStream = useCallback(
    (name: string) => setSelection({ kind: "stream", streamName: name }),
    [],
  );
  const openTransform = useCallback(
    (stepKey: StepKey) => setSelection({ kind: "transform", stepKey }),
    [],
  );
  const openCorrelations = useCallback(
    () => setSelection({ kind: "correlations" }),
    [],
  );

  return { selection, streamPrefill, closePanel, openStream, openTransform, openCorrelations };
}
