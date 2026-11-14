import { isChatSender, type ChatIpcDeps, type ChatSender } from "../chatIpc";

export interface McpPanelSenderDeps {
  panelUrlOf: ChatIpcDeps["panelUrlOf"];
}

/**
 * Who may send `mcp:panel-ready`, `mcp:task-reply` and `mcp:task-changed`: the agent panel's own webContents and
 * page (the `chats:*` check), AND a frame that is still there (a destroyed panel's late message is not accepted:
 * unlike a chat save, nothing here needs to land after the close).
 */
export function isMcpPanelSender(deps: McpPanelSenderDeps, sender: ChatSender): boolean {
  return sender.frameUrl !== null && isChatSender(deps, sender);
}
