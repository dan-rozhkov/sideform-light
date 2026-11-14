import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { createToolExecutor } from "@sideform/agent-harness/executor";
import type { RetryState } from "@sideform/agent-harness/retry-fetch";
import { browseTaskInnerBoundMs } from "@sideform/browser-agent/loop";
import { isOffline, OFFLINE_MESSAGE } from "@/lib/apiBase";
import { getRequestUserId } from "@/lib/auth/authState";
import { createChatTransport, resolveChatApiUrl, CLIENT_CAPABILITIES } from "@/lib/chatTransport";
import { resolveSessionModel } from "@/lib/sessionModel";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useChatStore } from "@/store/chatStore";
import { toolHandlers, type ToolExecutionContext, type ToolHandler } from "@/lib/toolRegistry";
import type { ChatLaunchPayload } from "@/types/chat";
import type { UIMessage } from "ai";
import { isIsolatedBrowseCall } from "@/lib/tools/browser/isolation";
import { BROWSE_AGENT_OUTER_TIMEOUT_MS } from "@/lib/tools/browser/browseAgent";
import { useOwnedChat } from "@/hooks/useOwnedChat";
import { notifyChatState } from "@/lib/chats/desktopChatPersistence";

const STREAM_RENDER_THROTTLE_MS = 50;

// Re-exported for tests (the implementation lives in lib/chatTransport.ts).
export { resolveChatApiUrl };

// Re-exported for tests (the implementation lives in lib/sessionModel.ts).
export { resolveSessionModel };

/**
 * The per-request body fields: the picked model, the anonymous user id, and the client capabilities.
 * The main chat always runs in the `browser` agent mode (no canvas context, memory or skills). Exported for tests.
 */
export function buildChatBody(sessionId?: string): object {
  return {
    agentMode: "browser",
    model: resolveSessionModel(sessionId),
    userId: getRequestUserId(),
    clientCapabilities: CLIENT_CAPABILITIES,
  };
}

// Default budget for a tool call before we give up and report a timeout to
// the model. Per-tool overrides live in TOOL_CALL_TIMEOUT_MS_OVERRIDES below.
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 30_000;

/** Margin the chat-side browse_task timeout keeps above the loop's own
 * bound (`browseTaskInnerBoundMs`, the REAL bound on the call). */
const BROWSE_TASK_OUTER_MARGIN_MS = 60_000;

