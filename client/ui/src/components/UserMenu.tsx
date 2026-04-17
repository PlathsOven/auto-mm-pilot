import { useEffect, useRef, useState } from "react";

import { useAuth } from "../providers/AuthProvider";

export function UserMenu({
  onOpenAccount,
  onOpenAdmin,
}: {
  onOpenAccount: () => void;
  onOpenAdmin: () => void;
}) {
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-black/[0.06] px-2.5 py-1 text-xs text-mm-text-dim hover:bg-black/[0.04] hover:text-mm-text"
      >
        <span className="max-w-[120px] truncate font-medium text-mm-text">
          {user.username}
        </span>
        <span className="text-[9px]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[160px] rounded-md border border-black/[0.06] bg-white py-1 text-xs shadow-md">
          <button
            onClick={() => {
              setOpen(false);
              onOpenAccount();
            }}
            className="block w-full px-3 py-1.5 text-left text-mm-text hover:bg-black/[0.04]"
          >
            Account
          </button>
          {user.is_admin && (
            <button
              onClick={() => {
                setOpen(false);
                onOpenAdmin();
              }}
              className="block w-full px-3 py-1.5 text-left text-mm-text hover:bg-black/[0.04]"
            >
              Admin
            </button>
          )}
          <div className="my-1 border-t border-black/[0.06]" />
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="block w-full px-3 py-1.5 text-left text-mm-error hover:bg-black/[0.04]"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
