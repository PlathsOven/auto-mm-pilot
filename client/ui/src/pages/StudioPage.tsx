import { useMemo } from "react";
import { useMode } from "../providers/ModeProvider";
import { StreamLibrary } from "../components/studio/StreamLibrary";
import { StreamCanvas } from "../components/studio/StreamCanvas";
import { PipelineComposer } from "../components/studio/PipelineComposer";

/**
 * Studio — the architect's workbench.
 *
 * Two top-level sections, picked via sub-path:
 *  - `#studio/streams`            → Stream Library
 *  - `#studio/streams/{name}`     → Stream Canvas (edit existing)
 *  - `#studio/streams/new`        → Stream Canvas (blank)
 *  - `#studio/streams/new?template={id}` → Stream Canvas (preloaded template)
 *  - `#studio/pipeline`           → Pipeline Composer (Phase 3)
 */
export function StudioPage() {
  const { subPath, setMode } = useMode();
  const route = useMemo(() => parseSubPath(subPath), [subPath]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Studio section nav */}
      <nav className="flex shrink-0 items-center gap-1 border-b border-mm-border/40 bg-mm-surface/40 px-6">
        <SectionTab
          label="Streams"
          active={route.section === "streams"}
          onClick={() => setMode("studio", "streams")}
        />
        <SectionTab
          label="Pipeline"
          active={route.section === "pipeline"}
          onClick={() => setMode("studio", "pipeline")}
        />
      </nav>

      {route.section === "streams" && route.streamName === null && <StreamLibrary />}
      {route.section === "streams" && route.streamName !== null && (
        <StreamCanvas
          streamName={route.streamName === "new" ? null : route.streamName}
          templateId={route.templateId}
        />
      )}
      {route.section === "pipeline" && <PipelineComposer />}
    </div>
  );
}

interface ParsedRoute {
  section: "streams" | "pipeline";
  streamName: string | null;
  templateId: string | null;
}

function parseSubPath(subPath: string): ParsedRoute {
  if (!subPath || subPath === "streams") {
    return { section: "streams", streamName: null, templateId: null };
  }
  if (subPath.startsWith("pipeline")) {
    return { section: "pipeline", streamName: null, templateId: null };
  }
  if (subPath.startsWith("streams/")) {
    const rest = subPath.slice("streams/".length);
    const [name, query] = rest.split("?");
    let templateId: string | null = null;
    if (query) {
      const params = new URLSearchParams(query);
      templateId = params.get("template");
    }
    return { section: "streams", streamName: name || null, templateId };
  }
  return { section: "streams", streamName: null, templateId: null };
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