const TOOL_CALL_TIMEOUT_MS_OVERRIDES: Record<string, number> = {
  // browse_task (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-
  // design.md §3) runs a whole snapshot/step/perform loop internally bounded
  // by its own BROWSE_TASK_DEADLINE_MS = 90_000. That would not fit under
  // the 30s default — this client-side timeout would fire and report a
  // misleading "Tool call timed out" while the loop kept running underneath
  // it.
  //
  // Finding: 100s wasn't enough margin over the loop's own worst case. The
  // loop's STEP_DEADLINE_RESERVE_MS (@sideform/browser-agent loop) only guarantees a step
  // won't START once fewer than 35s remain of the 90s internal deadline —
  // an already-started step can still take up to ~61.5s (snapshot + the
  // /api/browse/step round trip + the act/perform call itself, see that
  // constant's own comment), so the loop can finish as late as
  // 90 - 35 + 61.5 = 116.5s after it starts. 150s covers that worst case
  // with real margin, without needing to also raise the loop's own
  // BROWSE_TASK_DEADLINE_MS (see STEP_DEADLINE_RESERVE_MS's comment for why
  // that constant didn't need to move too).
  //
  // Multi-sub-goal calls (@sideform/browser-agent runBrowseTask) are bounded by
  // MULTI_SUBGOAL_DEADLINE_MS = 12 min overall, with every sub-goal's loop
  // deadline clamped to what is left of it. Same reasoning as above: the
  // last loop can end at 720 - 35 + 61.5 = 746.5s, so 780s (13 min) covers
  // it and the <=15s planning call, which runs inside the overall budget.
  // Plus settleEmptySnapshot's worst case at a sub-goal's first step
  // (@sideform/browser-agent loop, BROWSE_SETTLE_WORST_CASE_MS = 12 * (400ms + 20s snapshot)
  // = 244.8s, only on a page that stays blank): 746.5 + 244.8 = 991.3s.
  // The real bound is the handler's own internal race
  // (browseTaskInnerBoundMs() = 720 + 35 + 244.8 = 999.8s, which returns a
  // `budget` transcript and aborts the loop); this outer value is just 60s
  // above it. One value serves single- and multi-sub-goal calls (not known
  // up front).
  browse_task: browseTaskInnerBoundMs(false) + BROWSE_TASK_OUTER_MARGIN_MS,
  // browse_agent runs a whole nested chat (<= 60 model requests, each with
  // its own browse_* calls and their own timeouts). The same value applies on
  // desktop and cloud: the nested calls carry their own cloud headroom.
  browse_agent: BROWSE_AGENT_OUTER_TIMEOUT_MS,
  // browse_open (docs/superpowers/specs/2026-09-18-builtin-browser-design.md
  // §5) reuses the desktop's own BROWSER_OPEN_TIMEOUT_MS = 45_000 navigation
  // budget, and — since browse-speed-contract.md's "Frontend" item 2 — also
  // takes an extra browser.snapshot() call afterward (up to the desktop's
  // 20s BROWSER_COMMAND_TIMEOUT_MS) to attach a fresh `snapshot`. 45 + 20 =
  // 65s worst case; 70s covers that with margin, comfortably above the
  // contract's "≥ 50s" floor.
  browse_open: 70_000,
  // browse_act (docs/superpowers/specs/2026-09-23-full-browser-use-design.md,
  // "act gains actions and index targeting"; browse-speed-contract.md's
  // "Frontend" item 1 adds a 1..10-entry `actions` batch). Three worst
  // cases, and this must cover all of them:
  //   - Plain act (index/target, no `element`): the desktop shell's own
  //     BROWSER_COMMAND_TIMEOUT_MS = 20s bounds every command, including
  //     `wait`'s hard cap of 15s (`wait` polls WITHIN that same 20s command
  //     budget, not on top of it). 15s + 5s margin lands on that same 20s —
  //     this override must be at least that.
  //   - The `element` natural-language targeting path (same design doc's
  //     follow-up) does three things in sequence before the model sees a
  //     result: (1) browser.snapshot() — up to the desktop's 20s command
  //     budget; (2) an /api/browse/locate round trip — bounded by shared.ts's
  //     BROWSE_BACKEND_REQUEST_TIMEOUT_MS = 20s, which (per shared.ts's
  //     fetchBrowseBackend) now covers the response body read too, not just
  //     the fetch; (3) the act command itself — the desktop's 20s command
  //     budget plus its ~1.5s cursor-move budget (CURSOR_TIMEOUT_MS in
  //     pen-editor-desktop/src/main/browser/controller.ts) for a
  //     click/type/select/hover/press that moves the visible cursor first.
  //     20 + 20 + 21.5 = 61.5s worst case. 65s used to cover this alone.
  //   - An `actions` batch: up to 10 entries, each individually as expensive
  //     as the plain-act worst case above (~21.5s for a cursor-moving act),
  //     plus one more snapshot at the end for the batch-level `snapshot`
  //     field. 65s stopped being enough the moment batching landed — the
  //     contract calls for raising this override to 120s rather than trying
  //     to size it for the full 10×21.5s+20s ≈ 235s worst case, since that
  //     would make one runaway batch dominate the whole tool-call budget;
  //     120s is a deliberate compromise, not a hard cap derived from the
  //     batch math.
  // Finding: at 120s, that compromise wasn't actually being enforced —
  // runActionsBatch's own internal BATCH_DEADLINE_MS was 100s, which left
  // only ~20s of margin against a single entry's own ~61.5s worst case (an
  // entry starting at t=99s could finish around t=160s). BATCH_DEADLINE_MS
  // is now tightened to 60s (BATCH_DEADLINE_MS in
  // @sideform/browser-agent/agent/execute, run by its runActionsBatch), and the trailing snapshot
  // call is skipped once that internal deadline has passed, so this 120s
  // client-side budget stays a real ceiling rather than an aspirational one.
  browse_act: 120_000,
  // browse_tabs (same design doc) with `action: "new"` and a `url` reuses
  // browse_open's ~65s worst case (see browse_open's override above), so it
  // needs the same headroom as browse_open — 70s leaves margin above that.
  browse_tabs: 70_000,
  // browse_fill_login: the desktop chains a snapshot, 2x TYPE_TEXT and an
  // optional press, each bounded by the 20s command budget (cursor-move
  // budget included). Like browse_act's reasoning, worst case is a few
  // sequential 20s commands; 90s leaves margin without being unbounded.
  browse_fill_login: 90_000,
};

