"use client";

import { useEffect, useRef, useState } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { formatUtcTime } from "../utils";
import { CURRENT_USER } from "../providers/MockDataProvider";
import { useLayout, PANEL_LABELS } from "../providers/LayoutProvider";
import type { PanelType } from "../providers/LayoutProvider";

const SPACE_OPTIONS = ["D50 VOLATILITY"];

const PANEL_TYPES: PanelType[] = ["streams", "positions", "wrap", "updates", "chat"];

export function GlobalContextBar() {
  const { connectionStatus } = useWebSocket();
  const { addPanel, resetLayout } = useLayout();
  const [now, setNow] = useState(Date.now());
  const [space, setSpace] = useState(SPACE_OPTIONS[0]);
  const [aptEnabled, setAptEnabled] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 47);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  return (
    <div className="flex h-[60px] items-center justify-between border-b border-mm-border/40 bg-mm-surface/80 px-6 backdrop-blur-sm">
      {/* Logo + App Name */}
      <div className="flex items-center gap-3">
        <span className="text-base font-bold tracking-wide text-mm-accent">
          APT
        </span>
        <span className="text-[10px] text-mm-text-dim">
          Automated Positional Trader
        </span>
        <span className="text-[10px] text-mm-text-dim">
          [{connectionStatus}]
        </span>
      </div>

      <div className="flex items-center gap-6">
        {/* Operating Space (dropdown) */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-mm-text-dim">Space:</span>
          <select
            value={space}
            onChange={(e) => setSpace(e.target.value)}
            className="rounded-lg border border-mm-border/60 bg-mm-bg px-3 py-1.5 text-xs text-mm-text outline-none transition-colors focus:border-mm-accent/60 focus:ring-1 focus:ring-mm-accent/20"
          >
            {SPACE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        {/* Windows dropdown */}
        <div ref={menuRef} className="relative pl-4">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
          >
            <span>Windows</span>
            <span className="text-[8px]">{menuOpen ? "▲" : "▼"}</span>
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-50 mt-2 min-w-[180px] overflow-hidden rounded-xl border border-mm-border/60 bg-mm-surface py-1 shadow-xl shadow-black/30">
              {PANEL_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => { addPanel(type); setMenuOpen(false); }}
                  className="flex w-full items-center px-3 py-2 text-left text-xs text-mm-text transition-colors hover:bg-mm-accent/10"
                >
                  <span className="mr-2 text-[10px] text-mm-accent">+</span>
                  {PANEL_LABELS[type]}
                </button>
              ))}
              <div className="my-1 border-t border-mm-border/40" />
              <button
                onClick={() => { resetLayout(); setMenuOpen(false); }}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-mm-text-dim transition-colors hover:bg-mm-accent/10 hover:text-mm-text"
              >
                Reset Layout
              </button>
            </div>
          )}
        </div>

        {/* APT Parameter Control Toggle */}
        <div className="flex items-center gap-2 pl-4">
          <span className="text-[10px] text-mm-text-dim">APT Control:</span>
          <button
            onClick={() => setAptEnabled((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              aptEnabled ? "bg-mm-accent" : "bg-mm-border"
            }`}
            title={aptEnabled ? "APT is allowed to move parameters" : "APT parameter moves are paused"}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                aptEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </button>
          <span className={`text-[10px] font-semibold ${aptEnabled ? "text-mm-accent" : "text-mm-error"}`}>
            {aptEnabled ? "LIVE" : "PAUSED"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* System Time (UTC) */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-mm-text-dim">UTC:</span>
          <span className="text-sm tabular-nums text-mm-text">
            {formatUtcTime(now)}
          </span>
        </div>

        {/* Logged-in User */}
        <div className="flex items-center gap-2 pl-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-mm-accent/20 text-[10px] font-bold text-mm-accent">
            {CURRENT_USER.initials}
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] font-medium text-mm-text">{CURRENT_USER.name}</span>
            <span className="text-[9px] text-mm-text-dim">{CURRENT_USER.role}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
