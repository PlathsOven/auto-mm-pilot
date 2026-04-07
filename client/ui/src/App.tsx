import { GlobalContextBar } from "./components/GlobalContextBar";
import { ChatDrawer } from "./components/shared/ChatDrawer";
import { CommandPalette } from "./components/shared/CommandPalette";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { FloorPage } from "./pages/FloorPage";
import { StudioPage } from "./pages/StudioPage";
import { DocsPage } from "./pages/DocsPage";
import { useMode, type ModeId } from "./providers/ModeProvider";

import "react-grid-layout/css/styles.css";

const MODE_PAGES: Record<ModeId, React.FC> = {
  floor: FloorPage,
  studio: StudioPage,
  docs: DocsPage,
};

export default function App() {
  const { mode } = useMode();
  const Page = MODE_PAGES[mode];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-mm-bg-deep">
      <header className="relative z-50 shrink-0">
        <GlobalContextBar />
      </header>
      <Page />
      <ChatDrawer />
      <CommandPalette />
      <OnboardingFlow />
    </div>
  );
}
