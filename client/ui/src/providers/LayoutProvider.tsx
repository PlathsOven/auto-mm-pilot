import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { LayoutItem } from "react-grid-layout";

export type PanelType = "streams" | "positions" | "updates" | "chat" | "wrap" | "pipeline" | "blocks" | "transforms";

export interface PanelInstance {
  id: string;
  type: PanelType;
}

export const PANEL_LABELS: Record<PanelType, string> = {
  streams: "Data Streams",
  positions: "Desired Positions",
  updates: "Updates",
  chat: "Team Chat",
  wrap: "Daily Trading Wrap",
  pipeline: "Pipeline Analysis",
  blocks: "Block Configuration",
  transforms: "Transform Config",
};

const DEFAULT_SIZES: Record<PanelType, { w: number; h: number }> = {
  streams: { w: 3, h: 6 },
  positions: { w: 6, h: 6 },
  updates: { w: 3, h: 4 },
  chat: { w: 3, h: 5 },
  wrap: { w: 6, h: 4 },
  pipeline: { w: 9, h: 8 },
  blocks: { w: 12, h: 6 },
  transforms: { w: 6, h: 8 },
};

const DEFAULT_PANELS: PanelInstance[] = [
  { id: "streams-0", type: "streams" },
  { id: "positions-0", type: "positions" },
  { id: "updates-0", type: "updates" },
  { id: "chat-0", type: "chat" },
  { id: "wrap-0", type: "wrap" },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "streams-0", x: 0, y: 0, w: 3, h: 10, minW: 2, minH: 3 },
  { i: "positions-0", x: 3, y: 0, w: 6, h: 6, minW: 4, minH: 3 },
  { i: "updates-0", x: 9, y: 0, w: 3, h: 4, minW: 2, minH: 3 },
  { i: "chat-0", x: 9, y: 4, w: 3, h: 6, minW: 2, minH: 3 },
  { i: "wrap-0", x: 3, y: 6, w: 6, h: 4, minW: 3, minH: 3 },
] as LayoutItem[];

const STORAGE_KEY = "apt-layout";
const PANELS_KEY = "apt-panels";

interface LayoutContextValue {
  panels: PanelInstance[];
  layout: LayoutItem[];
  addPanel: (type: PanelType) => void;
  removePanel: (id: string) => void;
  onLayoutChange: (layout: LayoutItem[]) => void;
  resetLayout: () => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

let nextId = 1;

function loadState(): { panels: PanelInstance[]; layout: LayoutItem[] } | null {
  try {
    const p = localStorage.getItem(PANELS_KEY);
    const l = localStorage.getItem(STORAGE_KEY);
    if (p && l) return { panels: JSON.parse(p), layout: JSON.parse(l) };
  } catch { /* ignore corrupt storage */ }
  return null;
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [saved] = useState(loadState);

  const [panels, setPanels] = useState<PanelInstance[]>(
    saved ? saved.panels : DEFAULT_PANELS,
  );

  const [layout, setLayout] = useState<LayoutItem[]>(
    saved ? saved.layout : DEFAULT_LAYOUT,
  );

  useEffect(() => {
    localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [panels, layout]);

  const addPanel = useCallback((type: PanelType) => {
    const id = `${type}-${Date.now()}-${nextId++}`;
    const size = DEFAULT_SIZES[type];
    setPanels((prev) => [...prev, { id, type }]);
    setLayout((prev) => [
      ...prev,
      { i: id, x: 0, y: Infinity, w: size.w, h: size.h, minW: 2, minH: 3 } as LayoutItem,
    ]);
  }, []);

  const removePanel = useCallback((id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id));
    setLayout((prev) => prev.filter((l) => l.i !== id));
  }, []);

  const onLayoutChange = useCallback((newLayout: LayoutItem[]) => {
    setLayout(newLayout);
  }, []);

  const resetLayout = useCallback(() => {
    setPanels(DEFAULT_PANELS);
    setLayout(DEFAULT_LAYOUT);
  }, []);

  return (
    <LayoutContext.Provider value={{ panels, layout, addPanel, removePanel, onLayoutChange, resetLayout }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error("useLayout must be used within LayoutProvider");
  return ctx;
}
