import { useCallback } from "react";
import { GlobalContextBar } from "./components/GlobalContextBar";
import { ChatDrawer } from "./components/shared/ChatDrawer";
import { CommandPalette } from "./components/shared/CommandPalette";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { BlockDrawer } from "./components/studio/brain/BlockDrawer";
import { FloorPage } from "./pages/FloorPage";
import { StudioPage } from "./pages/StudioPage";
import { DocsPage } from "./pages/DocsPage";
import { useMode, type ModeId } from "./providers/ModeProvider";
import { useChat } from "./providers/ChatProvider";

import "react-grid-layout/css/styles.css";

const MODE_PAGES: Record<ModeId, React.FC> = {
  floor: FloorPage,
  studio: StudioPage,
  docs: DocsPage,
};

export default function App() {
  const { mode } = useMode();
  const { pendingBlockCommand, clearPendingBlockCommand } = useChat();
  const Page = MODE_PAGES[mode];

  const handleBlockDrawerClose = useCallback(() => {
    clearPendingBlockCommand();
  }, [clearPendingBlockCommand]);

  // onSaved also clears the pending command (drawer will close)
  const handleBlockDrawerSaved = useCallback(() => {
    clearPendingBlockCommand();
  }, [clearPendingBlockCommand]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-mm-bg">
      <header className="relative z-50 shrink-0">
        <GlobalContextBar />
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Page />
        <ChatDrawer />
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
