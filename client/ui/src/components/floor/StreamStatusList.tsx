import { useCallback, useState } from "react";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { useMode } from "../../providers/ModeProvider";
import { useFocus } from "../../providers/FocusProvider";
import { setStreamActive } from "../../services/streamApi";
import { formatAge } from "../../utils";

/**
 * Workbench data-streams list.
 *
 * One row per registered stream that the pipeline would consume. Each row has
 * a power-toggle affordance on the right — click to deactivate (stream stays
 * in the registry but drops out of the pipeline) or reactivate. Click on the
 * row body still sets focus so the StreamInspector opens in the right rail.
 */
export function StreamStatusList() {
  const { payload } = useWebSocket();
  const { navigate } = useMode();
  const { toggleFocus, isFocused } = useFocus();
  const liveStreams = payload?.streams ?? [];
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const toggleActive = useCallback(
    async (name: string, nextActive: boolean) => {
      setPending((prev) => ({ ...prev, [name]: true }));
      setError(null);
      try {
        await setStreamActive(name, nextActive);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    },
    [],
  );

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-black/[0.06] pb-2">
        <h2 className="zone-header">Data Streams</h2>
        <button
          onClick={() => navigate("anatomy")}
          className="rounded-md bg-mm-accent/8 px-2 py-0.5 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/10"
          title="Open Anatomy to create or edit streams"
        >
          Manage in Anatomy →
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">
          {error}
        </p>
      )}

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {liveStreams.map((stream) => {
          const focused = isFocused({ kind: "stream", name: stream.name });
          const isPending = !!pending[stream.name];
          const inactive = !stream.active;
          return (
            <div
              key={stream.id}
              className={`glass-card flex items-center gap-2 px-3 py-2 transition-colors hover:bg-white/60 ${
                focused ? "ring-1 ring-mm-accent/40" : ""
              } ${inactive ? "opacity-55" : ""}`}
            >
              <button
                type="button"
                onClick={() => toggleFocus({ kind: "stream", name: stream.name })}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`truncate text-xs font-medium ${focused ? "text-mm-accent" : "text-mm-text"}`}>
                    {stream.name}
                  </span>
                  {inactive && (
                    <span className="shrink-0 rounded bg-mm-text-dim/15 px-1 py-[1px] text-[8px] font-semibold uppercase tracking-wider text-mm-text-dim">
                      Off
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-mm-text-subtle">
                  {formatAge(Date.now() - stream.lastHeartbeat)}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleActive(stream.name, !stream.active);
                }}
                disabled={isPending}
                className={`shrink-0 rounded-md p-1 text-[11px] transition-colors ${
                  inactive
                    ? "text-mm-text-dim hover:bg-mm-accent/10 hover:text-mm-accent"
                    : "text-mm-text-subtle hover:bg-mm-error/10 hover:text-mm-error"
                } disabled:cursor-wait disabled:opacity-50`}
                title={inactive ? "Reactivate stream" : "Deactivate stream"}
                aria-label={inactive ? `Reactivate ${stream.name}` : `Deactivate ${stream.name}`}
              >
                {POWER_ICON}
              </button>
            </div>
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

const POWER_ICON = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M8 2v6" />
    <path d="M4.5 4.5a5 5 0 1 0 7 0" />
  </svg>
);
