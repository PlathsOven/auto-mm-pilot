import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CommandPalette } from "./components/shared/CommandPalette";
import { BlockDrawer } from "./components/studio/brain/BlockDrawer";
import { ProposalPreviewDrawer } from "./components/proposal/ProposalPreviewDrawer";
import { HotkeyCheatsheet } from "./components/workbench/HotkeyCheatsheet";
import { AppShell } from "./components/shell/AppShell";
import { PositSplash } from "./components/shell/PositSplash";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { AnatomyCanvas } from "./components/studio/anatomy/AnatomyCanvas";
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
import { useAppReady } from "./hooks/useAppReady";

const MODE_PAGES: Record<ModeId, React.FC> = {
  workbench: WorkbenchPage,
  anatomy: AnatomyCanvas,
  docs: DocsPage,
  account: AccountPage,
  admin: AdminPage,
};

// Cross-fade duration for mode switches. Kept short enough not to feel like
// a delay but long enough to read as a transition rather than a jump-cut.
const MODE_FADE_S = 0.22;

export function App() {
  const { user } = useAuth();
  const { mode } = useMode();
  const {
    pendingBlockCommand, clearPendingBlockCommand, toggleDrawer,
    pendingProposal, confirmProposal, cancelProposal,
  } = useChat();
  const { clearFocus } = useFocus();
  const { togglePalette } = useCommandPalette();
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const { ready, message } = useAppReady();

  // Instrument time-on-app only for authenticated users.
  useTimeOnApp();

  const handleBlockDrawerClose = useCallback(() => {
    clearPendingBlockCommand();
  }, [clearPendingBlockCommand]);

  const handleBlockDrawerSaved = useCallback(() => {
    clearPendingBlockCommand();
  }, [clearPendingBlockCommand]);

  const showCheatsheet = useCallback(() => setCheatsheetOpen(true), []);
  // `?` is the canonical cheatsheet shortcut and should toggle, not just open
  // — same key both directions matches the user's "one gesture" principle.
  const toggleCheatsheet = useCallback(() => setCheatsheetOpen((v) => !v), []);

  // Bare-key hotkeys owned at the App level. Modifier-bearing shortcuts
  // (⌘K palette, ⌘/ chat) belong to their respective components — kept
  // separate so useHotkeys can refuse modified events without conflict.
  // `[` / `]` (inspector toggle) are scoped to InspectorColumn itself and
  // only fire while the workbench is mounted.
  useHotkeys({
    "Escape": () => {
      if (cheatsheetOpen) setCheatsheetOpen(false);
      else clearFocus();
    },
    "?": toggleCheatsheet,
    "g c": () => toggleDrawer(),
    "g k": () => togglePalette(),
  });

  return (
    <>
      <AnimatePresence mode="wait">
        {user === null ? (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="h-full"
          >
            <LoginPage />
          </motion.div>
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="h-full"
          >
            <AppShell onShowCheatsheet={showCheatsheet}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: MODE_FADE_S, ease: "easeOut" }}
                  className="flex min-h-0 min-w-0 flex-1"
                >
                  {(() => {
                    const Page = MODE_PAGES[mode];
                    return <Page />;
                  })()}
                </motion.div>
              </AnimatePresence>
            </AppShell>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {user !== null && !ready && (
          <PositSplash key="post-login-splash" message={message} />
        )}
      </AnimatePresence>

      <CommandPalette />
      <HotkeyCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
      <BlockDrawer
        open={pendingBlockCommand != null}
        mode="create"
        block={null}
        initialParams={pendingBlockCommand?.params ?? null}
        onClose={handleBlockDrawerClose}
        onSaved={handleBlockDrawerSaved}
      />
      <ProposalPreviewDrawer
        proposal={pendingProposal}
        onConfirm={confirmProposal}
        onCancel={cancelProposal}
      />
    </>
  );
}
