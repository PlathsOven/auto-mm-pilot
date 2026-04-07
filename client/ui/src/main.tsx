import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WebSocketProvider } from "./providers/WebSocketProvider";
import { ChatProvider } from "./providers/ChatProvider";
import { LayoutProvider } from "./providers/LayoutProvider";
import { SelectionProvider } from "./providers/SelectionProvider";
import { ModeProvider } from "./providers/ModeProvider";
import { OnboardingProvider } from "./providers/OnboardingProvider";
import { CommandPaletteProvider } from "./providers/CommandPaletteProvider";
import { TransformsProvider } from "./providers/TransformsProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WebSocketProvider>
      <ChatProvider>
        <LayoutProvider>
          <SelectionProvider>
            <ModeProvider>
              <OnboardingProvider>
                <CommandPaletteProvider>
                  <TransformsProvider>
                    <App />
                  </TransformsProvider>
                </CommandPaletteProvider>
              </OnboardingProvider>
            </ModeProvider>
          </SelectionProvider>
        </LayoutProvider>
      </ChatProvider>
    </WebSocketProvider>
  </React.StrictMode>,
);
