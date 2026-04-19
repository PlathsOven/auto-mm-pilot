import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../providers/AuthProvider";
import { getApiKey, regenerateApiKey } from "../services/authApi";

export function AccountPage() {
  const { user } = useAuth();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const loadKey = useCallback(async () => {
    try {
      const resp = await getApiKey();
      setApiKey(resp.api_key);
    } catch {
      setApiKey(null);
    }
  }, []);

  useEffect(() => {
    loadKey();
  }, [loadKey]);

  async function onRegenerate() {
    setRegenerating(true);
    try {
      const resp = await regenerateApiKey();
      setApiKey(resp.api_key);
      setRevealed(true);
    } finally {
      setRegenerating(false);
      setConfirming(false);
    }
  }

  async function onCopy() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopyNotice("Copied to clipboard.");
      setTimeout(() => setCopyNotice(null), 2000);
    } catch {
      setCopyNotice("Copy failed. Select + copy manually.");
    }
  }

  if (user === null) return null;
  const signupDate = new Date(user.created_at).toLocaleDateString();

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-mm-bg p-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-mm-text">Account</h1>
          <p className="mt-1 text-[11px] text-mm-text-dim">
            Click any sidebar entry (Workbench / Anatomy / Docs) to leave.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-black/[0.06] bg-white p-4">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-mm-text-dim">Username</div>
            <div className="text-sm text-mm-text">{user.username}</div>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-mm-text-dim">Signed up</div>
            <div className="text-sm text-mm-text">{signupDate}</div>
          </div>
          {user.is_admin && (
            <div className="col-span-2">
              <span className="rounded-md bg-mm-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase text-mm-accent">
                admin
              </span>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-black/[0.06] bg-white p-4">
          <div className="mb-2 text-sm font-medium text-mm-text">SDK API key</div>
          <p className="mb-3 text-[11px] text-mm-text-dim">
            Paste this into the ``POSIT_API_KEY`` env var for your SDK integration.
            Treat it like a password — anyone with this key can push snapshots into
            your workspace.
          </p>

          <div className="mb-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md bg-black/[0.04] px-3 py-2 font-mono text-xs text-mm-text">
              {apiKey === null
                ? "Loading…"
                : revealed
                  ? apiKey
                  : "•".repeat(Math.min(apiKey.length, 40))}
            </code>
            <button
              onClick={() => setRevealed((v) => !v)}
              className="rounded-md border border-black/[0.06] px-2 py-2 text-[11px] text-mm-text-dim hover:bg-black/[0.04]"
            >
              {revealed ? "Hide" : "Show"}
            </button>
            <button
              onClick={onCopy}
              disabled={apiKey === null}
              className="rounded-md border border-black/[0.06] px-2 py-2 text-[11px] text-mm-text-dim hover:bg-black/[0.04] disabled:opacity-50"
            >
              Copy
            </button>
          </div>

          {copyNotice && (
            <div className="mb-3 text-[11px] text-mm-accent">{copyNotice}</div>
          )}

          {confirming ? (
            <div className="flex items-center gap-2 rounded-md bg-mm-warn/10 px-3 py-2 text-[11px]">
              <span className="text-mm-text">
                This invalidates the old key immediately. SDK clients using it will disconnect.
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={onRegenerate}
                  disabled={regenerating}
                  className="rounded-md bg-mm-error px-2 py-1 text-[11px] font-medium text-white hover:bg-mm-error/90 disabled:opacity-50"
                >
                  {regenerating ? "…" : "Regenerate"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-black/[0.06] px-2 py-1 text-[11px] text-mm-text-dim hover:bg-black/[0.04]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="rounded-md border border-black/[0.06] px-3 py-1.5 text-[11px] text-mm-text-dim hover:bg-black/[0.04]"
            >
              Regenerate API key
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
