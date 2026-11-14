import { useEffect } from "react";
import { startMcpBridge } from "@/lib/mcpTasks";

/** Mount once (ChatPanelContent): registers the MCP task handler with the shell, if it has the bridge. */
export function useMcpBridge(): void {
  useEffect(() => startMcpBridge(), []);
}