export function getToolCallTimeoutMs(toolName: string, _input?: unknown): number {
  return TOOL_CALL_TIMEOUT_MS_OVERRIDES[toolName] ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
}

// The finished message's `metadata` is typed `unknown` (useChat isn't given
// a messageMetadataSchema) — this is the sole place that trusts its shape.
// `contextTokens` is the backend's actual input-token count for the turn's
// last step (see chat.ts's `finish` chunk); a non-positive or missing value
// means "nothing to report" rather than a real reading of zero context use.
// Exported for tests.
export function extractContextTokens(metadata: unknown): number | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const { contextTokens } = metadata as { contextTokens?: unknown };
  return typeof contextTokens === "number" && contextTokens > 0
    ? contextTokens
    : undefined;
}

// Exported for tests. `source` distinguishes the chat UI path from the MCP
// WebSocket/desktop IPC bridge paths (`src/lib/mcpDispatch.ts`), which all
// funnel through this single choke point but can't otherwise be told apart
// from inside it — callers must say which they are. Defaults to "bridge"
// since `onToolCall` below is the one call site that passes "chat"
// explicitly; every other caller is a bridge.
//
// The generic mechanics (serialization, timeout race, signal merging, error
// shaping) live in @sideform/agent-harness; only the app policy is here.
//
// Serialized at the funnel, rather than at each call site: chat, both MCP
// bridges and the WebMCP surface all arrive through here, so "two agents
// cannot interleave scene mutations" is true by construction. Read-only tools
// are not queued (see toolCallQueue.ts). The timeout starts inside the queued
// task so a call that waited behind a long batch_design still gets its full
// budget.
type ToolCallSource = "chat" | "browse_agent";

const CANCELLED_RESULT = JSON.stringify({ error: "Tool call cancelled" });

// Checked inside the queued task (the harness invokes the handler there), so a
// call cancelled or timed out by its caller while it waited behind a long batch
// never runs and never mutates anything.
const withAbortedCheck =
  (handler: ToolHandler | undefined): ToolHandler | undefined =>
  handler &&
  ((args, ctx) => {
    if (ctx?.signal?.aborted) return Promise.resolve(CANCELLED_RESULT);
    return handler(args, ctx);
  });

// A per-call budget (`ctx.timeoutMs`, set by executeToolCall) wins over the
// tool's default.
const executeWithHarness = createToolExecutor<ToolExecutionContext, ToolCallSource>({
  resolveHandler: (toolName) => withAbortedCheck(toolHandlers[toolName]),
  timeoutMs: (toolName, input) => getToolCallTimeoutMs(toolName, input),
});

export function executeToolCall(
  toolName: string,
  input: unknown,
  context?: ToolExecutionContext,
  source: ToolCallSource = "chat",
): Promise<string> {
  return executeWithHarness(toolName, input, context, source);
}

interface UseDesignChatOptions {
  sessionId: string;
}

