import { useCallback, useState } from "react";
import { GlobalContextBar } from "./components/GlobalContextBar";
import { CommandPalette } from "./components/shared/CommandPalette";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { BlockDrawer } from "./components/studio/brain/BlockDrawer";
import { HotkeyCheatsheet } from "./components/workbench/HotkeyCheatsheet";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { AnatomyPage } from "./pages/AnatomyPage";
import { DocsPage } from "./pages/DocsPage";
import { LoginPage } from "./pages/LoginPage";
import { AccountPage } from "./pages/AccountPage";
import { AdminPage } from "./pages/AdminPage";
import { useAuth } from "./providers/AuthProvider";
import { useMode, type ModeId } from "./providers/ModeProvider";
import { useChat } from "./providers/ChatProvider";
import { useFocus } from "./providers/FocusProvider";
import { useCommandPalette } from "./providers/CommandPaletteProvider";
import { useTimeOnApp } from "./hooks/useTimeOnApp";
import { useHotkeys } from "./hooks/useHotkeys";
import { WORKBENCH_RAIL_OPEN_KEY } from "./constants";

import "react-grid-layout/css/styles.css";

const MODE_PAGES: Record<ModeId, React.FC> = {
  workbench: WorkbenchPage,
  anatomy: AnatomyPage,
  docs: DocsPage,
};

type View = "dashboard" | "account" | "admin";

export default function App() {
  const { user } = useAuth();
  const { mode } = useMode();
  const { pendingBlockCommand, clearPendingBlockCommand, toggleDrawer } = useChat();
  const { clearFocus } = useFocus();
  const { togglePalette } = useCommandPalette();
  const [view, setView] = useState<View>("dashboard");
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  // Instrument time-on-app only for authenticated users.
  useTimeOnApp();

  const handleBlockDrawerClose = useCallback(() => {
    clearPendingBlockCommand();
  }, [clearPendingBlockCommand]);

  const handleBlockDrawerSaved = useCallback(() => {
    clearPendingBlockCommand();
  }, [clearPendingBlockCommand]);

  const openAccount = useCallback(() => setView("account"), []);
  const openAdmin = useCallback(() => setView("admin"), []);
  const closeOverlay = useCallback(() => setView("dashboard"), []);

  // Bare-key workbench hotkeys. Modifier-bearing shortcuts (⌘K palette,
  // ⌘/ chat) are owned by their respective components — kept separate so
  // useHotkeys can refuse modified events without conflict.
  const toggleRail = useCallback(() => {
    try {
      const v = localStorage.getItem(WORKBENCH_RAIL_OPEN_KEY);
      const next = v === "false" ? "true" : "false";
      localStorage.setItem(WORKBENCH_RAIL_OPEN_KEY, next);
      window.dispatchEvent(new StorageEvent("storage", { key: WORKBENCH_RAIL_OPEN_KEY }));
    } catch {
      // ignore — private mode
    }
  }, []);

  useHotkeys({
    "Escape": () => {
      if (cheatsheetOpen) setCheatsheetOpen(false);
      else clearFocus();
    },
    "[": toggleRail,
    "]": toggleRail,
    "?": () => setCheatsheetOpen(true),
    "g c": () => toggleDrawer(),
    "g s": () => { /* StreamStatusList lives in workbench — no-op for now */ },
    "g b": () => { /* Block table lives in workbench */ },
    "g p": () => { /* Position grid lives in workbench */ },
    "g k": () => togglePalette(),
  });

  if (user === null) {
    return <LoginPage />;
  }

  const Page = MODE_PAGES[mode];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-mm-bg">
      <header className="relative z-50 shrink-0">
        <GlobalContextBar onOpenAccount={openAccount} onOpenAdmin={openAdmin} />
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {view === "account" ? (
          <AccountPage onClose={closeOverlay} />
        ) : view === "admin" ? (
          <AdminPage onClose={closeOverlay} />
        ) : (
          <Page />
        )}
      </div>
      <CommandPalette />
      <HotkeyCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
      <OnboardingFlow />
      <BlockDrawer
        open={pendingBlockCommand != null}
        mode="create"
        block={null}
        initialParams={pendingBlockCommand?.params ?? null}
        onClose={handleBlockDrawerClose}
        onSaved={handleBlockDrawerSaved}
      />
    </div>
  );
}
