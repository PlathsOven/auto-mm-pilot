import { useState } from "react";
import { deleteStream } from "../../services/streamApi";
import { useMode } from "../../providers/ModeProvider";
import { useRegisteredStreams } from "../../hooks/useRegisteredStreams";
import { STREAM_TEMPLATES } from "./templates";

/**
 * Studio Streams Library — entry point for the architect.
 *
 * Lists all registered streams as cards (with status, key cols, registry
 * health) plus 5 quick-start templates. Clicking a card or template navigates
 * to the canvas at `#studio/streams/{name}` for editing.
 *
 * Stream list comes from the shared `useRegisteredStreams` hook so Floor's
 * StreamStatusList and Studio's StreamLibrary share a single polling loop.
 */
export function StreamLibrary() {
  const { setMode } = useMode();
  const { streams, loading, error, refresh } = useRegisteredStreams();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const openCanvas = (streamName: string) => setMode("studio", `streams/${streamName}`);
  const openTemplate = (templateId: string) =>
    setMode("studio", `streams/new?template=${templateId}`);
  const openBlankCanvas = () => setMode("studio", "streams/new");

  const handleDelete = async (streamName: string) => {
    try {
      await deleteStream(streamName);
      await refresh();
      setMutationError(null);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    }
  };

  const displayError = error ?? mutationError;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="zone-header">Streams Library</h2>
          <p className="mt-1 text-[11px] text-mm-text-dim">
            Every data source that contributes a view on fair value lives here.
          </p>
        </div>
        <button
          type="button"
          onClick={openBlankCanvas}
          className="rounded-lg bg-mm-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90"
        >
          + New stream
        </button>
      </header>

      {displayError && (
        <p className="mb-3 rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[10px] text-mm-error">
          {displayError}
        </p>
      )}

      {/* Registered streams */}
      <section className="mb-6">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Registered ({streams.length})
        </h3>
        {loading && streams.length === 0 ? (
          <p className="text-[11px] text-mm-text-dim">Loading…</p>
        ) : streams.length === 0 ? (
          <div className="rounded-xl border border-dashed border-mm-border/60 p-6 text-center">
            <p className="text-[11px] text-mm-text-dim">
              No streams yet. Pick a template below to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {streams.map((s) => (
              <article
                key={s.stream_name}
                className="group flex cursor-pointer flex-col gap-2 rounded-xl border border-mm-border/40 bg-mm-bg/40 p-3 transition-colors hover:border-mm-accent/40 hover:bg-mm-bg/60"
                onClick={() => openCanvas(s.stream_name)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-mm-text">
                    {s.stream_name}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase ${
                      s.status === "READY"
                        ? "bg-mm-accent/15 text-mm-accent"
                        : "bg-mm-warn/15 text-mm-warn"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="text-[10px] text-mm-text-dim">
                  Keys: {s.key_cols.join(", ")}
                </div>
                {s.block && (
                  <div className="text-[10px] text-mm-text-dim">
                    {s.block.aggregation_logic} · var/fair = {s.block.var_fair_ratio}
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between border-t border-mm-border/30 pt-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCanvas(s.stream_name);
                    }}
                    className="text-[10px] font-medium text-mm-accent hover:underline"
                  >
                    Open in canvas →
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(s.stream_name);
                    }}
                    className="text-[10px] text-mm-text-dim transition-colors hover:text-mm-error"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Templates */}
      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Quick-start templates
        </h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {STREAM_TEMPLATES.map((tpl) => (
            <article
              key={tpl.id}
              className="group flex cursor-pointer flex-col gap-2 rounded-xl border border-mm-border/40 bg-mm-bg/40 p-3 transition-colors hover:border-mm-accent/40 hover:bg-mm-bg/60"
              onClick={() => openTemplate(tpl.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-mm-text">{tpl.title}</span>
                <span className="shrink-0 text-[9px] uppercase text-mm-accent">Template</span>
              </div>
              <p className="text-[10px] text-mm-text-dim">{tpl.oneLiner}</p>
              <p className="text-[10px] text-mm-text-dim/80">{tpl.description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
