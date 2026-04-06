import { useMemo, useState } from "react";
import { Responsive, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import { IngestionSidebar } from "./components/IngestionSidebar";
import { GlobalContextBar } from "./components/GlobalContextBar";
import { DesiredPositionGrid } from "./components/DesiredPositionGrid";
import { UpdatesFeed } from "./components/UpdatesFeed";
import { LlmChat } from "./components/LlmChat";
import { DailyWrap } from "./components/DailyWrap";
import { PipelineChart } from "./components/PipelineChart";
import { BlockTable } from "./components/BlockTable";
import { TransformConfigPanel } from "./components/TransformConfigPanel";
import { ApiDocs } from "./components/ApiDocs";
import { PanelWindow } from "./components/PanelWindow";
import { useLayout, PANEL_LABELS } from "./providers/LayoutProvider";
import type { PanelType } from "./providers/LayoutProvider";
import type { AppPage } from "./types";

import "react-grid-layout/css/styles.css";

const PANEL_COMPONENT: Record<PanelType, React.FC> = {
  streams: IngestionSidebar,
  positions: DesiredPositionGrid,
  updates: UpdatesFeed,
  chat: LlmChat,
  wrap: DailyWrap,
  pipeline: PipelineChart,
  blocks: BlockTable,
  transforms: TransformConfigPanel,
};

const ROW_HEIGHT = 60;

export default function App() {
  const [page, setPage] = useState<AppPage>("dashboard");
  const { panels, layout, removePanel, onLayoutChange } = useLayout();
  const { width, containerRef, mounted } = useContainerWidth();

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
          ref={containerRef as React.RefObject<HTMLDivElement>}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {mounted && (
            <Responsive
              className="layout"
              width={width}
              layouts={layouts}
              breakpoints={{ lg: 0 }}
              cols={{ lg: 12 }}
              rowHeight={ROW_HEIGHT}
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
