import { useWebSocket } from "../../providers/WebSocketProvider";
import { useMode } from "../../providers/ModeProvider";
import { useRegisteredStreams } from "../../hooks/useRegisteredStreams";
import type { RegisteredStreamStatus, StreamStatus } from "../../types";
import { formatAge } from "../../utils";

const LIVE_STATUS_DOT: Record<StreamStatus, string> = {
  ONLINE: "bg-mm-accent",
  DEGRADED: "bg-mm-warn",
  OFFLINE: "bg-mm-error",
};

const LIVE_STATUS_TEXT: Record<StreamStatus, string> = {
  ONLINE: "text-mm-accent",
  DEGRADED: "text-mm-warn",
  OFFLINE: "text-mm-error",
};

const REG_STATUS_DOT: Record<RegisteredStreamStatus, string> = {
  PENDING: "bg-mm-warn",
  READY: "bg-mm-accent",
};

const REG_STATUS_TEXT: Record<RegisteredStreamStatus, string> = {
  PENDING: "text-mm-warn",
  READY: "text-mm-accent",
};

/**
 * Read-only stream status list — Floor mode.
 *
 * Shows registry status (PENDING / READY) and live heartbeat health for each
 * stream. All CRUD operations live in Studio Streams; this component is
 * intentionally non-editable so the operator surface stays focused on
 * monitoring.
 */
export function StreamStatusList() {
  const { payload } = useWebSocket();
  const { setMode } = useMode();
  const { streams: registeredStreams, error: loadError } = useRegisteredStreams();
  const liveStreams = payload?.streams ?? [];

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-mm-border/40 pb-2">
        <h2 className="zone-header">Data Streams</h2>
        <button
          onClick={() => setMode("studio", "streams")}
          className="rounded bg-mm-accent/10 px-2 py-0.5 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/20"
          title="Open Studio to create or edit streams"
        >
          Manage in Studio →
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {registeredStreams.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-mm-text-dim">
              Registry
            </p>
            {registeredStreams.map((stream) => (
              <div
                key={stream.stream_name}
                className="flex items-center gap-3 rounded-lg border border-mm-border/40 bg-mm-bg/50 p-3"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${REG_STATUS_DOT[stream.status]}`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-xs font-medium text-mm-text">
                    {stream.stream_name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-medium ${REG_STATUS_TEXT[stream.status]}`}>
                      {stream.status}
                    </span>
                    <span className="text-[10px] text-mm-text-dim">
                      {stream.key_cols.join(", ")}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {liveStreams.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-mm-text-dim">
              Live
            </p>
            {liveStreams.map((stream) => (
              <div
                key={stream.id}
                className="flex items-center gap-3 rounded-lg border border-mm-border/40 bg-mm-bg/50 p-3"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${LIVE_STATUS_DOT[stream.status]}`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-xs font-medium text-mm-text">
                    {stream.name}
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-medium ${LIVE_STATUS_TEXT[stream.status]}`}>
                      {stream.status}
                    </span>
                    <span className="text-[10px] text-mm-text-dim">
                      {formatAge(Date.now() - stream.lastHeartbeat)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {registeredStreams.length === 0 && liveStreams.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            No streams registered. Open Studio to create one.
          </p>
        )}

        {loadError && (
          <p className="text-[10px] text-mm-error">
            Failed to load streams: {loadError}
          </p>
        )}
      </div>
    </div>
  );
}
