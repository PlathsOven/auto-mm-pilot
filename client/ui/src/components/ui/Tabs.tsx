import type { ReactNode } from "react";

/**
 * Reusable tab strip primitive.
 *
 * Replaces several bespoke button-strip + `<select>` patterns with one
 * consistent rendering. Caller owns the active value + change handler so the
 * primitive stays headless to the routing/state model.
 *
 * Variants:
 *  - `pill` (default) — subtle pill background with active-state indigo wash.
 *    Used by the WorkbenchRail tabs and the LlmChat mode select.
 *  - `underline` — bottom-rule active indicator. Used by the position grid's
 *    view-mode strip where the surrounding container already has chrome.
 *
 * Sizes default to compact (`px-2.5 py-1`, 11px text) — the trader UI is
 * dense by intent. Pass `size="sm"` for an even tighter variant in
 * sub-toolbars.
 */

export interface TabItem<T extends string> {
  /** Stable value passed back through onChange. */
  value: T;
  /** Visible label. */
  label: ReactNode;
  /** Optional small hint shown to the right of the label (e.g. "⌘K"). */
  hint?: ReactNode;
  /** Whether this tab is disabled — renders muted, no click. */
  disabled?: boolean;
  /** Optional title attribute for native tooltip. */
  title?: string;
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: "pill" | "underline";
  size?: "sm" | "md";
  /** Optional className for the outer container. */
  className?: string;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  variant = "pill",
  size = "md",
  className = "",
}: TabsProps<T>) {
  if (variant === "underline") {
    return (
      <div className={`flex items-center gap-3 border-b border-black/[0.06] ${className}`}>
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              disabled={item.disabled}
              onClick={() => onChange(item.value)}
              title={item.title}
              className={`relative -mb-px flex items-baseline gap-1.5 border-b-2 pb-1.5 text-[11px] font-medium transition-colors ${
                active
                  ? "border-mm-accent text-mm-accent"
                  : "border-transparent text-mm-text-dim hover:text-mm-text"
              } ${item.disabled ? "cursor-not-allowed opacity-40" : ""}`}
            >
              <span>{item.label}</span>
              {item.hint && <span className="text-[9px] text-mm-text-subtle">{item.hint}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  // pill (default)
  const padding = size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1";
  const fontSize = size === "sm" ? "text-[10px]" : "text-[11px]";

  return (
    <div className={`inline-flex items-center gap-0.5 rounded-md border border-black/[0.06] bg-black/[0.03] p-0.5 ${className}`}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            title={item.title}
            className={`flex items-baseline gap-1.5 rounded-[5px] ${padding} ${fontSize} font-medium transition-colors ${
              active
                ? "bg-white/80 text-mm-accent shadow-sm shadow-black/[0.04]"
                : "text-mm-text-dim hover:bg-white/40 hover:text-mm-text"
            } ${item.disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            <span>{item.label}</span>
            {item.hint && <span className="text-[9px] text-mm-text-subtle">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
