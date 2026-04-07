import { useMode, MODE_LABELS, type ModeId } from "../../providers/ModeProvider";

const VISIBLE_MODES: ModeId[] = ["floor", "studio", "lens"];

const MODE_TITLES: Record<ModeId, string> = {
  floor: "Operator dashboard — monitor positions, investigate changes",
  studio: "Architect workbench — compose streams and pipeline",
  lens: "Auditor surface — decompose, replay, inspect",
  docs: "API documentation",
};

export function ModeSwitcher() {
  const { mode, setMode } = useMode();

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-mm-border/60 bg-mm-bg/60 p-0.5">
      {VISIBLE_MODES.map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => setMode(m)}
            title={MODE_TITLES[m]}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-mm-accent/15 text-mm-accent"
                : "text-mm-text-dim hover:bg-mm-border/30 hover:text-mm-text"
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}
