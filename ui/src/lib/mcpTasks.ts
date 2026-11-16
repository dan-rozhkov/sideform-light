// The panel side of the MCP agent bridge: maps `McpPanelRequest`s onto chatStore and the session actions.
// A task is an ordinary chat with `source: "mcp"`; its id is the chat id. Pure parts (status, result,
// question, traces) are exported and unit-tested; `createMcpTaskHandler` holds the little state it needs.

import type { UIMessage } from "ai";
import { findPendingAskUser, hasPendingAskUser } from "@/components/chat/pendingAskUser";
import { takeInitialMessages } from "@/lib/chats/desktopChatPersistence";
import type { McpPanelReply, McpPanelRequest, TaskState, TaskStatus, TaskTrace } from "@/lib/mcpTypes";
import { isMcpTaskChat, useChatStore, type ChatSummary } from "@/store/chatStore";

export const MAX_ACTIVE_MCP_TASKS = 3;
export const MAX_ACTIVE_SCHEDULE_CHATS = 3;
export const MAX_PROMPT_CHARS = 20_000;
export const MAX_TITLE_CHARS = 200;
export const MAX_ANSWERS = 50;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface TaskStatusInput {
  /** The session is running a turn (live read, falls back to the chat summary). */
  busy: boolean;
  /** A launch payload is still queued: the first message has not gone out yet. */
  launchQueued: boolean;
  /** The session's last turn error, if any. */
  error?: string;
  /** The current or last turn was ended by a Stop (in the app or over MCP) and nothing re-armed it. */
  stopped: boolean;
  /** This session sent or continued a turn in this page lifetime (false for a chat restored after a reload). */
  ranSinceMount: boolean;
  messages: UIMessage[];
}

function hasUnresolvedCalls(message: UIMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  return message.parts.some(
    (p) =>
      (p.type.startsWith("tool-") || p.type === "dynamic-tool") &&
      "state" in p &&
      (p.state === "input-available" || p.state === "input-streaming") &&
      !("providerExecuted" in p && p.providerExecuted),
  );
}

/**
 * The status rule, from the session's own state, in this order:
 * needs_answer (a pending ask_user, stopped or not: answering resumes the agent) > running (busy, or the
 * first message still queued) > error (the session error) > stopped (stopped, or a user message last: an
 * in-app Stop, a rollback, a reload mid-turn) > running (unresolved tool calls, this session ran a turn
 * since mount: the gap before an awaited tool output lands) > stopped (unresolved tool calls in a chat
 * restored after a reload) > done (the last message is an assistant message with no unresolved tool
 * calls) > stopped (nothing at all).
 */
export function computeTaskStatus(input: TaskStatusInput): TaskStatus {
  const { messages } = input;
  const last = messages.at(-1);
  if (hasPendingAskUser(messages)) return "needs_answer";
  if (input.busy || input.launchQueued) return "running";
  if (input.error) return "error";
  if (input.stopped) return "stopped";
  if (last && last.role === "assistant") {
    if (!hasUnresolvedCalls(last)) return "done";
    return input.ranSinceMount ? "running" : "stopped";
  }
  return "stopped";
}

/** Text of the last assistant message (its text parts joined), or undefined when there is none. */
export function extractResult(messages: UIMessage[]): string | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return undefined;
  const text = last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof (p as { text?: unknown }).text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  return text || undefined;
}

/** The questions of the pending ask_user, as the form shows them. */
export function extractQuestion(messages: UIMessage[]): { questions: unknown[] } | undefined {
  const pending = findPendingAskUser(messages);
  return pending ? { questions: pending.input.questions } : undefined;
}

const traceCache = new WeakMap<UIMessage, { sig: string; traces: TaskTrace[] }>();

