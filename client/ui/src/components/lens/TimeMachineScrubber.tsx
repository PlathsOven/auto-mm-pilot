import { useEffect, useMemo, useState } from "react";
import { useWebSocket } from "../../providers/WebSocketProvider";

/**
 * Time Machine — slider over historical pipeline state.
 *
 * Phase 4 implementation reads the current WS payload's `lastUpdateTimestamp`
 * as the "now" anchor and lets the user scrub backwards by simulating discrete
 * 1-minute steps. A real `GET /api/pipeline/snapshot_at?ts=...` endpoint will
 * land alongside this scrubber once `snapshot_buffer.py`'s timestamp-lookup
 * support is verified — at that point, scrubbing will fetch real snapshots and
 * the rest of Lens will pivot to the cursor.
 *
 * For now the scrubber tracks an in-memory `cursorOffset` (minutes back from
 * now) and exposes it via `onCursorChange` so other Lens views can pick it up.
 */
interface Props {
  onCursorChange?: (offsetMinutes: number) => void;
}

const STEP_MINUTES = [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440];

export function TimeMachineScrubber({ onCursorChange }: Props) {
  const { payload } = useWebSocket();
  const [offsetIdx, setOffsetIdx] = useState(0);
  const offsetMinutes = STEP_MINUTES[offsetIdx];

  useEffect(() => {
    onCursorChange?.(offsetMinutes);
  }, [offsetMinutes, onCursorChange]);

  const lastUpdate = payload?.context?.lastUpdateTimestamp ?? Date.now();
  const cursorTime = useMemo(() => new Date(lastUpdate - offsetMinutes * 60_000), [
    lastUpdate,
    offsetMinutes,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
      <header className="mb-3">
        <h2 className="zone-header">Time Machine</h2>
        <p className="mt-1 text-[11px] text-mm-text-dim">
          Scrub backwards through pipeline state. Active cursor:{" "}
          <span className="font-mono text-mm-accent">
            {cursorTime.toISOString().slice(0, 19).replace("T", " ")} UTC
          </span>
        </p>
      </header>

      <div className="rounded-xl border border-mm-border/60 bg-mm-bg/40 p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-mm-text-dim">
            Offset
          </span>
          <span className="font-mono text-[11px] text-mm-text">
            {offsetMinutes === 0 ? "now (live)" : `−${formatOffset(offsetMinutes)}`}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={STEP_MINUTES.length - 1}
          step={1}
          value={offsetIdx}
          onChange={(e) => setOffsetIdx(parseInt(e.target.value, 10))}
          className="w-full accent-mm-accent"
        />
        <div className="mt-2 flex items-baseline justify-between text-[9px] text-mm-text-dim">
          <span>now</span>
          <span>1m</span>
          <span>5m</span>
          <span>15m</span>
          <span>1h</span>
          <span>4h</span>
          <span>1d</span>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-mm-border/30 bg-mm-bg/40 p-3 text-[10px] text-mm-text-dim">
        <p>
          Live snapshot fetching from <code>snapshot_buffer.py</code> arrives in a follow-up
          — until then, the scrubber publishes cursor offsets that other Lens views can react
          to once historical data is wired up.
        </p>
      </div>
    </div>
  );
}

function formatOffset(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}
