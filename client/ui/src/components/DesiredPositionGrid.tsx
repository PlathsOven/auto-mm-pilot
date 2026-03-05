import { useMemo, useState, useRef, useCallback } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { useChat } from "../providers/ChatProvider";
import { useLayout } from "../providers/LayoutProvider";
import { valColor, cellBg } from "../utils";
import { getCellNotes } from "../providers/MockDataProvider";
import type { DesiredPosition } from "../types";

type ViewMode = "position" | "change" | "edge" | "uncertainty" | "currentPos" | "desiredDiff" | "marketIV" | "fairIV" | "edgeVP";

const VIEW_MODE_META: Record<ViewMode, { label: string; unit: string; decimals: number }> = {
  position: { label: "Desired Position", unit: "$vega", decimals: 2 },
  currentPos: { label: "Current Position", unit: "$vega", decimals: 2 },
  desiredDiff: { label: "Desired Difference", unit: "$vega", decimals: 2 },
  change: { label: "Change", unit: "$vega", decimals: 2 },
  marketIV: { label: "Market Implied Vol", unit: "vp", decimals: 2 },
  fairIV: { label: "Fair Implied Vol", unit: "vp", decimals: 2 },
  edgeVP: { label: "Edge (Fair − Market)", unit: "vp", decimals: 2 },
  edge: { label: "Edge (signal)", unit: "vp", decimals: 4 },
  uncertainty: { label: "Uncertainty Factor", unit: "", decimals: 4 },
};

const TIMEFRAME_OPTIONS = [
  { label: "Latest", ms: 0 },
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 300_000 },
  { label: "15 min", ms: 900_000 },
] as const;
type TimeframeLabel = (typeof TIMEFRAME_OPTIONS)[number]["label"];

const HIGHLIGHT_DURATION_MS = 2000;

interface HistoryEntry {
  value: number;
  timestamp: number;
}

function getCellValue(p: DesiredPosition, mode: ViewMode, change: number): number {
  switch (mode) {
    case "position": return p.desiredPos;
    case "currentPos": return p.currentPos;
    case "desiredDiff": return +(p.desiredPos - p.currentPos).toFixed(2);
    case "change": return change;
    case "marketIV": return p.marketIV;
    case "fairIV": return p.fairIV;
    case "edgeVP": return +(p.fairIV - p.marketIV).toFixed(2);
    case "edge": return p.edge;
    case "uncertainty": return p.uncertaintyFactor;
  }
}

