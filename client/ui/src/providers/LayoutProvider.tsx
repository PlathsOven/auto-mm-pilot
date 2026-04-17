import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { LayoutItem } from "react-grid-layout";
import { migrateLegacyStorageKey } from "../utils";

export type PanelType = "streams" | "positions" | "updates";

export interface PanelInstance {
  id: string;
  type: PanelType;
}

export const PANEL_LABELS: Record<PanelType, string> = {
  streams: "Data Streams",
  positions: "Desired Positions",
  updates: "Updates",
};

const DEFAULT_SIZES: Record<PanelType, { w: number; h: number }> = {
  streams: { w: 2, h: 6 },
  positions: { w: 7, h: 6 },
  updates: { w: 3, h: 4 },
};

const DEFAULT_PANELS: PanelInstance[] = [
  { id: "streams-0", type: "streams" },
  { id: "positions-0", type: "positions" },
  { id: "updates-0", type: "updates" },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "streams-0", x: 0, y: 0, w: 2, h: 10, minW: 2, minH: 3 },
  { i: "positions-0", x: 2, y: 0, w: 7, h: 10, minW: 4, minH: 3 },
  { i: "updates-0", x: 9, y: 0, w: 3, h: 10, minW: 2, minH: 3 },
] as LayoutItem[];

const STORAGE_KEY = "posit-layout";
const PANELS_KEY = "posit-panels";
const LEGACY_STORAGE_KEY = "apt-layout";
const LEGACY_PANELS_KEY = "apt-panels";


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

const VALID_PANEL_TYPES = new Set<PanelType>([
  "streams",
  "positions",
  "updates",
]);

function loadState(): { panels: PanelInstance[]; layout: LayoutItem[] } | null {
  migrateLegacyStorageKey(LEGACY_PANELS_KEY, PANELS_KEY);
  migrateLegacyStorageKey(LEGACY_STORAGE_KEY, STORAGE_KEY);
  try {
    const p = localStorage.getItem(PANELS_KEY);
    const l = localStorage.getItem(STORAGE_KEY);
    if (!p || !l) return null;
    const rawPanels = JSON.parse(p) as PanelInstance[];
    const rawLayout = JSON.parse(l) as LayoutItem[];
    // Filter out panels whose type is no longer supported (legacy chat/blocks/transforms).
    const panels = rawPanels.filter((panel) => VALID_PANEL_TYPES.has(panel.type));
    const validIds = new Set(panels.map((p) => p.id));
    const layout = rawLayout.filter((item) => validIds.has(item.i));
    return { panels, layout };
  } catch {
    return null;
  }
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