function cloneLaunchPayload(payload: ChatLaunchPayload): ChatLaunchPayload {
  return {
    text: payload.text,
    images: payload.images?.map((image) => ({ ...image })),
  };
}

/** True when the last assistant message has a tool call with its input complete
 * but no output yet (`input-available`). A request carrying one fails the
 * backend's tool-result check; `input-streaming` parts are dropped by
 * `convertToModelMessages` and do not count. */
export function hasUnresolvedToolCalls(messages: UIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return false;
  return last.parts.some(
    (p) =>
      (p.type.startsWith("tool-") || p.type === "dynamic-tool") &&
      "state" in p &&
      p.state === "input-available" &&
      !("providerExecuted" in p && p.providerExecuted),
  );
}

/** Two sends that landed during one interrupt, as one message: texts joined by
 * a blank line, images concatenated. */
function mergePayloads(first: ChatLaunchPayload, second: ChatLaunchPayload): ChatLaunchPayload {
  const images = [...(first.images ?? []), ...(second.images ?? [])].map((image) => ({ ...image }));
  return {
    text: [first.text.trim(), second.text.trim()].filter(Boolean).join("\n\n"),
    images: images.length > 0 ? images : undefined,
  };
}

// One instance: the offline error carries no per-attempt information, and a
// stable identity keeps it from re-rendering consumers that memo on `error`.
const OFFLINE_SEND_ERROR = new Error(OFFLINE_MESSAGE);

// A live isolated QA run: its tool call is answered later (not awaited in
// onToolCall). `settle(output)` answers it once; `settle(null)` forgets it
// without writing (its tool part is gone). Later calls are ignored.
interface LiveRun {
  controller: AbortController;
  settle: (output: string | null) => void;
}

const ABORTED_RUN_OUTPUT = JSON.stringify({ status: "aborted", steps: 0 });

