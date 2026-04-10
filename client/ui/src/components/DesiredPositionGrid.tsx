import { useState, useRef, useEffect } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { useChat } from "../providers/ChatProvider";
import { valColor, cellBg } from "../utils";
import { useSelection } from "../providers/SelectionProvider";
import {
  VIEW_MODE_META,
  TIMEFRAME_OPTIONS,
  PRIMARY_VIEW_MODES,
  SECONDARY_VIEW_MODES,
  type ViewMode,
  type TimeframeLabel,
} from "./grid-config";
import { usePositionHistory } from "../hooks/usePositionHistory";
import { usePositionEdit } from "../hooks/usePositionEdit";
import { usePositionHover } from "../hooks/usePositionHover";
import { StreamAttributionHoverCard } from "./floor/StreamAttributionHoverCard";
import {
  computeRowTotal,
  computeColTotal,
  computeGrandTotal,
  TotalCell,
  OverrideStatusBar,
} from "./grid-helpers";

export function DesiredPositionGrid() {
  const { payload } = useWebSocket();
  const { investigate } = useChat();
  const { isDimensionSelected } = useSelection();
  const positions = payload?.positions ?? [];

  const [viewMode, setViewMode] = useState<ViewMode>("position");
  const [timeframe, setTimeframe] = useState<TimeframeLabel>("Latest");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const {
    pendingEdit, setPendingEdit, overrides, inputRef,
    startEdit, confirmEdit, cancelEdit, removeOverride,
    getDisplayValue,
  } = usePositionEdit();

  const { hoverCell, onMouseEnter, onMouseLeave } = usePositionHover();

  // Cancel pending edit when timeframe changes
  useEffect(() => cancelEdit(), [timeframe, cancelEdit]);

  // Close "More" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  const { symbols, expiries, grid, recentKeys } = usePositionHistory(positions, timeframe);

  const meta = VIEW_MODE_META[viewMode];
  const secondaryActive = SECONDARY_VIEW_MODES.includes(viewMode);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-black/[0.06] pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">Desired Positions</h2>
          {meta.unit && (
            <span className="text-[10px] text-mm-text-dim">({meta.unit})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {viewMode === "change" && (
            <div className="flex items-center gap-1">
              {TIMEFRAME_OPTIONS.map((tf) => (
                <button
                  key={tf.label}
                  onClick={() => setTimeframe(tf.label)}
                  className={`px-2 py-0.5 text-[10px] transition-colors ${
                    timeframe === tf.label
                      ? "rounded-md bg-mm-accent/10 text-mm-accent"
                      : "rounded-md text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          )}

          {/* Primary 4 view modes as a tab strip */}
          <div className="flex items-center gap-0.5 rounded-lg border border-black/[0.06] bg-black/[0.03] p-0.5">
            {PRIMARY_VIEW_MODES.map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                  viewMode === m
                    ? "bg-mm-accent/10 text-mm-accent"
                    : "text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
                }`}
              >
                {VIEW_MODE_META[m].label}
              </button>
            ))}
          </div>

          {/* "More" dropdown for secondary modes */}
          <div ref={moreMenuRef} className="relative">
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors ${
                secondaryActive
                  ? "border-mm-accent/30 bg-mm-accent/10 text-mm-accent"
                  : "border-black/[0.06] bg-black/[0.03] text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
              }`}
            >
              <span>{secondaryActive ? VIEW_MODE_META[viewMode].label : "More"}</span>
              <span className="text-[8px]">{moreOpen ? "\u25B2" : "\u25BC"}</span>
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-black/[0.06] bg-mm-surface-solid py-1 shadow-lg shadow-black/[0.08]">
                {SECONDARY_VIEW_MODES.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setViewMode(m); setMoreOpen(false); }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] transition-colors hover:bg-mm-accent/10 ${
                      viewMode === m ? "text-mm-accent" : "text-mm-text"
                    }`}
                  >
                    <span>{VIEW_MODE_META[m].label}</span>
                    {VIEW_MODE_META[m].unit && (
                      <span className="text-[9px] text-mm-text-dim">{VIEW_MODE_META[m].unit}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
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
              <tr className="border-b border-black/[0.06] text-[10px] text-mm-text-subtle">
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
              {symbols.map((symbol) => (
                <tr
                  key={symbol}
                  className="border-b border-black/[0.04]"
                >
                  <td className="px-3 py-2.5 text-[12px] font-medium text-mm-text">
                    {symbol}
                  </td>
                  {expiries.map((exp) => {
                    const key = `${symbol}-${exp}`;
                    const cell = grid.get(key);
                    if (!cell) return <td key={exp} />;
                    const val = getDisplayValue(key, cell.pos, viewMode, cell.change);
                    const isRecent = recentKeys.has(key);
                    const isEditing = pendingEdit?.key === key;
                    const hasOverride = viewMode === "position" && overrides.has(key);
                    const showHover = hoverCell?.key === key && !isEditing;

                    return (
                      <td
                        key={exp}
                        onClick={() => investigate({ type: "position", symbol, expiry: exp, position: cell.pos })}
                        onDoubleClick={(e) => { e.stopPropagation(); startEdit(key, symbol, exp, cell.pos, viewMode); }}
                        onMouseEnter={() => onMouseEnter(symbol, exp, key)}
                        onMouseLeave={onMouseLeave}
                        className={`relative cursor-pointer rounded-md px-3 py-2.5 text-center text-[12px] font-medium tabular-nums transition-colors hover:bg-white/80 hover:ring-1 hover:ring-mm-accent/20 ${valColor(val)} ${isRecent ? "row-highlight" : ""} ${isDimensionSelected(symbol, exp) ? "channel-highlight-cell" : ""}`}
                        style={{ backgroundColor: cellBg(val) }}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type="text"
                            value={pendingEdit.value}
                            onChange={(e) => setPendingEdit({ ...pendingEdit, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded-md border border-mm-accent/30 bg-mm-surface-solid px-1 py-0.5 text-center text-[12px] text-mm-text outline-none tabular-nums focus:ring-1 focus:ring-mm-accent/20"
                          />
                        ) : (
                          <>
                            <span>{val > 0 ? "+" : ""}{val.toFixed(meta.decimals)}</span>
                            {hasOverride && (
                              <span className="ml-1 text-[8px] text-mm-text-dim line-through">
                                {cell.pos.desiredPos > 0 ? "+" : ""}{cell.pos.desiredPos.toFixed(meta.decimals)}
                              </span>
                            )}
                          </>
                        )}
                        {hasOverride && !isEditing && (
                          <button
                            onClick={(e) => { e.stopPropagation(); removeOverride(key); }}
                            className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-mm-warn/15 text-[8px] font-bold text-mm-warn hover:bg-mm-warn/25 transition-colors cursor-pointer"
                            title="Undo override"
                          >
                            ✕
                          </button>
                        )}
                        {showHover && (
                          <StreamAttributionHoverCard symbol={symbol} expiry={exp} />
                        )}
                      </td>
                    );
                  })}
                  <TotalCell
                    value={computeRowTotal(symbol, expiries, grid, getDisplayValue, viewMode)}
                    decimals={meta.decimals}
                  />
                </tr>
              ))}
              <tr className="border-t border-black/[0.06]">
                <td className="px-3 py-2.5 text-[11px] font-medium text-mm-text-dim">Total</td>
                {expiries.map((exp) => (
                  <TotalCell
                    key={exp}
                    value={computeColTotal(exp, symbols, grid, getDisplayValue, viewMode)}
                    decimals={meta.decimals}
                  />
                ))}
                <TotalCell
                  value={computeGrandTotal(symbols, expiries, grid, getDisplayValue, viewMode)}
                  decimals={meta.decimals}
                />
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <OverrideStatusBar
        pendingEdit={pendingEdit}
        overrideCount={overrides.size}
        decimals={meta.decimals}
        viewMode={viewMode}
        onCancel={cancelEdit}
        onConfirm={confirmEdit}
      />
    </div>
  );
}