function tracesOfMessage(m: UIMessage): TaskTrace[] {
  // A cheap signature (no JSON work): parts can grow, and a tool part gains its output in place.
  let withOutput = 0;
  for (const p of m.parts) if (p.type.startsWith("tool-") && (p as { output?: unknown }).output !== undefined) withOutput += 1;
  const sig = `${m.parts.length}:${withOutput}`;
  const cached = traceCache.get(m);
  if (cached && cached.sig === sig) return cached.traces;
  const traces: TaskTrace[] = [];
  for (const p of m.parts) {
    if (!p.type.startsWith("tool-") || !("output" in p)) continue;
    let value: unknown = (p as { output?: unknown }).output;
    if (typeof value === "string") {
      if (!value.includes('"trace"')) continue;
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (!value || typeof value !== "object") continue;
    const rec = value as { trace?: unknown; status?: unknown };
    const id = rec.trace && typeof rec.trace === "object" ? (rec.trace as { id?: unknown }).id : undefined;
    if (typeof id !== "string" || !id) continue;
    traces.push({ traceId: id, ...(typeof rec.status === "string" ? { status: rec.status } : {}) });
  }
  traceCache.set(m, { sig, traces });
  return traces;
}

/** Browse trace ids found in tool outputs (`{ trace: { id } }` of a browse_agent result). Best effort; parsed once per message. */
export function extractTraces(messages: UIMessage[]): TaskTrace[] {
  const out: TaskTrace[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const t of tracesOfMessage(m)) {
      if (seen.has(t.traceId)) continue;
      seen.add(t.traceId);
      out.push(t);
    }
  }
  return out;
}

export function buildTaskState(
  chat: Pick<ChatSummary, "id" | "title" | "updatedAt">,
  input: TaskStatusInput,
  withTraces = true,
): TaskState {
  const status = computeTaskStatus(input);
  const state: TaskState = {
    taskId: chat.id,
    title: chat.title,
    status,
    updatedAt: chat.updatedAt,
    traces: withTraces ? extractTraces(input.messages) : [],
  };
  if (status === "needs_answer") {
    const question = extractQuestion(input.messages);
    if (question) state.question = question;
  }
  if (status === "done") {
    const result = extractResult(input.messages);
    if (result !== undefined) state.result = result;
  }
  if (status === "error") state.error = input.error;
  return state;
}

function validTaskId(value: unknown): value is string {
  return typeof value === "string" && TASK_ID_RE.test(value);
}

export interface McpTaskHandler {
  handle(request: McpPanelRequest): Promise<McpPanelReply>;
}

