import { AnimatePresence, motion } from "framer-motion";

interface HotkeyCheatsheetProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutRow {
  keys: string[];
  label: string;
}

const ROWS: { group: string; rows: ShortcutRow[] }[] = [
  {
    group: "Navigation",
    rows: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["g", "c"], label: "Jump focus to Chat" },
      { keys: ["g", "s"], label: "Jump focus to Streams" },
      { keys: ["g", "b"], label: "Jump focus to Blocks" },
      { keys: ["g", "p"], label: "Jump focus to Positions" },
    ],
  },
  {
    group: "Workbench",
    rows: [
      { keys: ["["], label: "Collapse / expand right rail" },
      { keys: ["]"], label: "Collapse / expand right rail" },
      { keys: ["⌘", "/"], label: "Toggle Posit Chat" },
      { keys: ["Esc"], label: "Clear focus / close overlay" },
      { keys: ["?"], label: "Show this cheatsheet" },
    ],
  },
];

export function HotkeyCheatsheet({ open, onClose }: HotkeyCheatsheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="cheatsheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed inset-0 z-[200] bg-black/30"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="cheatsheet"
            initial={{ opacity: 0, scale: 0.98, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 z-[201] w-[480px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/50 bg-white/85 shadow-2xl shadow-black/15 ring-1 ring-black/[0.06] backdrop-blur-glass32"
          >
            <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-2">
              <span className="zone-header">Keyboard shortcuts</span>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
              {ROWS.map((group) => (
                <section key={group.group} className="mb-4 last:mb-0">
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
                    {group.group}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {group.rows.map((row) => (
                      <li key={row.label} className="flex items-center justify-between text-[11px]">
                        <span className="text-mm-text">{row.label}</span>
                        <span className="flex items-center gap-1">
                          {row.keys.map((k, i) => (
                            <kbd
                              key={i}
                              className="rounded border border-black/[0.08] bg-black/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-mm-text"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="border-t border-black/[0.06] bg-black/[0.02] px-4 py-1.5 text-[9px] text-mm-text-dim">
              Shortcuts are disabled while typing in inputs.
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
