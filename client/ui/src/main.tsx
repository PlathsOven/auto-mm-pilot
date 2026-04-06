import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WebSocketProvider } from "./providers/WebSocketProvider";
import { ChatProvider } from "./providers/ChatProvider";
import { LayoutProvider } from "./providers/LayoutProvider";
import { SelectionProvider } from "./providers/SelectionProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WebSocketProvider>
      <ChatProvider>
        <LayoutProvider>
          <SelectionProvider>
            <App />
          </SelectionProvider>
        </LayoutProvider>
      </ChatProvider>
    </WebSocketProvider>
  </React.StrictMode>,
);
