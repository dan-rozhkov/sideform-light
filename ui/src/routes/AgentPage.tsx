import { useEffect } from "react";
import { EditorProviders } from "@/components/EditorProviders";
import { ChatPanelContent } from "@/components/chat/ChatPanel";
import { useHtmlRouteClass } from "@/hooks/useHtmlRouteClass";
import { useChatBootstrap } from "@/hooks/useChatBootstrap";
import { startDesktopChatPersistence } from "@/lib/chats/desktopChatPersistence";

/** "/agent": the agent chat (chat list + open chat), full height, in the shell's panel view. */
export default function AgentPage() {
  useChatBootstrap();
  // Show the chats stored on disk and keep saving them. No-op without the bridge.
  useEffect(() => {
    void startDesktopChatPersistence();
  }, []);
  useHtmlRouteClass("route-agent");
  return (
    <EditorProviders>
      <div role="region" aria-label="Sideform Agent" className="h-dvh w-full overflow-hidden bg-surface-panel">
        <ChatPanelContent variant="standalone" isVisible />
      </div>
    </EditorProviders>
  );
}
