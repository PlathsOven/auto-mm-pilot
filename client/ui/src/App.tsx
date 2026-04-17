import { useCallback, useState } from "react";
import { GlobalContextBar } from "./components/GlobalContextBar";
import { ChatDrawer } from "./components/shared/ChatDrawer";
import { CommandPalette } from "./components/shared/CommandPalette";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { BlockDrawer } from "./components/studio/brain/BlockDrawer";
import { FloorPage } from "./pages/FloorPage";
import { BrainPage } from "./pages/BrainPage";
import { AnatomyPage } from "./pages/AnatomyPage";
import { DocsPage } from "./pages/DocsPage";
import { LoginPage } from "./pages/LoginPage";
import { AccountPage } from "./pages/AccountPage";
import { AdminPage } from "./pages/AdminPage";
import { useAuth } from "./providers/AuthProvider";
import { useMode, type ModeId } from "./providers/ModeProvider";
import { useChat } from "./providers/ChatProvider";
import { useTimeOnApp } from "./hooks/useTimeOnApp";

import "react-grid-layout/css/styles.css";

const MODE_PAGES: Record<ModeId, React.FC> = {
  eyes: FloorPage,
  brain: BrainPage,
  anatomy: AnatomyPage,
  docs: DocsPage,
};

type View = "dashboard" | "account" | "admin";

export default function App() {
  const { user } = useAuth();
  const { mode } = useMode();
  const { pendingBlockCommand, clearPendingBlockCommand } = useChat();
  const [view, setView] = useState<View>("dashboard");

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
          <>
            <Page />
            <ChatDrawer />
          </>
        )}
      </div>
      <CommandPalette />
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
