import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { valColor, cellBg } from "../utils";
import { useFocus } from "../providers/FocusProvider";
import { Tabs, type TabItem } from "./ui/Tabs";
import type { Focus } from "../types";
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

interface DesiredPositionGridProps {
  /** Controlled view mode — when supplied, the grid lifts state to the
   *  parent so other surfaces (e.g. PipelineChartPanel) can mirror it. */
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

export function DesiredPositionGrid({ viewMode: controlledViewMode, onViewModeChange }: DesiredPositionGridProps = {}) {
  const { payload } = useWebSocket();
  const { focus, toggleFocus, isFocused } = useFocus();
  const positions = payload?.positions ?? [];

  const setCellFocus = useCallback(
    (symbol: string, expiry: string) => {
      toggleFocus({ kind: "cell", symbol, expiry });
    },
    [toggleFocus],
  );

  const setSymbolFocus = useCallback(
    (symbol: string) => {
      toggleFocus({ kind: "symbol", symbol });
    },
    [toggleFocus],
  );

  const setExpiryFocus = useCallback(
    (expiry: string) => {
      toggleFocus({ kind: "expiry", expiry });
    },
    [toggleFocus],
  );

  /** Highlight any cell whose symbol or expiry matches the current focus. */
  const isCellChannelled = useCallback(
    (symbol: string, expiry: string): boolean => {
      const focusVal: Focus | null = focus;
      if (!focusVal) return false;
      switch (focusVal.kind) {
        case "cell": return focusVal.symbol === symbol && focusVal.expiry === expiry;
        case "symbol": return focusVal.symbol === symbol;
        case "expiry": return focusVal.expiry === expiry;
        default: return false;
      }
    },
    [focus],
  );

  const [internalViewMode, setInternalViewMode] = useState<ViewMode>("position");
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = useCallback(
    (m: ViewMode) => {
      setInternalViewMode(m);
      onViewModeChange?.(m);
    },
    [onViewModeChange],
  );
  const [timeframe, setTimeframe] = useState<TimeframeLabel>("Latest");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const {
    pendingEdit, setPendingEdit, overrides, inputRef,
    startEdit, confirmEdit, cancelEdit, removeOverride,
    getDisplayValue,
  } = usePositionEdit();

  const { hoverCell, onMouseEnter, onMouseLeave } = usePositionHover();
  // Capture the hovered cell's bounding rect so the portal-rendered
  // hover-card can position itself relative to it (the card lives in
  // document.body to escape the position-grid's overflow-auto clip).
  const hoverCellRectRef = useRef<DOMRect | null>(null);

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

  const primaryTabs = useMemo<TabItem<ViewMode>[]>(
    () => PRIMARY_VIEW_MODES.map((m) => ({ value: m, label: VIEW_MODE_META[m].label })),
    [],
  );

  const timeframeTabs = useMemo<TabItem<TimeframeLabel>[]>(
    () => TIMEFRAME_OPTIONS.map((tf) => ({ value: tf.label, label: tf.label })),
    [],
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">Desired Positions</h2>
          {meta.unit && (
            <span className="text-[10px] text-mm-text-dim">({meta.unit})</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewMode === "change" && (
            <Tabs
              items={timeframeTabs}
              value={timeframe}
              onChange={setTimeframe}
              variant="pill"
              size="sm"
            />
          )}

          {/* Primary 4 view modes as a tab strip */}
          <Tabs
            items={primaryTabs}
            value={PRIMARY_VIEW_MODES.includes(viewMode) ? viewMode : "position"}
            onChange={setViewMode}
            variant="pill"
            size="sm"
          />

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

      <div className="min-h-0 flex-1 overflow-auto">
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
                    onClick={() => setExpiryFocus(exp)}
                    className={`cursor-pointer px-2 py-1.5 text-center font-medium transition-colors hover:text-mm-accent ${
                      isFocused({ kind: "expiry", expiry: exp }) ? "text-mm-accent" : ""
                    }`}
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
                  <td
                    onClick={() => setSymbolFocus(symbol)}
                    className={`cursor-pointer px-2 py-1.5 text-[12px] font-medium transition-colors hover:text-mm-accent ${
                      isFocused({ kind: "symbol", symbol }) ? "text-mm-accent" : "text-mm-text"
                    }`}
                  >
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
                    const channelled = isCellChannelled(symbol, exp);

                    return (
                      <td
                        key={exp}
                        ref={(el) => { if (showHover && el) hoverCellRectRef.current = el.getBoundingClientRect(); }}
                        onClick={() => setCellFocus(symbol, exp)}
                        onDoubleClick={(e) => { e.stopPropagation(); startEdit(key, symbol, exp, cell.pos, viewMode); }}
                        onMouseEnter={(e) => { hoverCellRectRef.current = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMouseEnter(symbol, exp, key); }}
                        onMouseLeave={onMouseLeave}
                        className={`relative cursor-pointer rounded-md px-2 py-1.5 text-center text-[12px] font-medium tabular-nums transition-colors ${valColor(val)} ${isRecent ? "row-highlight" : ""} ${channelled ? "channel-highlight-cell" : "hover:bg-white/80 hover:ring-1 hover:ring-mm-accent/20"}`}
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
                          <StreamAttributionHoverCard
                            symbol={symbol}
                            expiry={exp}
                            anchorRect={hoverCellRectRef.current}
                          />
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
                <td className="px-2 py-1.5 text-[11px] font-medium text-mm-text-dim">Total</td>
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
