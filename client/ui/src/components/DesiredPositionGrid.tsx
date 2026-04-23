import { useCallback, useState, useRef, useEffect } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import {
  valColor,
  cellBg,
  viewModeOf,
  metricOf,
  SMOOTHABLE_METRICS,
  safeGetItem,
  safeSetItem,
  type Metric,
  type Smoothing,
} from "../utils";
import { useFocus } from "../providers/FocusProvider";
import type { Focus, ViewMode } from "../types";
import {
  VIEW_MODE_META,
  OVERVIEW_SMOOTHING_KEY,
} from "../constants";
import { usePositionHistory } from "../hooks/usePositionHistory";
import { usePositionEdit } from "../hooks/usePositionEdit";
import { usePositionHover } from "../hooks/usePositionHover";
import { StreamAttributionHoverCard } from "./floor/StreamAttributionHoverCard";
import { MetricDropdown, SmoothingToggle } from "./ui/MetricControls";
import { Tooltip } from "./ui/Tooltip";
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
  const { metric, smoothing: derivedSmoothing } = metricOf(viewMode);
  const metricSmoothable = (SMOOTHABLE_METRICS as readonly Metric[]).includes(metric);

  // Persist whichever smoothing the user last picked explicitly, so jumping
  // to Market (Source) or Change and back restores the previous choice.
  // External viewMode changes that carry an unambiguous smoothing variant
  // (e.g. linked pipeline chart swap) override this on the next render.
  const [smoothing, setSmoothingState] = useState<Smoothing>(() => {
    const saved = safeGetItem(OVERVIEW_SMOOTHING_KEY);
    if (saved === "instant" || saved === "smoothed") return saved;
    return derivedSmoothing;
  });
  useEffect(() => {
    if (metricSmoothable && derivedSmoothing !== smoothing) {
      setSmoothingState(derivedSmoothing);
    }
  }, [derivedSmoothing, metricSmoothable, smoothing]);

  const setMetric = useCallback((m: Metric) => {
    setViewMode(viewModeOf(m, smoothing));
  }, [setViewMode, smoothing]);

  const setSmoothing = useCallback((s: Smoothing) => {
    setSmoothingState(s);
    safeSetItem(OVERVIEW_SMOOTHING_KEY, s);
    if ((SMOOTHABLE_METRICS as readonly Metric[]).includes(metric)) {
      setViewMode(viewModeOf(metric, s));
    }
  }, [metric, setViewMode]);

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

  const { symbols, expiries, grid, recentKeys } = usePositionHistory(positions);

  const meta = VIEW_MODE_META[viewMode];

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="zone-header">Overview</h2>
          {meta.unit && (
            <span className="text-[10px] text-mm-text-dim">({meta.unit})</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MetricDropdown value={metric} onChange={setMetric} />
          <SmoothingToggle
            value={smoothing}
            onChange={setSmoothing}
            disabled={!metricSmoothable}
          />
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
                  <Tooltip key={exp} label={`Focus ${exp} — filter the workspace to this expiry`} side="bottom">
                    <th
                      tabIndex={0}
                      aria-label={`Focus expiry ${exp}`}
                      onClick={() => setExpiryFocus(exp)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpiryFocus(exp);
                        }
                      }}
                      className={`cursor-pointer px-2 py-1.5 text-center font-medium transition-colors hover:text-mm-accent ${
                        isFocused({ kind: "expiry", expiry: exp }) ? "text-mm-accent" : ""
                      }`}
                    >
                      {exp}
                    </th>
                  </Tooltip>
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
                  <Tooltip label={`Focus ${symbol} — filter the workspace to this symbol`} side="right">
                    <td
                      tabIndex={0}
                      aria-label={`Focus symbol ${symbol}`}
                      onClick={() => setSymbolFocus(symbol)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSymbolFocus(symbol);
                        }
                      }}
                      className={`cursor-pointer px-2 py-1.5 text-[12px] font-medium transition-colors hover:text-mm-accent ${
                        isFocused({ kind: "symbol", symbol }) ? "text-mm-accent" : "text-mm-text"
                      }`}
                    >
                      {symbol}
                    </td>
                  </Tooltip>
                  {expiries.map((exp) => {
                    const key = `${symbol}-${exp}`;
                    const pos = grid.get(key);
                    if (!pos) return <td key={exp} />;
                    const val = getDisplayValue(key, pos, viewMode);
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
                        onDoubleClick={(e) => { e.stopPropagation(); startEdit(key, symbol, exp, pos, viewMode); }}
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
                            <span>{meta.signed && val > 0 ? "+" : ""}{val.toFixed(meta.decimals)}</span>
                            {hasOverride && (
                              <span className="ml-1 text-[8px] text-mm-text-dim line-through">
                                {meta.signed && pos.desiredPos > 0 ? "+" : ""}{pos.desiredPos.toFixed(meta.decimals)}
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
                    signed={meta.signed}
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
                    signed={meta.signed}
                  />
                ))}
                <TotalCell
                  value={computeGrandTotal(symbols, expiries, grid, getDisplayValue, viewMode)}
                  decimals={meta.decimals}
                  signed={meta.signed}
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
        signed={meta.signed}
        viewMode={viewMode}
        onCancel={cancelEdit}
        onConfirm={confirmEdit}
      />
    </div>
  );
}
