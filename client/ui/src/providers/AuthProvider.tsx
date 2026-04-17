import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { registerAuthHandlers } from "../services/api";
import {
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
} from "../services/authApi";
import type { LoginRequest, SignupRequest, UserPublic } from "../types";

interface AuthState {
  user: UserPublic | null;
  sessionToken: string | null;
  /** true while we're mid-signup/login/logout so the UI can disable buttons */
  pending: boolean;
  login: (req: LoginRequest) => Promise<void>;
  signup: (req: SignupRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tokenRef = useRef<string | null>(null);

  // Keep the ref in sync so the api.ts getter reads the latest value even
  // across async closures that captured an older state snapshot.
  useEffect(() => {
    tokenRef.current = sessionToken;
  }, [sessionToken]);

  const clearAuth = useCallback(() => {
    setUser(null);
    setSessionToken(null);
    tokenRef.current = null;
  }, []);

  useEffect(() => {
    registerAuthHandlers(
      () => tokenRef.current,
      () => {
        // 401 from any endpoint → session has died, route back to Login.
        clearAuth();
      },
    );
  }, [clearAuth]);

  const login = useCallback(async (req: LoginRequest) => {
    setPending(true);
    try {
      const resp = await apiLogin(req);
      tokenRef.current = resp.session_token;
      setSessionToken(resp.session_token);
      setUser(resp.user);
    } finally {
      setPending(false);
    }
  }, []);

  const signup = useCallback(async (req: SignupRequest) => {
    setPending(true);
    try {
      const resp = await apiSignup(req);
      tokenRef.current = resp.session_token;
      setSessionToken(resp.session_token);
      setUser(resp.user);
    } finally {
      setPending(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setPending(true);
    try {
      await apiLogout().catch(() => {
        /* even if server rejects, clear the local session */
      });
    } finally {
      clearAuth();
      setPending(false);
    }
  }, [clearAuth]);

  const value = useMemo<AuthState>(
    () => ({ user, sessionToken, pending, login, signup, logout }),
    [user, sessionToken, pending, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
