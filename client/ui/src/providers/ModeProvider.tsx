import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ModeId = "floor" | "studio" | "lens" | "docs";

const VALID_MODES: readonly ModeId[] = ["floor", "studio", "lens", "docs"] as const;
const DEFAULT_MODE: ModeId = "floor";

export const MODE_LABELS: Record<ModeId, string> = {
  floor: "Floor",
  studio: "Studio",
  lens: "Lens",
  docs: "Docs",
};

interface ParsedRoute {
  mode: ModeId;
  subPath: string;
}

function parseHash(hash: string): ParsedRoute {
  // hash is "#floor", "#studio/streams", "#studio/streams/btc", etc.
  const cleaned = hash.replace(/^#\/?/, "");
  if (!cleaned) return { mode: DEFAULT_MODE, subPath: "" };

  const slash = cleaned.indexOf("/");
  const head = slash === -1 ? cleaned : cleaned.slice(0, slash);
  const rest = slash === -1 ? "" : cleaned.slice(slash + 1);

  if ((VALID_MODES as readonly string[]).includes(head)) {
    return { mode: head as ModeId, subPath: rest };
  }
  return { mode: DEFAULT_MODE, subPath: "" };
}

function buildHash(mode: ModeId, subPath: string = ""): string {
  return subPath ? `#${mode}/${subPath}` : `#${mode}`;
}

interface ModeContextValue {
  mode: ModeId;
  subPath: string;
  setMode: (mode: ModeId, subPath?: string) => void;
  navigate: (path: string) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<ParsedRoute>(() =>
    parseHash(window.location.hash),
  );

  // Listen for hash changes — covers browser back/forward AND our own navigations.
  useEffect(() => {
    function handleHashChange() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // On initial mount: write the default hash if it's missing so the URL is shareable.
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
    () => ({ mode: route.mode, subPath: route.subPath, setMode, navigate }),
    [route.mode, route.subPath, setMode, navigate],
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within ModeProvider");
  return ctx;
}