export function DesiredPositionGrid() {
  const { payload } = useWebSocket();
  const { investigate, openNoteThread } = useChat();
  const { panels, addPanel } = useLayout();
  const positions = payload?.positions ?? [];

  const [viewMode, setViewMode] = useState<ViewMode>("position");
  const [timeframe, setTimeframe] = useState<TimeframeLabel>("Latest");

  const historyRef = useRef<Map<string, HistoryEntry[]>>(new Map());

  const noteCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of getCellNotes()) {
      map.set(n.cellKey, (map.get(n.cellKey) ?? 0) + 1);
    }
    return map;
  }, [positions]);

  const handleNoteBadgeClick = useCallback((e: React.MouseEvent, cellKey: string) => {
    e.stopPropagation();
    e.preventDefault();
    openNoteThread(cellKey);
    if (!panels.some((p) => p.type === "chat")) addPanel("chat");
  }, [openNoteThread, panels, addPanel]);

  const { assets, expiries, grid, recentKeys } = useMemo(() => {
    const now = Date.now();
    const assetSet = new Set<string>();
    const expirySet = new Set<string>();
    const gridMap = new Map<string, { pos: DesiredPosition; change: number }>();
    const recent = new Set<string>();

    for (const p of positions) {
      assetSet.add(p.asset);
      expirySet.add(p.expiry);
      const key = `${p.asset}-${p.expiry}`;

      const history = historyRef.current.get(key) ?? [];
      history.push({ value: p.desiredPos, timestamp: now });
      if (history.length > 500) history.splice(0, history.length - 500);
      historyRef.current.set(key, history);

      let change = p.changeMagnitude;
      const tfOption = TIMEFRAME_OPTIONS.find((t) => t.label === timeframe);
      if (tfOption && tfOption.ms > 0) {
        const cutoff = now - tfOption.ms;
        const baseline = history.find((h) => h.timestamp >= cutoff);
        if (baseline) {
          change = +(p.desiredPos - baseline.value).toFixed(3);
        }
      }

      gridMap.set(key, { pos: p, change });

      if (now - p.updatedAt < HIGHLIGHT_DURATION_MS) {
        recent.add(key);
      }
    }

    return {
      assets: Array.from(assetSet).sort(),
      expiries: Array.from(expirySet),
      grid: gridMap,
      recentKeys: recent,
    };
  }, [positions, timeframe]);

  const meta = VIEW_MODE_META[viewMode];

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-mm-border pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">Desired Positions</h2>
          {meta.unit && (
            <span className="text-[10px] text-mm-text-dim">({meta.unit})</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {viewMode === "change" && (
            <div className="flex items-center gap-1">
              {TIMEFRAME_OPTIONS.map((tf) => (
                <button
                  key={tf.label}
                  onClick={() => setTimeframe(tf.label)}
                  className={`px-2 py-0.5 text-[10px] transition-colors ${
                    timeframe === tf.label
                      ? "bg-mm-accent/20 text-mm-accent"
                      : "text-mm-text-dim hover:text-mm-text"
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          )}
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
            className="border border-mm-border bg-mm-bg px-2 py-1 text-[10px] text-mm-text outline-none focus:border-mm-accent"
          >
            {Object.entries(VIEW_MODE_META).map(([key, m]) => (
              <option key={key} value={key}>
                {m.label}{m.unit ? ` (${m.unit})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {positions.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-mm-text-dim">
            Awaiting engine output...
          </p>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-mm-border text-[10px] text-mm-text-dim">
                <th className="px-2 py-1.5 text-left font-medium" />
                {expiries.map((exp) => (
                  <th
                    key={exp}
                    className="px-2 py-1.5 text-center font-medium"
                  >
                    {exp}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-center font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr
                  key={asset}
                  className="border-b border-mm-border/40"
                >
                  <td className="px-2 py-1.5 text-[11px] font-semibold text-mm-text">
                    {asset}
                  </td>
                  {expiries.map((exp) => {
                    const key = `${asset}-${exp}`;
                    const cell = grid.get(key);
                    if (!cell) return <td key={exp} />;
                    const val = getCellValue(cell.pos, viewMode, cell.change);
                    const isRecent = recentKeys.has(key);

                    const noteCount = noteCountMap.get(key) ?? 0;

                    return (
                      <td
                        key={exp}
                        onClick={() => investigate({ type: "position", asset, expiry: exp, position: cell.pos })}
                        className={`relative cursor-pointer px-2 py-1.5 text-center text-[11px] tabular-nums transition-colors hover:ring-1 hover:ring-mm-accent/40 ${valColor(val)} ${isRecent ? "row-highlight" : ""}`}
                        style={{ backgroundColor: cellBg(val) }}
                      >
                        {val > 0 ? "+" : ""}
                        {val.toFixed(meta.decimals)}
                        {noteCount > 0 && (
                          <button
                            onClick={(e) => handleNoteBadgeClick(e, key)}
                            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center bg-mm-accent/30 text-[7px] font-bold text-mm-accent hover:bg-mm-accent/50 transition-colors cursor-pointer"
                            title={`${noteCount} note${noteCount > 1 ? "s" : ""} — click to view`}
                          >
                            {noteCount}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  {(() => {
                    const rowTotal = expiries.reduce((sum, exp) => {
                      const cell = grid.get(`${asset}-${exp}`);
                      return sum + (cell ? getCellValue(cell.pos, viewMode, cell.change) : 0);
                    }, 0);
                    return (
                      <td
                        className={`px-2 py-1.5 text-center text-[11px] tabular-nums font-semibold ${valColor(rowTotal)}`}
                        style={{ backgroundColor: cellBg(rowTotal) }}
                      >
                        {rowTotal > 0 ? "+" : ""}
                        {rowTotal.toFixed(meta.decimals)}
                      </td>
                    );
                  })()}
                </tr>
              ))}
              <tr className="border-t border-mm-border">
                <td className="px-2 py-1.5 text-[11px] font-semibold text-mm-text-dim">Total</td>
                {expiries.map((exp) => {
                  const colTotal = assets.reduce((sum, a) => {
                    const cell = grid.get(`${a}-${exp}`);
                    return sum + (cell ? getCellValue(cell.pos, viewMode, cell.change) : 0);
                  }, 0);
                  return (
                    <td
                      key={exp}
                      className={`px-2 py-1.5 text-center text-[11px] tabular-nums font-semibold ${valColor(colTotal)}`}
                      style={{ backgroundColor: cellBg(colTotal) }}
                    >
                      {colTotal > 0 ? "+" : ""}
                      {colTotal.toFixed(meta.decimals)}
                    </td>
                  );
                })}
                {(() => {
                  const grandTotal = assets.reduce((sum, a) =>
                    sum + expiries.reduce((s, exp) => {
                      const cell = grid.get(`${a}-${exp}`);
                      return s + (cell ? getCellValue(cell.pos, viewMode, cell.change) : 0);
                    }, 0), 0);
                  return (
                    <td
                      className={`px-2 py-1.5 text-center text-[11px] tabular-nums font-semibold ${valColor(grandTotal)}`}
                      style={{ backgroundColor: cellBg(grandTotal) }}
                    >
                      {grandTotal > 0 ? "+" : ""}
                      {grandTotal.toFixed(meta.decimals)}
                    </td>
                  );
                })()}
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-1 text-[9px] text-mm-text-dim">
        Click the badge to view/add notes in Team Chat.
      </p>
    </div>
  );
}
