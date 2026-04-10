import { useMode } from "../providers/ModeProvider";
import { AnatomyCanvas } from "../components/studio/anatomy/AnatomyCanvas";
import { BrainPage } from "./BrainPage";

/**
 * Studio — the architect's workbench.
 *
 * Two sub-tabs, picked via the hash sub-path:
 *  - `#studio` or `#studio/anatomy`   → live pipeline canvas + streams
 *  - `#studio/brain`                  → decomposition + chart + block inspector
 *
 * Anatomy also honours `?stream=<name>` to auto-open the Stream Canvas
 * drawer on that stream.
 */
export function StudioPage() {
  const { segments, setMode } = useMode();
  const first = segments[0] ?? "anatomy";
  const section: "anatomy" | "brain" = first === "brain" ? "brain" : "anatomy";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-black/[0.06] bg-white/45 px-6">
        <SectionTab
          label="Anatomy"
          active={section === "anatomy"}
          onClick={() => setMode("studio", "anatomy")}
        />
        <SectionTab
          label="Brain"
          active={section === "brain"}
          onClick={() => setMode("studio", "brain")}
        />
      </nav>

      {section === "anatomy" && <AnatomyCanvas />}
      {section === "brain" && <BrainPage />}
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
          : "border-transparent text-mm-text-dim hover:border-black/10 hover:text-mm-text"
      }`}
    >
      {label}
    </button>
  );
}
