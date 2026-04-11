import { useWebSocket } from "../../providers/WebSocketProvider";
import { useMode } from "../../providers/ModeProvider";
import { formatAge } from "../../utils";

/**
 * Read-only stream list — Eyes mode.
 *
 * Intentionally minimal: every live stream is one row showing its name and
 * how long ago it last updated. Status dots, registry state, and key-col
 * metadata all live in Anatomy — Eyes is a "is the data flowing?" surface,
 * not a workspace.
 */
export function StreamStatusList() {
  const { payload } = useWebSocket();
  const { navigate } = useMode();
  const liveStreams = payload?.streams ?? [];

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-black/[0.06] pb-2">
        <h2 className="zone-header">Data Streams</h2>
        <button
          onClick={() => navigate("anatomy?streams=list")}
          className="rounded-md bg-mm-accent/8 px-2 py-0.5 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/10"
          title="Open Anatomy to create or edit streams"
        >
          Manage in Anatomy →
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {liveStreams.map((stream) => (
          <div
            key={stream.id}
            className="glass-card flex items-center justify-between gap-3 px-3 py-2"
          >
            <span className="truncate text-xs font-medium text-mm-text">
              {stream.name}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-mm-text-subtle">
              {formatAge(Date.now() - stream.lastHeartbeat)}
            </span>
          </div>
        ))}

        {liveStreams.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            No streams flowing. Open Anatomy to create one.
          </p>
        )}
      </div>
    </div>
  );
}