/** The handler `penAgentPanel.mcp.onRequest` runs. State: the ids this panel has seen. */
export function createMcpTaskHandler(): McpTaskHandler {
  const known = new Set<string>();

  const store = () => useChatStore.getState();

  const messagesOf = (id: string): UIMessage[] => store().sessionActions[id]?.getMessages() ?? takeInitialMessages(id) ?? [];

  const inputOf = (chat: ChatSummary): TaskStatusInput => {
    const run = store().sessionActions[chat.id]?.getRunState();
    return {
      busy: run ? run.busy : chat.isBusy,
      launchQueued: (run?.launchQueued ?? false) || store().launchQueue[chat.id] !== undefined,
      error: run?.error,
      stopped: run?.stopped ?? false,
      ranSinceMount: run?.ranSinceMount ?? false,
      messages: messagesOf(chat.id),
    };
  };

  const stateOf = (chat: ChatSummary, withTraces = true): TaskState => buildTaskState(chat, inputOf(chat), withTraces);
  const statusOf = (chat: ChatSummary): TaskStatus => computeTaskStatus(inputOf(chat));

  const mcpChats = () => store().chats.filter((c) => c.source === "mcp");

  const find = (taskId: unknown): ChatSummary | { error: string } => {
    if (!validTaskId(taskId)) return { error: "Invalid task id" };
    const chat = mcpChats().find((c) => c.id === taskId);
    if (chat) {
      known.add(taskId);
      return chat;
    }
    return { error: known.has(taskId) ? "Task was deleted" : "Unknown task" };
  };

  const isExecuting = (chat: ChatSummary): boolean => {
    const run = store().sessionActions[chat.id]?.getRunState();
    return (run ? run.busy : chat.isBusy) || (run?.launchQueued ?? false) || store().launchQueue[chat.id] !== undefined;
  };

  const isOpen = (s: TaskStatus) => s === "running" || s === "needs_answer";

  function start(req: Extract<McpPanelRequest, { op: "start" }>): McpPanelReply {
    const prompt = typeof req.prompt === "string" ? req.prompt.trim() : "";
    if (!prompt || req.prompt.length > MAX_PROMPT_CHARS) return { error: `Prompt must be 1 to ${MAX_PROMPT_CHARS} characters` };
    if (req.title !== undefined && (typeof req.title !== "string" || req.title.length > MAX_TITLE_CHARS)) {
      return { error: `Title must be at most ${MAX_TITLE_CHARS} characters` };
    }
    // Count and create in one synchronous step: two concurrent starts cannot both pass the cap.
    const active = mcpChats().filter((c) => isOpen(statusOf(c))).length;
    if (active >= MAX_ACTIVE_MCP_TASKS) {
      return { error: `${MAX_ACTIVE_MCP_TASKS} tasks are already running. Wait for one to finish or stop one.` };
    }
    const s = store();
    const id = s.createChat({ activate: false, source: "mcp" });
    const title = req.title?.trim();
    if (title) s.setChatTitle(id, title);
    s.queueLaunchPayload(id, { text: prompt });
    s.markChatUnread(id);
    known.add(id);
    const chat = store().chats.find((c) => c.id === id)!;
    return { task: stateOf(chat, false) };
  }

  function scheduleStart(req: Extract<McpPanelRequest, { op: "schedule-start" }>): McpPanelReply {
    if (typeof req.scheduleId !== "string" || !TASK_ID_RE.test(req.scheduleId)) return { error: "Invalid schedule id" };
    const prompt = typeof req.prompt === "string" ? req.prompt.trim() : "";
    if (!prompt || req.prompt.length > MAX_PROMPT_CHARS) return { error: `Prompt must be 1 to ${MAX_PROMPT_CHARS} characters` };
    if (typeof req.title !== "string" || req.title.length > MAX_TITLE_CHARS) {
      return { error: `Title must be at most ${MAX_TITLE_CHARS} characters` };
    }
    if (req.previousChatId !== undefined && !validTaskId(req.previousChatId)) return { error: "Invalid previous chat id" };
    if (req.previousChatId) {
      const previous = store().chats.find((c) => c.id === req.previousChatId);
      if (previous && isOpen(statusOf(previous))) return { error: "The previous run is still running", code: "busy" };
    }
    // Global cap: only runs that are executing right now (busy or launch queued). A chat that waits for an
    // answer does not hold a slot. Cheap check, no message scan.
    const active = store().chats.filter((c) => c.source === "schedule" && isExecuting(c)).length;
    if (active >= MAX_ACTIVE_SCHEDULE_CHATS) {
      return { error: `${MAX_ACTIVE_SCHEDULE_CHATS} scheduled runs are executing right now. Try again when one finishes`, code: "busy" };
    }
    const s = store();
    const id = s.createChat({ activate: false, source: "schedule" });
    const title = req.title.trim();
    if (title) s.setChatTitle(id, title);
    s.queueLaunchPayload(id, { text: prompt });
    s.markChatUnread(id);
    const chat = store().chats.find((c) => c.id === id)!;
    return { task: stateOf(chat, false) };
  }

  function answer(req: Extract<McpPanelRequest, { op: "answer" }>): McpPanelReply {
    const chat = find(req.taskId);
    if ("error" in chat) return chat;
    if (!Array.isArray(req.answers) || req.answers.length > MAX_ANSWERS) return { error: "Invalid answers" };
    for (const a of req.answers) {
      const okValue = typeof a?.value === "string" || (Array.isArray(a?.value) && a.value.every((v) => typeof v === "string"));
      if (!a || typeof a.id !== "string" || !okValue || (a.note !== undefined && typeof a.note !== "string")) {
        return { error: "Invalid answers" };
      }
    }
    const actions = store().sessionActions[chat.id];
    if (!actions) return { error: "Task is not ready yet" };
    const result = actions.answerAskUser(req.answers);
    if ("error" in result) return result;
    return { ok: true };
  }

  function message(req: Extract<McpPanelRequest, { op: "message" }>): McpPanelReply {
    const chat = find(req.taskId);
    if ("error" in chat) return chat;
    const text = typeof req.text === "string" ? req.text.trim() : "";
    if (!text || req.text.length > MAX_PROMPT_CHARS) return { error: `Text must be 1 to ${MAX_PROMPT_CHARS} characters` };
    if (hasPendingAskUser(messagesOf(chat.id))) return { error: "Answer the pending question with answer_question first" };
    const status = statusOf(chat);
    if (isOpen(status)) return { error: "Task is still running. Wait for it, answer its question or stop it." };
    const actions = store().sessionActions[chat.id];
    if (!actions) return { error: "Task is not ready yet" };
    const result = actions.sendText(text);
    if ("error" in result) return result;
    return { ok: true };
  }

  function stop(req: Extract<McpPanelRequest, { op: "stop" }>): McpPanelReply {
    const chat = find(req.taskId);
    if ("error" in chat) return chat;
    const status = statusOf(chat);
    if (!isOpen(status)) return { ok: true };
    // A start that never went out must not go out later.
    if (store().launchQueue[chat.id] !== undefined) store().consumeLaunchPayload(chat.id);
    store().sessionActions[chat.id]?.stop();
    return { ok: true };
  }

  function list(req: Extract<McpPanelRequest, { op: "list" }>): McpPanelReply {
    const limit = Number.isInteger(req.limit) && req.limit >= 1 && req.limit <= 100 ? req.limit : 20;
    const tasks = [...mcpChats()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((c) => {
        known.add(c.id);
        return { taskId: c.id, title: c.title, status: statusOf(c), updatedAt: c.updatedAt };
      });
    return { tasks };
  }

  return {
    async handle(request) {
      try {
        switch (request?.op) {
          case "start":
            return start(request);
          case "get": {
            const chat = find(request.taskId);
            return "error" in chat ? chat : { task: stateOf(chat) };
          }
          case "answer":
            return answer(request);
          case "message":
            return message(request);
          case "stop":
            return stop(request);
          case "list":
            return list(request);
          case "schedule-start":
            return scheduleStart(request);
          default:
            return { error: "Unknown request" };
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Request failed" };
      }
    },
  };
}

type ActivitySink = (chatId: string) => void;
let activitySink: ActivitySink | null = null;

/** Called by a mounted chat session when its messages, error or busy state changed. No-op without the bridge. */
export function reportChatActivity(chatId: string): void {
  activitySink?.(chatId);
}

export const NOTIFY_THROTTLE_MS = 250;

/**
 * Registers the handler with the shell and forwards activity of MCP task chats to `notifyChanged`
 * (at most once per NOTIFY_THROTTLE_MS per task). Returns the cleanup. Does nothing without the bridge.
 */
export function startMcpBridge(): () => void {
  const mcp = window.penAgentPanel?.mcp;
  if (!mcp || typeof mcp.onRequest !== "function") return () => {};
  const handler = createMcpTaskHandler();
  const off = mcp.onRequest((req) => handler.handle(req));
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const sink: ActivitySink = (chatId) => {
    if (timers.has(chatId)) return;
    if (!isMcpTaskChat(chatId)) return;
    timers.set(
      chatId,
      setTimeout(() => {
        timers.delete(chatId);
        try {
          window.penAgentPanel?.mcp?.notifyChanged(chatId);
        } catch {
          // The shell is gone; nothing to wake.
        }
      }, NOTIFY_THROTTLE_MS),
    );
  };
  activitySink = sink;
  return () => {
    if (activitySink === sink) activitySink = null;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    if (typeof off === "function") off();
  };
}
