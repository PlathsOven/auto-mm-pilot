import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { migrateLegacyStorageKey, safeGetItem, safeSetItem } from "../utils";

const STORAGE_KEY = "posit.onboarding.completed";
const LEGACY_STORAGE_KEY = "apt.onboarding.completed";

interface OnboardingContextValue {
  /** True if the user has completed (or skipped) onboarding before. */
  completed: boolean;
  /** True if the onboarding overlay should be visible. */
  open: boolean;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  markCompleted: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function readCompleted(): boolean {
  migrateLegacyStorageKey(LEGACY_STORAGE_KEY, STORAGE_KEY);
  return safeGetItem(STORAGE_KEY) === "true";
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [completed, setCompleted] = useState<boolean>(readCompleted);
  const [open, setOpen] = useState<boolean>(false);

  // First launch: open if not yet completed
  useEffect(() => {
    if (!completed) setOpen(true);
  }, [completed]);

  const openOnboarding = useCallback(() => setOpen(true), []);
  const closeOnboarding = useCallback(() => setOpen(false), []);

  const markCompleted = useCallback(() => {
    safeSetItem(STORAGE_KEY, "true");
    setCompleted(true);
    setOpen(false);
  }, []);

  const value = useMemo(
    () => ({ completed, open, openOnboarding, closeOnboarding, markCompleted }),
    [completed, open, openOnboarding, closeOnboarding, markCompleted],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
