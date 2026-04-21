import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditableBlockTable } from "../studio/brain/EditableBlockTable";
import { StreamTimeseriesPanel } from "./StreamTimeseriesPanel";
import { Tabs, type TabItem } from "../ui/Tabs";
import { useFocus } from "../../providers/FocusProvider";
import type { BlockRow } from "../../types";

type TabValue = "blocks" | "stream";

interface BlockStreamPanelProps {
  headerAction?: ReactNode;
  onRowClick?: (block: BlockRow) => void;
  onRowEdit?: (block: BlockRow) => void;
  refreshKey?: number;
  onRefresh?: () => void;
}

/**
 * Tabbed canvas panel hosting the Block Inspector and the Stream time-series
 * chart side-by-side in one slot.
 *
 * The bottom panel has much more horizontal room than the right-rail
 * Inspector, so the stream chart reads far better here. Focusing a stream in
 * the Streams list auto-switches to the Stream tab; once active, the user
 * owns the tab choice (switching to Blocks doesn't get clobbered by the next
 * focus change unless it's a fresh stream transition).
 */
export function BlockStreamPanel({
  headerAction,
  onRowClick,
  onRowEdit,
  refreshKey,
  onRefresh,
}: BlockStreamPanelProps) {
  const { focus } = useFocus();
  const [active, setActive] = useState<TabValue>("blocks");
  const prevStreamName = useRef<string | null>(null);

  // Auto-switch to the Stream tab when focus transitions TO a (new) stream.
  // `prevStreamName.current` guards against re-firing while focus is still
  // on the same stream — otherwise a user switching back to Blocks would
  // be yanked back to Stream on every re-render.
  useEffect(() => {
    const currentStream = focus?.kind === "stream" ? focus.name : null;
    if (currentStream && currentStream !== prevStreamName.current) {
      setActive("stream");
    }
    prevStreamName.current = currentStream;
  }, [focus]);

  const streamName = focus?.kind === "stream" ? focus.name : null;

  const handleRowClick = useCallback(
    (block: BlockRow) => {
      onRowClick?.(block);
    },
    [onRowClick],
  );

  const tabs = useMemo<TabItem<TabValue>[]>(
    () => [
      { value: "blocks", label: "Blocks" },
      {
        value: "stream",
        label: "Stream",
        hint: streamName ? streamName : undefined,
        title: streamName ? `Raw values for ${streamName}` : "Focus a stream to view its raw values",
      },
    ],
    [streamName],
  );

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-3 pt-2 pb-1.5">
        <Tabs items={tabs} value={active} onChange={setActive} variant="pill" size="sm" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {active === "blocks" ? (
          <EditableBlockTable
            hideTitle
            headerAction={headerAction}
            onRowClick={handleRowClick}
            onRowEdit={onRowEdit}
            refreshKey={refreshKey}
            onRefresh={onRefresh}
          />
        ) : (
          <StreamTimeseriesPanel name={streamName} />
        )}
      </div>
    </section>
  );
}
