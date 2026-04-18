import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./providers/AuthProvider";
import { WebSocketProvider } from "./providers/WebSocketProvider";
import { ChatProvider } from "./providers/ChatProvider";
import { FocusProvider } from "./providers/FocusProvider";
import { ModeProvider } from "./providers/ModeProvider";
import { OnboardingProvider } from "./providers/OnboardingProvider";
import { CommandPaletteProvider } from "./providers/CommandPaletteProvider";
import { TransformsProvider } from "./providers/TransformsProvider";
import { composeProviders } from "./providers/compose";
import "./index.css";

// Optional grain overlay — toggled by VITE_UI_GRAIN=1 at build/dev time. The
// CSS rule lives in index.css and keys off `html[data-grain="on"]`.
if (import.meta.env.VITE_UI_GRAIN === "1") {
  document.documentElement.dataset.grain = "on";
}

// AuthProvider must wrap WebSocketProvider so the WS URL can read the
// current session token. Everything else inside remains unchanged.
const AppProviders = composeProviders([
  AuthProvider,
  WebSocketProvider,
  ChatProvider,
  FocusProvider,
  ModeProvider,
  OnboardingProvider,
  CommandPaletteProvider,
  TransformsProvider,
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
