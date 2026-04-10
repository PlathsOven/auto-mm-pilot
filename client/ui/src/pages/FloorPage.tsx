import { useMemo } from "react";
import { Responsive, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import { StreamStatusList } from "../components/floor/StreamStatusList";
import { DesiredPositionGrid } from "../components/DesiredPositionGrid";
import { UpdatesFeed } from "../components/UpdatesFeed";
import { PanelWindow } from "../components/PanelWindow";
import { useLayout, PANEL_LABELS } from "../providers/LayoutProvider";
import type { PanelType } from "../providers/LayoutProvider";

import "react-grid-layout/css/styles.css";

const PANEL_COMPONENT: Record<PanelType, React.FC> = {
  streams: StreamStatusList,
  positions: DesiredPositionGrid,
  updates: UpdatesFeed,
};

const ROW_HEIGHT = 60;

export function FloorPage() {
  const { panels, layout, removePanel, onLayoutChange } = useLayout();
  const { width, containerRef, mounted } = useContainerWidth();

  const layouts = useMemo(() => ({ lg: layout as unknown as Layout }), [layout]);

  return (
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
          margin={[6, 6] as [number, number]}
          containerPadding={[6, 6] as [number, number]}
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
  );
}
