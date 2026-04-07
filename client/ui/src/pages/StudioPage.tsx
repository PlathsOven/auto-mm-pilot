import { useMode } from "../providers/ModeProvider";
import { StreamLibrary } from "../components/studio/StreamLibrary";
import { StreamCanvas } from "../components/studio/StreamCanvas";
import { PipelineComposer } from "../components/studio/PipelineComposer";

/**
 * Studio — the architect's workbench.
 *
 * Routes (hash sub-paths parsed by ModeProvider):
 *  - `#studio` or `#studio/streams`            → Stream Library
 *  - `#studio/streams/{name}`                  → Stream Canvas (edit existing)
 *  - `#studio/streams/new`                     → Stream Canvas (blank)
 *  - `#studio/streams/new?template={id}`       → Stream Canvas (preloaded template)
 *  - `#studio/pipeline`                        → Pipeline Composer
 */
export function StudioPage() {
  const { segments, query, setMode } = useMode();
  const section = segments[0] === "pipeline" ? "pipeline" : "streams";
  const streamName = section === "streams" ? segments[1] ?? null : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-mm-border/40 bg-mm-surface/40 px-6">
        <SectionTab
          label="Streams"
          active={section === "streams"}
          onClick={() => setMode("studio", "streams")}
        />
        <SectionTab
          label="Pipeline"
          active={section === "pipeline"}
          onClick={() => setMode("studio", "pipeline")}
        />
      </nav>

      {section === "streams" && streamName === null && <StreamLibrary />}
      {section === "streams" && streamName !== null && (
        <StreamCanvas
          streamName={streamName === "new" ? null : streamName}
          templateId={query.template ?? null}
        />
      )}
      {section === "pipeline" && <PipelineComposer />}
    </div>
  );
}

function SectionTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-3 text-xs font-medium transition-colors ${
        active
          ? "border-mm-accent text-mm-accent"
          : "border-transparent text-mm-text-dim hover:border-mm-border hover:text-mm-text"
      }`}
    >
      {label}
    </button>
  );
}
