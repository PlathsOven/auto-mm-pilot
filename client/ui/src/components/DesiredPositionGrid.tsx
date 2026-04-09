import { useState, useRef, useCallback, useEffect } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { useChat } from "../providers/ChatProvider";
import { valColor, cellBg } from "../utils";
import { useSelection } from "../providers/SelectionProvider";
import {
  VIEW_MODE_META,
  TIMEFRAME_OPTIONS,
  PRIMARY_VIEW_MODES,
  SECONDARY_VIEW_MODES,
  getCellValue,
} from "./grid-config";
import type { ViewMode, TimeframeLabel } from "./grid-config";
import type { DesiredPosition } from "../types";
import { usePositionHistory } from "../hooks/usePositionHistory";
import { StreamAttributionHoverCard } from "./floor/StreamAttributionHoverCard";

interface PendingEdit {
  key: string;
  symbol: string;
  expiry: string;
  value: string;
  aptValue: number;
}

const HOVER_DELAY_MS = 350;

export function DesiredPositionGrid() {
  const { payload } = useWebSocket();
  const { investigate } = useChat();
  const { isDimensionSelected } = useSelection();
  const positions = payload?.positions ?? [];

  const [viewMode, setViewMode] = useState<ViewMode>("position");
  const [timeframe, setTimeframe] = useState<TimeframeLabel>("Latest");
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [hoverCell, setHoverCell] = useState<{ symbol: string; expiry: string; key: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevEditKeyRef = useRef<string | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pendingEdit && inputRef.current && prevEditKeyRef.current !== pendingEdit.key) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    prevEditKeyRef.current = pendingEdit?.key ?? null;
  }, [pendingEdit]);

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

  // Cleanup hover timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const { symbols, expiries, grid, recentKeys } = usePositionHistory(positions, timeframe);

  const getDisplayValue = useCallback(
    (key: string, pos: DesiredPosition, mode: ViewMode, change: number): number => {
      if (mode === "position" && overrides.has(key)) return overrides.get(key)!;
      return getCellValue(pos, mode, change);
    },
    [overrides],
  );

  const handleDoubleClick = useCallback(
    (key: string, symbol: string, expiry: string, pos: DesiredPosition) => {
      if (viewMode !== "position") return;
      const current = overrides.has(key) ? overrides.get(key)! : pos.desiredPos;
      setPendingEdit({ key, symbol, expiry, value: String(current), aptValue: pos.desiredPos });
    },
    [viewMode, overrides],
  );

  const confirmOverride = useCallback(() => {
    if (!pendingEdit) return;
    const parsed = parseFloat(pendingEdit.value);
    if (isNaN(parsed)) { setPendingEdit(null); return; }
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(pendingEdit.key, parsed);
      return next;
    });
    setPendingEdit(null);
  }, [pendingEdit]);

  const cancelEdit = useCallback(() => setPendingEdit(null), []);

  const removeOverride = useCallback((key: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const handleMouseEnter = useCallback((symbol: string, expiry: string, key: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoverCell({ symbol, expiry, key });
    }, HOVER_DELAY_MS);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoverCell(null);
  }, []);

  const meta = VIEW_MODE_META[viewMode];
  const secondaryActive = SECONDARY_VIEW_MODES.includes(viewMode);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-mm-border/40 pb-2">
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
                      ? "rounded-md bg-mm-accent/20 text-mm-accent"
                      : "rounded-md text-mm-text-dim hover:bg-mm-border/30 hover:text-mm-text"
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          )}

          {/* Primary 4 view modes as a tab strip */}
          <div className="flex items-center gap-0.5 rounded-lg border border-mm-border/60 bg-mm-bg/60 p-0.5">
            {PRIMARY_VIEW_MODES.map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                  viewMode === m
                    ? "bg-mm-accent/15 text-mm-accent"
                    : "text-mm-text-dim hover:bg-mm-border/30 hover:text-mm-text"
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
                  ? "border-mm-accent/40 bg-mm-accent/15 text-mm-accent"
                  : "border-mm-border/60 bg-mm-bg/60 text-mm-text-dim hover:bg-mm-border/30 hover:text-mm-text"
              }`}
            >
              <span>{secondaryActive ? VIEW_MODE_META[viewMode].label : "More"}</span>
              <span className="text-[8px]">{moreOpen ? "▲" : "▼"}</span>
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-mm-border/60 bg-mm-surface py-1 shadow-xl shadow-black/30">
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
              <tr className="border-b border-mm-border/40 text-[10px] text-mm-text-dim">
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
                  className="border-b border-mm-border/20"
                >
                  <td className="px-2 py-1.5 text-[11px] font-semibold text-mm-text">
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
                        onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClick(key, symbol, exp, cell.pos); }}
                        onMouseEnter={() => handleMouseEnter(symbol, exp, key)}
                        onMouseLeave={handleMouseLeave}
                        className={`relative cursor-pointer rounded px-2 py-1.5 text-center text-[11px] tabular-nums transition-colors hover:ring-1 hover:ring-mm-accent/30 ${valColor(val)} ${isRecent ? "row-highlight" : ""} ${isDimensionSelected(symbol, exp) ? "channel-highlight-cell" : ""}`}
                        style={{ backgroundColor: cellBg(val) }}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type="text"
                            value={pendingEdit.value}
                            onChange={(e) => setPendingEdit({ ...pendingEdit, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmOverride();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded-md bg-mm-bg border border-mm-accent/60 px-1 py-0.5 text-center text-[11px] text-mm-text outline-none tabular-nums focus:ring-1 focus:ring-mm-accent/30"
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
                            className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-amber-500/30 text-[8px] font-bold text-amber-400 hover:bg-amber-500/50 transition-colors cursor-pointer"
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
              <tr className="border-t border-mm-border/40">
                <td className="px-2 py-1.5 text-[11px] font-semibold text-mm-text-dim">Total</td>
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
        onConfirm={confirmOverride}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Totals helpers
// ---------------------------------------------------------------------------

type DisplayValueFn = (key: string, pos: DesiredPosition, mode: ViewMode, change: number) => number;
type GridMap = Map<string, { pos: DesiredPosition; change: number }>;

function computeRowTotal(symbol: string, expiries: string[], grid: GridMap, getVal: DisplayValueFn, mode: ViewMode): number {
  return expiries.reduce((sum, exp) => {
    const k = `${symbol}-${exp}`;
    const cell = grid.get(k);
    return sum + (cell ? getVal(k, cell.pos, mode, cell.change) : 0);
  }, 0);
}

function computeColTotal(expiry: string, symbols: string[], grid: GridMap, getVal: DisplayValueFn, mode: ViewMode): number {
  return symbols.reduce((sum, s) => {
    const k = `${s}-${expiry}`;
    const cell = grid.get(k);
    return sum + (cell ? getVal(k, cell.pos, mode, cell.change) : 0);
  }, 0);
}

function computeGrandTotal(symbols: string[], expiries: string[], grid: GridMap, getVal: DisplayValueFn, mode: ViewMode): number {
  return symbols.reduce((sum, s) =>
    sum + expiries.reduce((acc, exp) => {
      const k = `${s}-${exp}`;
      const cell = grid.get(k);
      return acc + (cell ? getVal(k, cell.pos, mode, cell.change) : 0);
    }, 0), 0);
}

function TotalCell({ value, decimals }: { value: number; decimals: number }) {
  return (
    <td
      className={`px-2 py-1.5 text-center text-[11px] tabular-nums font-semibold ${valColor(value)}`}
      style={{ backgroundColor: cellBg(value) }}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(decimals)}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Override status bar
// ---------------------------------------------------------------------------

function OverrideStatusBar({
  pendingEdit,
  overrideCount,
  decimals,
  viewMode,
  onCancel,
  onConfirm,
}: {
  pendingEdit: PendingEdit | null;
  overrideCount: number;
  decimals: number;
  viewMode: ViewMode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      {pendingEdit && (
        <div className="mt-2 flex items-center justify-between rounded-lg border-t border-mm-border/40 bg-mm-bg/80 px-3 py-2">
          <span className="text-[10px] text-mm-text">
            Override <span className="font-semibold">{pendingEdit.symbol} {pendingEdit.expiry}</span>:
            <span className="ml-1 text-mm-text-dim">{pendingEdit.aptValue > 0 ? "+" : ""}{pendingEdit.aptValue.toFixed(decimals)}</span>
            <span className="mx-1">→</span>
            <span className="font-semibold text-amber-400">{isNaN(parseFloat(pendingEdit.value)) ? "—" : (parseFloat(pendingEdit.value) > 0 ? "+" : "") + parseFloat(pendingEdit.value).toFixed(decimals)}</span>
          </span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="rounded-md px-2 py-0.5 text-[10px] text-mm-text-dim hover:text-mm-text transition-colors">Cancel</button>
            <button onClick={onConfirm} className="rounded-md px-2 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors font-medium">Confirm</button>
          </div>
        </div>
      )}

      {overrideCount > 0 && !pendingEdit && (
        <p className="mt-1 text-[9px] text-amber-400/70">
          {overrideCount} override{overrideCount > 1 ? "s" : ""} active — double-click to edit, ✕ to undo.
        </p>
      )}

      <p className="mt-1 text-[9px] text-mm-text-dim">
        {viewMode === "position" ? "Double-click a cell to override. " : ""}Hover for stream attribution.
      </p>
    </>
  );
}
