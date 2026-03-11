"use client";

import dynamic from "next/dynamic";
import { WebSocketProvider } from "@/terminal/providers/WebSocketProvider";
import { ChatProvider } from "@/terminal/providers/ChatProvider";
import { LayoutProvider } from "@/terminal/providers/LayoutProvider";

const TerminalApp = dynamic(() => import("@/terminal/TerminalApp"), {
  ssr: false,
});

export default function DemoPage() {
  return (
    <WebSocketProvider>
      <ChatProvider>
        <LayoutProvider>
          <TerminalApp />
        </LayoutProvider>
      </ChatProvider>
    </WebSocketProvider>
  );
}
