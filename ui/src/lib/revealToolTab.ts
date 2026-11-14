/**
 * A click on a browse tool chip in the agent panel's chat brings forward the browser tab the agent drives.
 * No-op outside the agent panel and for tools that do not run in the browser. Never throws.
 */
import { isIsolatedBrowseCall, runSessionForCall } from "@/lib/tools/browser/isolation";

interface RevealArgs {
  toolCallId: string;
  toolName: string;
  input?: unknown;
}

const BROWSER_PREFIXES = ["browse_", "qa_"] as const;

export async function revealToolTab({ toolName, toolCallId, input }: RevealArgs): Promise<void> {
  try {
    const browser = window.penAgentPanel?.browser;
    if (!BROWSER_PREFIXES.some((p) => toolName.startsWith(p))) return;
    if (typeof browser?.revealAgentTab !== "function") return;
    let session: string | undefined;
    if (toolName === "browse_agent") {
      session = runSessionForCall(toolCallId);
      // An isolated run never uses the shared browser: no remembered session (still waiting for a slot, or the
      // panel reloaded) means nothing to show. A finished run has no tabs left either: the shell answers false.
      if (session === undefined && input !== null && typeof input === "object" && isIsolatedBrowseCall(input as Record<string, unknown>)) return;
    }
    await browser.revealAgentTab(session);
  } catch {
    // A click must never fail because the shell could not switch tabs.
  }
}
