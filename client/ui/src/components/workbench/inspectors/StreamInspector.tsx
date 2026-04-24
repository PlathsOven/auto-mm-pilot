import { useCallback, useMemo, useState } from "react";
import { useFocus } from "../../../providers/FocusProvider";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { setStreamActive } from "../../../services/streamApi";
import { BlockIntentCard } from "../../proposal/BlockIntentCard";
import { StreamTimeseriesView } from "./StreamTimeseriesView";

interface StreamInspectorProps {
  name: string;
}

/**
 * Inspector view for a focused data stream.
 *
 * Used today as the block-family deep-dive path from the Blocks tab.
 * Renders the stream chrome (name + status pills + active toggle + clear-
 * focus ✕), then delegates the data viz to the shared StreamTimeseriesView
 * so OpinionInspector can reuse the same chart + key list without this
 * component's chrome.
 */
export function StreamInspector({ name }: StreamInspectorProps) {
  const { clearFocus } = useFocus();
  const { payload } = useWebSocket();
  const [togglePending, setTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Source of truth for the active flag is the WS payload — it's refreshed
  // every tick and already drives the streams list. Default to true so the
  // button renders as "Deactivate" while the first tick is in flight.
  const active = useMemo(() => {
    const match = payload?.streams.find((s) => s.name === name);
    return match ? match.active : true;
  }, [payload, name]);

  const streamMeta = useMemo(
    () => payload?.streams.find((s) => s.name === name) ?? null,
    [payload, name],
  );

  const handleToggleActive = useCallback(async () => {
    setTogglePending(true);
    setToggleError(null);
    try {
      await setStreamActive(name, !active);
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglePending(false);
    }
  }, [name, active]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-black/[0.06] px-3 pb-2 pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Stream {streamMeta && (
              <span
                className={`ml-1 rounded px-1 py-0.5 text-[8px] font-bold ${
                  streamMeta.status === "ONLINE" ? "bg-mm-accent/10 text-mm-accent" : "bg-mm-warn/15 text-mm-warn"
                }`}
              >
                {streamMeta.status}
              </span>
            )}
            {!active && (
              <span className="ml-1 rounded bg-mm-text-dim/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-mm-text-dim">
                Inactive
              </span>
            )}
          </span>
          <span className="text-[13px] font-semibold text-mm-text">{name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={togglePending}
            className={`whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-wait disabled:opacity-50 ${
              active
                ? "border border-mm-error/30 text-mm-error hover:bg-mm-error/10"
                : "border border-mm-accent/30 text-mm-accent hover:bg-mm-accent/10"
            }`}
            title={active ? "Deactivate stream (keeps config, pauses pipeline contribution)" : "Reactivate stream"}
          >
            {active ? "Deactivate" : "Reactivate"}
          </button>
          <button
            type="button"
            onClick={clearFocus}
            className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            title="Clear focus (Esc)"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {toggleError && (
          <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">
            {toggleError}
          </p>
        )}
        <StreamTimeseriesView streamName={name} />
        <BlockIntentCard streamName={name} />
      </div>
    </div>
  );
}
