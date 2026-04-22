import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { useAuth } from "../providers/AuthProvider";
import { ApiError } from "../services/api";
import { PositLogo } from "../components/shell/PositLogo";
import { LoginBackdrop } from "./LoginBackdrop";

type Panel = "login" | "signup";

const HERO_DELAY_S = 0.2;
const CARD_DELAY_S = 0.32;
const ENTRANCE_EASE = [0.16, 1, 0.3, 1] as const;

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
    <div className="relative flex h-screen items-center justify-center">
      <LoginBackdrop />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: HERO_DELAY_S, duration: 0.6, ease: ENTRANCE_EASE }}
          className="mb-7 flex flex-col items-center"
        >
          <motion.div
            animate={{ opacity: [0.92, 1, 0.92] }}
            transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
          >
            <PositLogo size={34} />
          </motion.div>
          <p className="mt-3 text-[11px] font-medium tracking-wide text-mm-text-dim">
            The framework for positional trading.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: CARD_DELAY_S, duration: 0.55, ease: ENTRANCE_EASE }}
          className="w-full overflow-hidden rounded-2xl border border-white/60 ring-1 ring-black/[0.06]"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.38) 100%)",
            backdropFilter: "blur(48px) saturate(1.6)",
            WebkitBackdropFilter: "blur(48px) saturate(1.6)",
            boxShadow:
              "inset 0 1px 0 rgba(255, 255, 255, 0.75)," +
              "inset 0 -1px 0 rgba(79, 91, 213, 0.05)," +
              "0 24px 48px -16px rgba(15, 17, 41, 0.22)," +
              "0 8px 16px -8px rgba(15, 17, 41, 0.12)",
          }}
        >
          <div className="p-8">
            <AnimatePresence mode="wait">
              <motion.p
                key={panel}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="mb-6 text-xs text-mm-text-dim"
              >
                {isSignup ? "Create your account." : "Sign in to your workspace."}
              </motion.p>
            </AnimatePresence>

            <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
              <label className="flex flex-col gap-1.5 text-[11px] font-medium tracking-wide text-mm-text-dim">
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
                  className="rounded-lg border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-mm-text outline-none ring-1 ring-black/[0.04] backdrop-blur-sm transition-all duration-200 placeholder:text-mm-text-subtle focus:border-mm-accent/40 focus:bg-white/85 focus:ring-2 focus:ring-mm-accent/25"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-[11px] font-medium tracking-wide text-mm-text-dim">
                Password
                <input
                  type="password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="rounded-lg border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-mm-text outline-none ring-1 ring-black/[0.04] backdrop-blur-sm transition-all duration-200 placeholder:text-mm-text-subtle focus:border-mm-accent/40 focus:bg-white/85 focus:ring-2 focus:ring-mm-accent/25"
                />
              </label>

              <AnimatePresence initial={false}>
                {isSignup && (
                  <motion.label
                    key="confirm-password"
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: "auto", marginTop: 0 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.24, ease: ENTRANCE_EASE }}
                    className="flex flex-col gap-1.5 overflow-hidden text-[11px] font-medium tracking-wide text-mm-text-dim"
                  >
                    Confirm password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      className="rounded-lg border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-mm-text outline-none ring-1 ring-black/[0.04] backdrop-blur-sm transition-all duration-200 placeholder:text-mm-text-subtle focus:border-mm-accent/40 focus:bg-white/85 focus:ring-2 focus:ring-mm-accent/25"
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
                    className="rounded-lg border border-mm-error/20 bg-mm-error/10 px-3 py-2 text-xs text-mm-error"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <motion.button
                type="submit"
                disabled={pending}
                whileTap={pending ? undefined : { scale: 0.98 }}
                className="group relative mt-1 overflow-hidden rounded-lg px-3.5 py-2.5 text-sm font-medium text-white shadow-[0_8px_20px_-8px_rgba(79,91,213,0.55)] transition-shadow hover:shadow-[0_10px_24px_-6px_rgba(79,91,213,0.65)] disabled:opacity-60 disabled:shadow-none"
                style={{
                  background:
                    "linear-gradient(135deg, #5966e0 0%, #4f5bd5 50%, #7b6cf0 100%)",
                }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-100"
                />
                <span className="relative">
                  {pending ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
                </span>
              </motion.button>

              <button
                type="button"
                onClick={() => {
                  setPanel(isSignup ? "login" : "signup");
                  setError(null);
                }}
                className="mt-1 text-center text-[11px] text-mm-text-dim transition-colors hover:text-mm-accent"
              >
                {isSignup
                  ? "Already have an account? Sign in."
                  : "New to Posit? Create an account."}
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
