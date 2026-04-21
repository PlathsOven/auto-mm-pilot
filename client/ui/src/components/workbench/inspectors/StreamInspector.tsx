import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocus } from "../../../providers/FocusProvider";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { fetchStreamTimeseries } from "../../../services/streamTimeseriesApi";
import { setStreamActive } from "../../../services/streamApi";
import type { StreamTimeseriesResponse } from "../../../types";
import { POLL_INTERVAL_TIMESERIES_MS } from "../../../constants";

interface StreamInspectorProps {
  name: string;
}

/**
 * Right-rail metadata card for a focused data stream.
 *
 * The raw-value time series moved to the canvas's Block/Stream tab panel
 * (wider horizontal real estate). This card keeps the summary + the
 * Deactivate/Reactivate button — both handy alongside whichever canvas
 * tab the trader has active. Polls the timeseries endpoint only for the
 * status + row count metadata; the chart itself renders in the canvas
 * panel.
 */
export function StreamInspector({ name }: StreamInspectorProps) {
  const { clearFocus } = useFocus();
  const { payload } = useWebSocket();
  const [data, setData] = useState<StreamTimeseriesResponse | null>(null);
  const [togglePending, setTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const active = useMemo(() => {
    const match = payload?.streams.find((s) => s.name === name);
    return match ? match.active : true;
  }, [payload, name]);

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

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();

    const load = () => {
      fetchStreamTimeseries(name, controller.signal)
        .then((res) => {
          if (aborted) return;
          setData(res);
        })
        .catch(() => { /* metadata-only panel — swallow errors */ });
    };

    setData(null);
    load();
    const interval = setInterval(load, POLL_INTERVAL_TIMESERIES_MS);
    return () => {
      aborted = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [name]);

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <header className="flex items-start justify-between gap-2 border-b border-black/[0.06] pb-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Stream {data && (
              <span
                className={`ml-1 rounded px-1 py-0.5 text-[8px] font-bold ${
                  data.status === "READY" ? "bg-mm-accent/10 text-mm-accent" : "bg-mm-warn/15 text-mm-warn"
                }`}
              >
                {data.status}
              </span>
            )}
            {!active && (
              <span className="ml-1 rounded bg-mm-text-dim/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-mm-text-dim">
                Inactive
              </span>
            )}
          </span>
          <span className="text-[13px] font-semibold text-mm-text">{name}</span>
          {data && (
            <span className="text-[9px] text-mm-text-subtle">
              {data.row_count} row{data.row_count === 1 ? "" : "s"} · {data.series.length} key{data.series.length === 1 ? "" : "s"} · {data.key_cols.join(", ") || "—"}
            </span>
          )}
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

      {toggleError && <p className="rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">{toggleError}</p>}

      <p className="text-[11px] text-mm-text-dim">
        Raw-value time series →{" "}
        <span className="font-semibold text-mm-text">Stream</span> tab in the Block panel below.
      </p>
    </div>
  );
}
