import { useState } from "react";

import { useAuth } from "../providers/AuthProvider";
import { ApiError } from "../services/api";

type Panel = "login" | "signup";

export function LoginPage() {
  const { login, signup, pending } = useAuth();
  const [panel, setPanel] = useState<Panel>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isSignup = panel === "signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (isSignup) {
        if (password !== confirmPassword) {
          setError("Passwords don't match.");
          return;
        }
        await signup({ username, password });
      } else {
        await login({ username, password });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Something went wrong.";
      setError(msg);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-mm-bg">
      <div className="w-full max-w-sm rounded-lg border border-black/[0.06] bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-bold text-mm-accent">Posit</h1>
        <p className="mb-5 text-[11px] text-mm-text-dim">
          {isSignup ? "Create your account." : "Sign in to your workspace."}
        </p>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-mm-text-dim">
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_-]{3,32}"
              className="rounded-md border border-black/[0.1] bg-white px-3 py-2 text-sm text-mm-text outline-none focus:border-mm-accent"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-mm-text-dim">
            Password
            <input
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="rounded-md border border-black/[0.1] bg-white px-3 py-2 text-sm text-mm-text outline-none focus:border-mm-accent"
            />
          </label>

          {isSignup && (
            <label className="flex flex-col gap-1 text-xs text-mm-text-dim">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="rounded-md border border-black/[0.1] bg-white px-3 py-2 text-sm text-mm-text outline-none focus:border-mm-accent"
              />
            </label>
          )}

          {error && (
            <p className="rounded-md bg-mm-error/10 px-3 py-2 text-xs text-mm-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-mm-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-mm-accent/90 disabled:opacity-50"
          >
            {pending ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => {
              setPanel(isSignup ? "login" : "signup");
              setError(null);
            }}
            className="text-center text-[11px] text-mm-text-dim hover:text-mm-accent"
          >
            {isSignup
              ? "Already have an account? Sign in."
              : "New to Posit? Create an account."}
          </button>
        </form>
      </div>
    </div>
  );
}
