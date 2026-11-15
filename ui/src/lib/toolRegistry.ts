import type {
  ToolExecutionContext as HarnessToolExecutionContext,
  ToolHandler as HarnessToolHandler,
} from "@sideform/agent-harness/surface";
import { applyLoopGuard } from "@sideform/browser-agent/loop";
import { analyzeImage } from "./tools/analyzeImage";
import { traceFrame, traceList, traceRead } from "./tools/traceTools";
import { askUser } from "./tools/askUser";
import { scheduleCreate, scheduleDelete, scheduleList, scheduleSetEnabled } from "./tools/schedules";
import { browseOpen } from "./tools/browser/browseOpen";
import { browseAct } from "./tools/browser/browseAct";
import { browseFindImages } from "./tools/browser/browseFindImages";
import { browseRead } from "./tools/browser/browseRead";
import { browseFillLogin } from "./tools/browser/browseFillLogin";
import { browseSnapshot } from "./tools/browser/browseSnapshot";
import { browseScreenshot } from "./tools/browser/browseScreenshot";
import { browseTabs } from "./tools/browser/browseTabs";
import { browseTask } from "./tools/browser/browseTask";
import { browseAgent } from "./tools/browser/browseAgent";

/**
 * Per-call metadata threaded through to handlers that need to correlate
 * with transient, non-scene state keyed by chat session + tool call (e.g.
 * the AI vector drawing preview store). Optional and absent for direct MCP
 * bridge calls, which have no chat session.
 */
export interface ToolExecutionContext extends HarnessToolExecutionContext {
  /**
   * Isolated browser session of a browse_agent QA run. The browse_* handlers
   * pass it to `getBrowserBridge` so every nested command reaches the run's own
   * browser; the loop guard keys on it instead of `sessionId`.
   */
  browserSession?: string;
  /**
   * Set only on nested calls of a browse_agent run that records a trace: `browse_act` then runs with the package's
   * `repro: true` (its output carries `__repro` for the Playwright export). The session core strips it before the model.
   */
  repro?: boolean;
}

export type ToolHandler = HarnessToolHandler<ToolExecutionContext>;

/**
 * Wraps a browse_* handler with the loop guard (browse-speed-contract.md,
 * "Frontend" item 5 — see loopGuard in @sideform/browser-agent/loop). Applied here,
 * once, at registration — rather than inside each browse_* module — so
 * every entry point that runs a browse_* call (chat, both MCP bridges,
 * WebMCP) gets it for free, the same way `runToolCall`'s mutual exclusion
 * already does for `executeToolCall` callers. Keyed by
 * `context?.sessionId` when the caller has one (a chat turn); falls back to
 * loopGuard's own module-level ring for the rest (direct MCP bridge calls
 * have no chat session).
 */
function withBrowseLoopGuard(toolName: string, handler: ToolHandler): ToolHandler {
  return async (args, context) => {
    const result = await handler(args, context);
    return applyLoopGuard(toolName, args, result, context?.browserSession ?? context?.sessionId);
  };
}

export const toolHandlers: Record<string, ToolHandler> = {
  ask_user: askUser,
  schedule_list: scheduleList,
  // Pending until the person confirms in the chat card (useDesignChat.onToolCall); this is the fallback.
  schedule_create: scheduleCreate,
  schedule_set_enabled: scheduleSetEnabled,
  schedule_delete: scheduleDelete,
  analyze_image: analyzeImage,
  // Read-only: past browse-run traces.
  trace_list: traceList,
  trace_read: traceRead,
  trace_frame: traceFrame,
  browse_open: withBrowseLoopGuard("browse_open", browseOpen),
  browse_act: withBrowseLoopGuard("browse_act", browseAct),
  browse_find_images: withBrowseLoopGuard("browse_find_images", browseFindImages),
  browse_read: withBrowseLoopGuard("browse_read", browseRead),
  browse_snapshot: withBrowseLoopGuard("browse_snapshot", browseSnapshot),
  browse_screenshot: withBrowseLoopGuard("browse_screenshot", browseScreenshot),
  browse_tabs: withBrowseLoopGuard("browse_tabs", browseTabs),
  browse_fill_login: withBrowseLoopGuard("browse_fill_login", browseFillLogin),
  browse_task: withBrowseLoopGuard("browse_task", browseTask),
  // Deliberately NOT loop-guarded: a whole task, not one browser action. Its nested browse_* calls pass
  // through the guarded handlers above.
  browse_agent: browseAgent,
  // qa_*: browseAgent answers them locally inside a QA run; these entries refuse a call from the main chat.
  qa_verdict: async () => JSON.stringify({ error: "qa_verdict is only available inside a browse_agent QA run" }),
  qa_assert: async () => JSON.stringify({ error: "qa_assert is only available inside a browse_agent QA run" }),
};
