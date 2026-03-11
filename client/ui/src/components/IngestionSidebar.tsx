import { useWebSocket } from "../providers/WebSocketProvider";
import type { StreamStatus } from "../types";

const STATUS_COLORS: Record<StreamStatus, string> = {
  ONLINE: "bg-mm-accent",
  DEGRADED: "bg-mm-warn",
  OFFLINE: "bg-mm-error",
};

const STATUS_TEXT_COLORS: Record<StreamStatus, string> = {
  ONLINE: "text-mm-accent",
  DEGRADED: "text-mm-warn",
  OFFLINE: "text-mm-error",
};

function formatAge(ms: number): string {
  if (ms < 1000) return "just now";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}

export function IngestionSidebar() {
  const { payload } = useWebSocket();
  const streams = payload?.streams ?? [];

  return (
    <div className="flex h-full flex-col p-4">
      <h2 className="zone-header mb-3 border-b border-mm-border pb-2">Data Streams</h2>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {streams.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            Awaiting connection...
          </p>
        )}

        {streams.map((stream) => (
          <div
            key={stream.id}
            className="flex items-center gap-3 border border-mm-border bg-mm-surface p-3"
          >
            <span
              className={`inline-block h-2 w-2 shrink-0 ${STATUS_COLORS[stream.status]}`}
            />

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-xs font-medium text-mm-text">
                {stream.name}
              </span>

              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] font-medium ${STATUS_TEXT_COLORS[stream.status]}`}
                >
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
    </div>
  );
}
