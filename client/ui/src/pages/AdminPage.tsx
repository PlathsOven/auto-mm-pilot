import { useEffect, useState } from "react";

import { listUsers } from "../services/adminApi";
import type { AdminUserSummary } from "../types";

function fmtDate(raw: string | null): string {
  if (!raw) return "—";
  return new Date(raw).toLocaleString();
}

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function AdminPage({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listUsers()
      .then((resp) => setUsers(resp.users))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load users."),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-mm-bg p-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-mm-text">Admin — Users</h1>
          <button
            onClick={onClose}
            className="rounded-md border border-black/[0.06] px-3 py-1 text-xs text-mm-text-dim hover:bg-black/[0.04]"
          >
            Close
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-mm-text-dim">Loading…</p>
        ) : error ? (
          <p className="rounded-md bg-mm-error/10 px-3 py-2 text-sm text-mm-error">{error}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-black/[0.06] bg-white">
            <table className="w-full text-xs">
              <thead className="border-b border-black/[0.06] bg-black/[0.02] text-[10px] uppercase tracking-wide text-mm-text-dim">
                <tr>
                  <th className="px-3 py-2 text-left">Username</th>
                  <th className="px-3 py-2 text-left">Signed up</th>
                  <th className="px-3 py-2 text-left">Last login</th>
                  <th className="px-3 py-2 text-right">Active WS</th>
                  <th className="px-3 py-2 text-right">Manual blocks</th>
                  <th className="px-3 py-2 text-right">Sessions</th>
                  <th className="px-3 py-2 text-right">Time on app</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-black/[0.04]">
                    <td className="px-3 py-2 text-mm-text">{u.username}</td>
                    <td className="px-3 py-2 text-mm-text-dim">{fmtDate(u.created_at)}</td>
                    <td className="px-3 py-2 text-mm-text-dim">{fmtDate(u.last_login_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-mm-text">
                      {u.active_ws_connections}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-mm-text">
                      {u.manual_block_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-mm-text">
                      {u.total_sessions}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-mm-text-dim">
                      {fmtDuration(u.total_time_seconds)}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-mm-text-dim">
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
