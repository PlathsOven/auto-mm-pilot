import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./providers/AuthProvider";
import { WebSocketProvider } from "./providers/WebSocketProvider";
import { ChatProvider } from "./providers/ChatProvider";
import { LayoutProvider } from "./providers/LayoutProvider";
import { SelectionProvider } from "./providers/SelectionProvider";
import { ModeProvider } from "./providers/ModeProvider";
import { OnboardingProvider } from "./providers/OnboardingProvider";
import { CommandPaletteProvider } from "./providers/CommandPaletteProvider";
import { TransformsProvider } from "./providers/TransformsProvider";
import { composeProviders } from "./providers/compose";
import "./index.css";

// AuthProvider must wrap WebSocketProvider so the WS URL can read the
// current session token. Everything else inside remains unchanged.
const AppProviders = composeProviders([
  AuthProvider,
  WebSocketProvider,
  ChatProvider,
  LayoutProvider,
  SelectionProvider,
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
