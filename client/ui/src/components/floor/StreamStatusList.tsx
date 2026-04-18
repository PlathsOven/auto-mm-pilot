import { useWebSocket } from "../../providers/WebSocketProvider";
import { useMode } from "../../providers/ModeProvider";
import { useFocus } from "../../providers/FocusProvider";
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
  const { toggleFocus, isFocused } = useFocus();
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
        {liveStreams.map((stream) => {
          const focused = isFocused({ kind: "stream", name: stream.name });
          return (
            <button
              key={stream.id}
              type="button"
              onClick={() => toggleFocus({ kind: "stream", name: stream.name })}
              className={`glass-card flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-white/60 ${
                focused ? "ring-1 ring-mm-accent/40" : ""
              }`}
            >
              <span className={`truncate text-xs font-medium ${focused ? "text-mm-accent" : "text-mm-text"}`}>
                {stream.name}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-mm-text-subtle">
                {formatAge(Date.now() - stream.lastHeartbeat)}
              </span>
            </button>
          );
        })}

        {liveStreams.length === 0 && (
          <p className="text-xs text-mm-text-dim">
            No streams flowing. Open Anatomy to create one.
          </p>
        )}
      </div>
    </div>
  );
}
