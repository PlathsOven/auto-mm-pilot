import { useEffect, useRef, useState } from "react";

import { useAuth } from "../providers/AuthProvider";

interface UserMenuProps {
  onOpenAccount: () => void;
  onOpenAdmin: () => void;
  /** Where the dropdown opens relative to the trigger button. Defaults to
   *  bottom-right (legacy header placement). Use `top-left` when the trigger
   *  sits at the bottom-left of a sidebar — opens upward + anchors to the
   *  left edge so it doesn't fly off-screen. */
  placement?: "bottom-right" | "top-left";
  /** Render only the avatar circle (no username text). Used when the sidebar
   *  is collapsed to its icon-only width. */
  compact?: boolean;
  /** Current mode — used to highlight "Account" / "Admin" rows when the user
   *  is on those pages so the dropdown doubles as breadcrumb. */
  activeMode?: string;
}

export function UserMenu({ onOpenAccount, onOpenAdmin, placement = "bottom-right", compact = false, activeMode }: UserMenuProps) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (user === null) return null;

  const dropdownPositionClass =
    placement === "top-left"
      ? "left-0 bottom-[calc(100%+4px)]"
      : "right-0 top-[calc(100%+4px)]";

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={user.username}
        className={`flex items-center gap-1.5 rounded-md border border-black/[0.06] py-1 text-[11px] text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text ${
          compact ? "w-7 justify-center px-0" : "w-full px-2"
        }`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-mm-accent/15 text-[9px] font-bold text-mm-accent">
          {user.username.slice(0, 1).toUpperCase()}
        </span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate text-left font-medium text-mm-text">
              {user.username}
            </span>
            <span className="text-[9px] text-mm-text-subtle">▾</span>
          </>
        )}
      </button>

      {open && (
        <div className={`absolute ${dropdownPositionClass} z-50 min-w-[160px] rounded-md border border-black/[0.06] bg-white py-1 text-xs shadow-elev-2`}
          // Stop propagation so clicks inside the dropdown don't bubble to the
          // sidebar's button outside the menu and immediately re-toggle it.
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownItem
            label="Account"
            active={activeMode === "account"}
            onClick={() => { setOpen(false); onOpenAccount(); }}
          />
          {user.is_admin && (
            <DropdownItem
              label="Admin"
              active={activeMode === "admin"}
              onClick={() => { setOpen(false); onOpenAdmin(); }}
            />
          )}
          <div className="my-1 border-t border-black/[0.06]" />
          <button
            type="button"
            onClick={() => { setOpen(false); logout(); }}
            className="block w-full px-3 py-1.5 text-left text-mm-error hover:bg-black/[0.04]"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left transition-colors ${
        active
          ? "bg-mm-accent-soft font-semibold text-mm-accent"
          : "text-mm-text hover:bg-black/[0.04]"
      }`}
    >
      {label}
    </button>
  );
}
