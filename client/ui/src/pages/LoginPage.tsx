import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { useAuth } from "../providers/AuthProvider";
import { ApiError } from "../services/api";
import { PositLogo } from "../components/shell/PositLogo";

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
    <div className="flex h-screen items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm rounded-lg border border-white/55 bg-white/80 p-6 ring-1 ring-black/[0.05] shadow-elev-2 backdrop-blur-glass32"
      >
        <div className="mb-2 flex items-center">
          <PositLogo size={24} />
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={panel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="mb-5 text-[11px] text-mm-text-dim"
          >
            {isSignup ? "Create your account." : "Sign in to your workspace."}
          </motion.p>
        </AnimatePresence>

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

          <AnimatePresence initial={false}>
            {isSignup && (
              <motion.label
                key="confirm-password"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: "auto", marginTop: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col gap-1 overflow-hidden text-xs text-mm-text-dim"
              >
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  className="rounded-md border border-black/[0.1] bg-white px-3 py-2 text-sm text-mm-text outline-none transition-colors focus:border-mm-accent"
                />
              </motion.label>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="rounded-md bg-mm-error/10 px-3 py-2 text-xs text-mm-error"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <motion.button
            type="submit"
            disabled={pending}
            whileTap={pending ? undefined : { scale: 0.98 }}
            className="rounded-md bg-mm-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-mm-accent/90 disabled:opacity-50"
          >
            {pending ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </motion.button>

          <button
            type="button"
            onClick={() => {
              setPanel(isSignup ? "login" : "signup");
              setError(null);
            }}
            className="text-center text-[11px] text-mm-text-dim transition-colors hover:text-mm-accent"
          >
            {isSignup
              ? "Already have an account? Sign in."
              : "New to Posit? Create an account."}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
