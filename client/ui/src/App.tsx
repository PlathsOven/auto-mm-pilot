import { useMemo, useState, useEffect, useRef } from "react";
import { Responsive, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import { IngestionSidebar } from "./components/IngestionSidebar";
import { GlobalContextBar } from "./components/GlobalContextBar";
import { DesiredPositionGrid } from "./components/DesiredPositionGrid";
import { UpdatesFeed } from "./components/UpdatesFeed";
import { LlmChat } from "./components/LlmChat";
import { DailyWrap } from "./components/DailyWrap";
import { ApiDocs } from "./components/ApiDocs";
import { PanelWindow } from "./components/PanelWindow";
import { useLayout, PANEL_LABELS } from "./providers/LayoutProvider";
import type { PanelType } from "./providers/LayoutProvider";

import "react-grid-layout/css/styles.css";

export type AppPage = "dashboard" | "apidocs";

const PANEL_COMPONENT: Record<PanelType, React.FC> = {
  streams: IngestionSidebar,
  positions: DesiredPositionGrid,
  updates: UpdatesFeed,
  chat: LlmChat,
  wrap: DailyWrap,
};

const FALLBACK_ROW_HEIGHT = 60;
const MARGIN_Y = 1;

export default function App() {
  const [page, setPage] = useState<AppPage>("dashboard");
  const { panels, layout, removePanel, onLayoutChange } = useLayout();
  const { width, containerRef, mounted } = useContainerWidth();
  const [containerHeight, setContainerHeight] = useState(0);
  const heightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = heightRef.current;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => setContainerHeight(entry.contentRect.height));
    ro.observe(node);
    return () => ro.disconnect();
  }, [mounted]);

  const maxRow = useMemo(
    () => layout.reduce((max, item) => Math.max(max, item.y + item.h), 0) || 1,
    [layout],
  );

  const rowHeight = containerHeight > 0
    ? (containerHeight - (maxRow - 1) * MARGIN_Y) / maxRow
    : FALLBACK_ROW_HEIGHT;

  const layouts = useMemo(() => ({ lg: layout as unknown as Layout }), [layout]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-mm-bg-deep">
      <header className="relative z-50 shrink-0">
        <GlobalContextBar page={page} setPage={setPage} />
      </header>

      {page === "apidocs" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ApiDocs />
        </div>
      ) : (
        <div
          ref={(node) => {
            (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            heightRef.current = node;
          }}
          className="min-h-0 flex-1 overflow-hidden"
        >
          {mounted && (
            <Responsive
              className="layout"
              width={width}
              layouts={layouts}
              breakpoints={{ lg: 0 }}
              cols={{ lg: 12 }}
              rowHeight={rowHeight}
              dragConfig={{ handle: ".panel-drag-handle" }}
              compactor={verticalCompactor}
              onLayoutChange={(current: Layout) => onLayoutChange([...current] as LayoutItem[])}
              margin={[1, 1] as [number, number]}
              containerPadding={[0, 0] as [number, number]}
            >
              {panels.map((panel) => {
                const Component = PANEL_COMPONENT[panel.type];
                return (
                  <div key={panel.id}>
                    <PanelWindow
                      title={PANEL_LABELS[panel.type]}
                      onClose={() => removePanel(panel.id)}
                    >
                      <Component />
                    </PanelWindow>
                  </div>
                );
              })}
            </Responsive>
          )}
        </div>
      )}
    </div>
  );
}
