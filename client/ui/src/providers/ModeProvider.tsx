import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ModeId = "workbench" | "anatomy" | "docs" | "account" | "admin";

const VALID_MODES: readonly ModeId[] = ["workbench", "anatomy", "docs", "account", "admin"] as const;
const DEFAULT_MODE: ModeId = "workbench";

/** Modes that appear in the primary sidebar nav. Account/Admin are reachable
 *  via the user menu instead — keeping the primary nav focused on the
 *  trader's workspaces. */
export const PRIMARY_MODES: readonly ModeId[] = ["workbench", "anatomy", "docs"] as const;

/**
 * Legacy mode hashes redirected to the unified workbench. `eyes` (Floor) and
 * `brain` (Brain) used to be separate pages; the Phase 1 redesign merged them
 * into a single canvas with a focus-driven Inspector rail. Keep these
 * redirects so old bookmarks and existing client code paths still land
 * somewhere sensible.
 */
const LEGACY_MODE_ALIASES: Record<string, ModeId> = {
  eyes: "workbench",
  brain: "workbench",
  floor: "workbench",
};

export const MODE_LABELS: Record<ModeId, string> = {
  workbench: "Workbench",
  anatomy: "Anatomy",
  docs: "Docs",
  account: "Account",
  admin: "Admin",
};

/**
 * Parsed route state.
 *
 * `segments` are the slash-separated parts of everything after the mode, and
 * `query` holds any `?k=v` pairs. For example, `#anatomy?stream=rv_btc`
 * yields `{ mode: "anatomy", segments: [], query: { stream: "rv_btc" } }`.
 */
interface ParsedRoute {
  mode: ModeId;
  subPath: string;
  segments: readonly string[];
  query: Readonly<Record<string, string>>;
}

function parseHash(hash: string): ParsedRoute {
  const cleaned = hash.replace(/^#\/?/, "");
  if (!cleaned) return emptyRoute(DEFAULT_MODE);

  const [path, queryString = ""] = cleaned.split("?");
  const slash = path.indexOf("/");
  const head = slash === -1 ? path : path.slice(0, slash);
  const rest = slash === -1 ? "" : path.slice(slash + 1);

  let resolvedHead: ModeId;
  if ((VALID_MODES as readonly string[]).includes(head)) {
    resolvedHead = head as ModeId;
  } else if (head in LEGACY_MODE_ALIASES) {
    resolvedHead = LEGACY_MODE_ALIASES[head];
  } else {
    return emptyRoute(DEFAULT_MODE);
  }

  const segments = rest ? rest.split("/").filter(Boolean) : [];
  const query: Record<string, string> = {};
  if (queryString) {
    for (const [k, v] of new URLSearchParams(queryString).entries()) {
      query[k] = v;
    }
  }
  return { mode: resolvedHead, subPath: rest, segments, query };
}

function emptyRoute(mode: ModeId): ParsedRoute {
  return { mode, subPath: "", segments: [], query: {} };
}

function buildHash(mode: ModeId, subPath: string = ""): string {
  return subPath ? `#${mode}/${subPath}` : `#${mode}`;
}

interface ModeContextValue {
  mode: ModeId;
  subPath: string;
  segments: readonly string[];
  query: Readonly<Record<string, string>>;
  setMode: (mode: ModeId, subPath?: string) => void;
  navigate: (path: string) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<ParsedRoute>(() =>
    parseHash(window.location.hash),
  );

  useEffect(() => {
    function handleHashChange() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = buildHash(DEFAULT_MODE);
    }
  }, []);

  const setMode = useCallback((mode: ModeId, subPath: string = "") => {
    const next = buildHash(mode, subPath);
    if (next !== window.location.hash) {
      window.location.hash = next;
    }
  }, []);

  const navigate = useCallback((path: string) => {
    const cleaned = path.replace(/^#?\/?/, "");
    const next = `#${cleaned}`;
    if (next !== window.location.hash) {
      window.location.hash = next;
    }
  }, []);

  const value = useMemo(
    () => ({
      mode: route.mode,
      subPath: route.subPath,
      segments: route.segments,
      query: route.query,
      setMode,
      navigate,
    }),
    [route.mode, route.subPath, route.segments, route.query, setMode, navigate],
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within ModeProvider");
  return ctx;
}
