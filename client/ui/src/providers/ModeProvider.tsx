import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ModeId = "floor" | "studio" | "docs";

const VALID_MODES: readonly ModeId[] = ["floor", "studio", "docs"] as const;
const DEFAULT_MODE: ModeId = "floor";

export const MODE_LABELS: Record<ModeId, string> = {
  floor: "Floor",
  studio: "Studio",
  docs: "Docs",
};

/**
 * Parsed route state.
 *
 * `segments` are the slash-separated parts of everything after the mode, and
 * `query` holds any `?k=v` pairs. For example, `#studio/streams/btc?template=fomc`
 * yields `{ mode: "studio", segments: ["streams", "btc"], query: { template: "fomc" } }`.
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

  if (!(VALID_MODES as readonly string[]).includes(head)) {
    return emptyRoute(DEFAULT_MODE);
  }

  const segments = rest ? rest.split("/").filter(Boolean) : [];
  const query: Record<string, string> = {};
  if (queryString) {
    for (const [k, v] of new URLSearchParams(queryString).entries()) {
      query[k] = v;
    }
  }
  return { mode: head as ModeId, subPath: rest, segments, query };
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