export function useDesignChat({ sessionId }: UseDesignChatOptions) {
  const [input, setInput] = useState("");
  // Set when a send is refused because the browser is offline. The error
  // itself is DERIVED from this plus live connectivity (see `offlineError`
  // below) rather than stored: an "you are offline" banner is stale the
  // moment the connection is back, so nothing has to clear it — in
  // particular the send-drain effect doesn't, which is what keeps that
  // effect free of setState.
  const [offlineSendRefused, setOfflineSendRefused] = useState(false);

  // Non-null while the transport is auto-retrying a network failure; drives
  // the neutral "retrying…" status line instead of the red error banner.
  const [retryState, setRetryState] = useState<RetryState | null>(null);

  const transport = useMemo(
    () =>
      createChatTransport({
        body: () => buildChatBody(sessionId),
        onRetryStateChange: setRetryState,
      }),
    // Built once per mounted session: the model (and everything else in the
    // body) is read fresh from the stores on every send, keyed by this
    // session's own id.
    [sessionId]
  );

  const setContextTokens = useChatStore((s) => s.setContextTokens);

  // True from a terminal-abandonment path (`clearStreamingToolSession`: user
  // Stop, external abort, failed request, unmount) until the next request
  // starts (the "submitted" effect below resets it). `Chat.stop()` settles
  // `status` to "ready" while `onToolCall` may still be awaiting a Jev taste
  // check, and the `addToolOutput` it then issues would otherwise satisfy
  // `sendAutomaticallyWhen` and resume the turn the user just stopped. The
  // output itself must still be written (an `input-available` part with no
  // output makes every later request fail with MissingToolResultsError), so
  // the gate is on the auto-send, not on `addToolOutput`.
  const turnStoppedRef = useRef(false);

  // Isolated QA browse_agent runs started by this session and not yet settled.
  // Their onToolCall returns at once (like ask_user) so several run together,
  // which lets the stream finish and `chat.status` read "ready" while they work.
  // The count keeps the session reading as busy: status/isLoading, Send (which
  // interrupts) and the send drain all key off it, or a new request would go
  // out with unresolved tool parts. Auto-continuation needs no gate: the SDK sends once
  // every tool call of the step has an output (addToolOutput below).
  // The ONE source of "tool work is open": toolCallId -> abort of each live run.
  // `parallelBrowseRuns` mirrors its size for rendering; callbacks read the ref.
  const livePendingRunsRef = useRef<Map<string, LiveRun>>(new Map());
  // A message sent while the agent was busy: the send interrupts the turn (same
  // as Stop) and parks the message here until the stop settles; the drain
  // effect below delivers it. Two sends during one interrupt are merged. A user
  // Stop, Clear chat/rollback and unmount drop it.
  const pendingInterruptSendRef = useRef<ChatLaunchPayload | null>(null);
  const [parallelBrowseRuns, setParallelBrowseRuns] = useState(0);

  // Owned, not created by useChat: see useOwnedChat for why unmount must not
  // stop the chat.
  const ownedChat = useOwnedChat({
    id: sessionId,
    transport,
    sendAutomaticallyWhen: (options) =>
      !turnStoppedRef.current && lastAssistantMessageIsCompleteWithToolCalls(options),
    // Feeds ContextMeter (components/chat/ContextMeter.tsx). This session's
    // OWN id, not the active chat — a background session finishing a turn
    // must update its own reading, never whatever chat the user happens to
    // be looking at (same reasoning as resolveSessionModel above).
    onFinish: ({ message }) => {
      const contextTokens = extractContextTokens(message.metadata);
      if (contextTokens !== undefined) {
        setContextTokens(sessionId, contextTokens);
      }
    },
    onToolCall: async ({ toolCall }) => {
      // ask_user is answered by the in-chat form (AskUserForm), which calls
      // addToolOutput on submit. Leaving the part unresolved keeps the turn
      // paused (sendAutomaticallyWhen only fires once every tool call has an
      // output), which is exactly the desired human-in-the-loop behavior.
      if (toolCall.toolName === "ask_user") {
        return;
      }
      // Isolated QA runs: start, do not await. Everything else stays awaited.
      if (toolCall.toolName === "browse_agent" && isIsolatedBrowseCall((toolCall.input ?? {}) as Record<string, unknown>)) {
        startParallelBrowseRun(toolCall);
        return;
      }
      // Every tool call gets the turn's abort signal (browse_task runs for
      // minutes): every terminal-abandonment path (user Stop, external abort,
      // failed request, unmount — all via clearStreamingToolSession) aborts
      // it. Created already aborted if the turn was stopped meanwhile.
      const toolAbort = new AbortController();
      if (turnStoppedRef.current) toolAbort.abort();
      pendingToolCallAbortsRef.current.add(toolAbort);
      let handlerResult: string;
      try {
        handlerResult = await executeToolCall(
          toolCall.toolName,
          toolCall.input,
          { sessionId, toolCallId: toolCall.toolCallId, signal: toolAbort.signal },
          "chat",
        );
      } finally {
        pendingToolCallAbortsRef.current.delete(toolAbort);
      }
      chat.addToolOutput({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: handlerResult,
      });
    },
  });
  const chat = useChat({
    chat: ownedChat,
    // AI SDK otherwise publishes a React update for every stream chunk. A
    // short throttle keeps active Markdown rendering responsive while still
    // feeling continuous, especially when multiple sessions run in parallel.
    throttle: STREAM_RENDER_THROTTLE_MS,
  });

  // Desktop chat storage (no-op without the shell's bridge): hand the Chat to the persistence module.
  // It keeps the handle until the chat is deleted and subscribes to the Chat itself, so once per Chat is enough.
  useEffect(() => {
    notifyChatState(sessionId, ownedChat);
  }, [sessionId, ownedChat]);

  // Same timeout / error handling as the awaited path (executeToolCall owns
  // both). The output is ALWAYS written, even after Stop (an input-available
  // part with no output poisons later requests): Stop and Clear chat answer it
  // "aborted" at once (see LiveRun). The concurrency cap lives in the browse_agent
  // handler (browseAgent.ts), so a run waiting for a slot sits inside executeToolCall.
  function startParallelBrowseRun(toolCall: { toolName: string; toolCallId: string; input: unknown }): void {
    const toolAbort = new AbortController();
    if (turnStoppedRef.current) toolAbort.abort();
    const id = toolCall.toolCallId;
    let settled = false;
    const settle = (output: string | null) => {
      if (settled) return;
      settled = true;
      void (async () => {
        try {
          // Awaited: the run stays "live" until the message update has landed, so
          // busy never reads false while the part still lacks its output.
          if (output !== null) await chat.addToolOutput({ tool: toolCall.toolName, toolCallId: id, output });
        } catch {
          // The transcript was cleared or replaced meanwhile: nothing to write to.
        } finally {
          livePendingRunsRef.current.delete(id);
          setParallelBrowseRuns(livePendingRunsRef.current.size);
        }
      })();
    };
    livePendingRunsRef.current.set(id, { controller: toolAbort, settle });
    setParallelBrowseRuns(livePendingRunsRef.current.size);
    void executeToolCall(toolCall.toolName, toolCall.input, { sessionId, toolCallId: id, signal: toolAbort.signal }, "chat")
      .catch((err: unknown) => JSON.stringify({ error: err instanceof Error ? err.message : "Tool call failed" }))
      .then(settle);
  }

  // `setMessages` that drops the tool call of a live run (Clear chat, rollback)
  // aborts that run and forgets it: its output has nowhere to go. Handles the
  // updater form too (the next list is computed first).
  const { setMessages: setChatMessages } = chat;
  const setMessages = useCallback(
    (update: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])): void => {
      // Replacing the history (Clear chat, rollback) retires a send parked
      // behind an interrupt: it was written against the old transcript.
      pendingInterruptSendRef.current = null;
      // The SDK's own latest state feeds the updater; the abort is a side effect
      // of computing the next list (idempotent, so a repeated call is harmless).
      setChatMessages((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        if (livePendingRunsRef.current.size > 0) {
          const kept = new Set<string>();
          for (const m of next) for (const p of m.parts) if ("toolCallId" in p) kept.add(String(p.toolCallId));
          for (const [id, run] of [...livePendingRunsRef.current]) {
            if (kept.has(id)) continue;
            run.controller.abort();
            run.settle(null);
          }
        }
        return next;
      });
    },
    [setChatMessages]
  );

  // Drives re-running the send-drain effect below once connectivity returns
  // (see the effect for why offline must not consume a pending send).
  const isOnline = useOnlineStatus();

  // Register/unregister abort capability for this session
  const registerAbortController = useChatStore((s) => s.registerAbortController);
  const unregisterAbortController = useChatStore((s) => s.unregisterAbortController);
  const consumeLaunchPayload = useChatStore((s) => s.consumeLaunchPayload);
  // Live isolated runs (render-time mirror of livePendingRunsRef).
  const toolsBusy = parallelBrowseRuns > 0;
  const abortControllerRef = useRef<AbortController | null>(null);

  // In-flight tool calls' AbortControllers (see onToolCall), aborted on every terminal-abandonment path.
  const pendingToolCallAbortsRef = useRef<Set<AbortController>>(new Set());

  // Terminal paths (user Stop, an external abort, a failed request, unmount): block auto-continuation and
  // abort every in-flight tool call and live isolated run.
  const clearStreamingToolSession = useCallback(() => {
    turnStoppedRef.current = true;
    for (const controller of pendingToolCallAbortsRef.current) {
      controller.abort();
    }
    for (const run of [...livePendingRunsRef.current.values()]) {
      run.controller.abort();
      run.settle(ABORTED_RUN_OUTPUT);
    }
  }, []);

  // Any new request (a user send, the send drain, a network retry) re-arms
  // auto-continuation — see `turnStoppedRef`.
  useEffect(() => {
    if (chat.status === "submitted") turnStoppedRef.current = false;
  }, [chat.status]);

  useEffect(() => {
    // Create an AbortController that calls chat.stop() when aborted
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const onAbort = () => {
      clearStreamingToolSession();
      chat.stop();
    };
    controller.signal.addEventListener("abort", onAbort);

    registerAbortController(sessionId, controller);

    return () => {
      controller.signal.removeEventListener("abort", onAbort);
      unregisterAbortController(sessionId);
      pendingInterruptSendRef.current = null;
      clearStreamingToolSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, registerAbortController, unregisterAbortController]);

  // A failed request ends the turn: abort what is still running.
  useEffect(() => {
    if (chat.status === "error") clearStreamingToolSession();
  }, [chat.status, clearStreamingToolSession]);

  // Hands a payload to the transport. Writes no React state of its own, so
  // the send-drain effect below can call it directly without triggering a
  // cascading render (react-hooks/set-state-in-effect). Callers are
  // responsible for the preconditions `sendPayload` checks: connectivity and
  // a chat that is actually ready to take a message.
  const deliverPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const text = payload.text.trim();
      const images = payload.images;
      if (!text && (!images || images.length === 0)) {
        return false;
      }

      if (images && images.length > 0) {
        const parts: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; url: string }> = [];
        for (const img of images) {
          const mediaType = img.dataUrl.match(/^data:(image\/[^;]+);/)?.[1] ?? "image/png";
          parts.push({ type: "file", mediaType, url: img.dataUrl });
        }
        if (text) {
          parts.push({ type: "text", text });
        }
        chat.sendMessage({ parts });
      } else {
        chat.sendMessage({ text });
      }
      return true;
    },
    [chat]
  );

  // Same as the user's Stop: drop in-flight streaming-tool state, then stop.
  const abortTurn = useCallback(() => {
    clearStreamingToolSession();
    void chat.stop();
  }, [chat, clearStreamingToolSession]);

  const sendPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const text = payload.text.trim();
      const images = payload.images;
      if (!text && (!images || images.length === 0)) {
        return false;
      }
      // Fail fast and locally instead of issuing a request that will hang or
      // reject once the browser notices it has no connection.
      if (isOffline()) {
        setOfflineSendRefused(true);
        return false;
      }
      // The agent is busy: live isolated QA runs, or a request in flight. The
      // send interrupts the turn exactly like Stop and the message is parked
      // until the stop settles (the drain effect below). The caller (ChatInput)
      // treats `true` as "accepted" and clears the composer. A second send
      // during the same interrupt is merged into the first: nothing is dropped.
      if (
        livePendingRunsRef.current.size > 0 ||
        chat.status === "submitted" ||
        chat.status === "streaming" ||
        chat.status === "error"
      ) {
        // An errored chat with live runs never returns to "ready" on its own.
        if (chat.status === "error") chat.clearError();
        const pending = pendingInterruptSendRef.current;
        pendingInterruptSendRef.current = pending
          ? mergePayloads(pending, payload)
          : cloneLaunchPayload(payload);
        abortTurn();
        return true;
      }
      if (chat.status !== "ready") {
        return false;
      }
      // A parked send goes out first, in one message with this one.
      const parked = pendingInterruptSendRef.current;
      if (parked) {
        pendingInterruptSendRef.current = null;
        const merged = mergePayloads(parked, payload);
        // Its tool output may still be on the way (see the drain effect):
        // park the merged message again and let the effect send it.
        if (hasUnresolvedToolCalls(chat.messages)) {
          pendingInterruptSendRef.current = merged;
          return true;
        }
        return deliverPayload(merged);
      }
      return deliverPayload(payload);
    },
    [chat, abortTurn, deliverPayload]
  );

  // Sends, at most once per "ready" transition, a message parked by an
  // interrupting send (`pendingInterruptSendRef`) or — after it — the one-shot
  // launchQueue (a parallel-tab fan-out payload). Both live in the same effect
  // with an early `return` after each send, so the two can never both fire in
  // the same tick: the user's own message wins, and the launch payload goes out
  // on the next "ready" (which the send itself will eventually cause).
  useEffect(() => {
    if (chat.status !== "ready" || !isOnline || isOffline()) {
      // Consuming while offline would delete the queued payload from the
      // store without ever sending it (sendPayload's offline guard rejects
      // it), destroying a parallel-tab launch permanently. Leave it queued;
      // the isOnline dependency reruns this effect once connectivity
      // returns, at which point it's consumed and sent normally.
      //
      // The extra live `isOffline()` check guards the narrow race where the
      // isOnline *state* is still stale-true (the browser's "offline" event
      // hasn't landed yet) but connectivity is already gone: bail here,
      // before any consume/send, so a payload is never handed to the
      // transport for a connection that is already down.
      return;
    }

    if (toolsBusy) {
      // Isolated QA runs still live: their tool parts have no output yet. Wait.
      return;
    }

    const interruptSend = pendingInterruptSendRef.current;
    if (interruptSend) {
      // After `chat.stop()` the SDK reports "ready" before an awaited
      // `onToolCall` has written its (aborted) output. Sending now would carry
      // an `input-available` part with no output, so wait: the late
      // `addToolOutput` changes `chat.messages` and reruns this effect.
      if (hasUnresolvedToolCalls(chat.messages)) return;
      pendingInterruptSendRef.current = null;
      deliverPayload(interruptSend);
      return;
    }

    const queuedPayload = consumeLaunchPayload(sessionId);
    if (queuedPayload) {
      // `deliverPayload`, not `sendPayload`: every precondition sendPayload
      // would re-check (online, status === "ready", non-empty) is already
      // established above, and going straight to the transport keeps this
      // effect from writing React state.
      deliverPayload(cloneLaunchPayload(queuedPayload));
    }
  }, [
    chat.status,
    chat.messages,
    isOnline,
    toolsBusy,
    consumeLaunchPayload,
    deliverPayload,
    sessionId,
  ]);

  const sendMessage = useCallback((): boolean => {
    const didSend = sendPayload({ text: input.trim() });
    if (didSend) {
      setInput("");
    }
    return didSend;
  }, [input, sendPayload]);

  const submitLaunchPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const didSend = sendPayload(payload);
      if (didSend && payload.text.trim() === input.trim()) {
        setInput("");
      }
      return didSend;
    },
    [input, sendPayload]
  );

  const clearError = useCallback(() => {
    setOfflineSendRefused(false);
    chat.clearError();
  }, [chat]);

  // Wraps chat.stop() so a user-initiated stop clears this session's
  // in-flight streaming-tool state first — otherwise a stale preview or
  // partially-applied mutation would keep rendering after the stream that
  // produced it was cancelled.
  const stop = useCallback(() => {
    // A message parked by an interrupting send survives a Stop: the user sent
    // it explicitly and the composer is already cleared.
    abortTurn();
  }, [abortTurn]);

  // Derived, not stored: the offline banner is exactly "a send was refused
  // and we are still offline". Coming back online retires it on its own, so
  // no send path — user-facing or the send drain — has to clear it.
  const offlineError =
    offlineSendRefused && !isOnline ? OFFLINE_SEND_ERROR : undefined;

  // Invariant: while isolated QA runs are live the hook reports "streaming" even
  // though `chat.status` is "ready" (the stream ended, the runs did not). Every
  // consumer of `status`/`isLoading` therefore treats the turn as in flight.
  const status = toolsBusy && chat.status === "ready" ? "streaming" : chat.status;

  return {
    messages: chat.messages,
    input,
    setInput,
    sendMessage,
    submitLaunchPayload,
    status,
    isLoading: status === "submitted" || status === "streaming",
    stop,
    error: offlineError ?? chat.error,
    clearError,
    setMessages,
    retryState,
    addToolOutput: chat.addToolOutput,
  };
}
