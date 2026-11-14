import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { useChatStore, type ChatSessionActions } from "@/store/chatStore";
import {
  buildTaskState,
  computeTaskStatus,
  createMcpTaskHandler,
  extractQuestion,
  extractResult,
  extractTraces,
  NOTIFY_THROTTLE_MS,
  reportChatActivity,
  startMcpBridge,
  type TaskStatusInput,
} from "../mcpTasks";
import type { McpPanelReply, TaskState } from "../mcpTypes";

const user = (text = "go"): UIMessage => ({ id: "u", role: "user", parts: [{ type: "text", text }] });
const asst = (parts: unknown[], id = "a"): UIMessage => ({ id, role: "assistant", parts } as UIMessage);
const text = (t: string) => ({ type: "text", text: t });
const askPending = { type: "tool-ask_user", toolCallId: "q1", state: "input-available", input: { questions: [{ id: "k", label: "K", type: "text" }] } };
const unresolved = { type: "tool-browse_agent", toolCallId: "t1", state: "input-available", input: {} };

const base = (over: Partial<TaskStatusInput> = {}): TaskStatusInput => ({
  busy: false,
  launchQueued: false,
  stopped: false,
  ranSinceMount: false,
  messages: [],
  ...over,
});

describe("computeTaskStatus", () => {
  it("needs_answer for a pending ask_user, even while busy or stopped", () => {
    expect(computeTaskStatus(base({ messages: [user(), asst([askPending])] }))).toBe("needs_answer");
    expect(computeTaskStatus(base({ busy: true, messages: [user(), asst([askPending])] }))).toBe("needs_answer");
    expect(computeTaskStatus(base({ stopped: true, messages: [user(), asst([askPending])] }))).toBe("needs_answer");
  });
  it("a stopped task with a pending ask_user reports the question", () => {
    const s = buildTaskState({ id: "c", title: "T", updatedAt: 1 }, base({ stopped: true, messages: [user(), asst([askPending])] }));
    expect(s.status).toBe("needs_answer");
    expect(s.question?.questions).toHaveLength(1);
  });
  it("unresolved tool calls: running when this session ran a turn, stopped after a reload; a Stop wins", () => {
    const msgs = [user(), asst([unresolved])];
    expect(computeTaskStatus(base({ ranSinceMount: true, messages: msgs }))).toBe("running");
    expect(computeTaskStatus(base({ ranSinceMount: false, messages: msgs }))).toBe("stopped");
    expect(computeTaskStatus(base({ ranSinceMount: true, stopped: true, messages: msgs }))).toBe("stopped");
  });
  it("running: busy or a queued launch", () => {
    expect(computeTaskStatus(base({ busy: true, messages: [user()] }))).toBe("running");
    expect(computeTaskStatus(base({ busy: true, messages: [user(), asst([unresolved])] }))).toBe("running");
    expect(computeTaskStatus(base({ launchQueued: true }))).toBe("running");
  });
  it("error when the last turn ended with an error and nothing runs", () => {
    expect(computeTaskStatus(base({ error: "boom", messages: [user()] }))).toBe("error");
    expect(computeTaskStatus(base({ error: "boom", busy: true, messages: [user()] }))).toBe("running");
  });
  it("done: the last message is an assistant message without unresolved calls", () => {
    expect(computeTaskStatus(base({ messages: [user(), asst([text("hi")])] }))).toBe("done");
  });
  it("stopped: an in-app Stop, a rollback or a reload mid-turn leave a user message or unresolved calls, not busy", () => {
    expect(computeTaskStatus(base({ messages: [user()] }))).toBe("stopped");
    expect(computeTaskStatus(base({ messages: [user(), asst([unresolved])] }))).toBe("stopped");
    expect(computeTaskStatus(base({ stopped: true, messages: [user(), asst([text("x")])] }))).toBe("stopped");
    expect(computeTaskStatus(base())).toBe("stopped");
  });
});

describe("extractors", () => {
  it("result is the text of the last assistant message", () => {
    expect(extractResult([user(), asst([text("a"), { type: "reasoning", text: "no" }, text("b")])])).toBe("ab");
    expect(extractResult([asst([text("x")]), user()])).toBeUndefined();
  });
  it("question is the pending ask_user questions", () => {
    expect(extractQuestion([user(), asst([askPending])])).toEqual({ questions: [{ id: "k", label: "K", type: "text" }] });
    expect(extractQuestion([user(), asst([text("x")])])).toBeUndefined();
  });
  it("traces come from browse_agent outputs, deduped, ignoring junk", () => {
    const out = (o: unknown) => ({ type: "tool-browse_agent", toolCallId: "x", state: "output-available", input: {}, output: o });
    const traces = extractTraces([
      user(),
      asst([
        out(JSON.stringify({ status: "done", trace: { id: "tr1", source: "local", href: "h" } })),
        out(JSON.stringify({ trace: { id: "tr1" } })),
        out({ trace: { id: "tr2" } }),
        out("not json {\"trace\""),
        out(JSON.stringify({ trace: {} })),
      ]),
    ]);
    expect(traces).toEqual([{ traceId: "tr1", status: "done" }, { traceId: "tr2" }]);
  });
  it("traces are cached per message and refreshed when the message changes", () => {
    const spy = vi.spyOn(JSON, "parse");
    const out = (o: unknown) => ({ type: "tool-browse_agent", toolCallId: "x", state: "output-available", input: {}, output: o });
    const m1 = asst([out(JSON.stringify({ status: "done", trace: { id: "c1" } }))], "m1");
    const msgs = [user(), m1];
    const first = extractTraces(msgs);
    const calls = spy.mock.calls.length;
    expect(extractTraces(msgs)).toEqual(first);
    expect(spy.mock.calls.length).toBe(calls);
    m1.parts.push(out(JSON.stringify({ trace: { id: "c2" } })) as never);
    expect(extractTraces(msgs)).toEqual([{ traceId: "c1", status: "done" }, { traceId: "c2" }]);
    spy.mockRestore();
  });
  it("start reply carries no traces and get still does", async () => {
    const h = createMcpTaskHandler();
    const t = task(await h.handle({ op: "start", prompt: "p" }));
    expect(t.traces).toEqual([]);
  });
  it("buildTaskState fills only what the status allows", () => {
    const chat = { id: "c", title: "T", updatedAt: 5 };
    const done = buildTaskState(chat, base({ messages: [user(), asst([text("R")])] }));
    expect(done).toMatchObject({ taskId: "c", title: "T", status: "done", result: "R", updatedAt: 5, traces: [] });
    expect(done.error).toBeUndefined();
    const err = buildTaskState(chat, base({ error: "E", messages: [user()] }));
    expect(err).toMatchObject({ status: "error", error: "E" });
    const q = buildTaskState(chat, base({ messages: [user(), asst([askPending])] }));
    expect(q.question?.questions).toHaveLength(1);
  });
});

function actions(
  over: Partial<ChatSessionActions> & { messages?: UIMessage[]; busy?: boolean; error?: string; stopped?: boolean } = {},
): ChatSessionActions & { run: { busy: boolean; stopped: boolean } } {
  const { messages = [], busy = false, error, stopped = false, ...rest } = over;
  const run = { busy, stopped };
  return {
    hasMessages: messages.length > 0,
    exportChat: vi.fn(),
    getMessages: () => messages,
    clearChat: vi.fn(),
    getRunState: () => ({ busy: run.busy, stopped: run.stopped, ranSinceMount: false, error, launchQueued: false }),
    run,
    answerAskUser: vi.fn(() => ({ ok: true as const })),
    sendText: vi.fn(() => ({ ok: true as const })),
    stop: vi.fn(() => {
      run.busy = false;
      run.stopped = true;
    }),
    ...rest,
  };
}

const task = (r: McpPanelReply): TaskState => {
  if (!("task" in r)) throw new Error(`expected task, got ${JSON.stringify(r)}`);
  return r.task;
};

describe("createMcpTaskHandler", () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setActions = (id: string, a: ChatSessionActions) =>
    useChatStore.setState((s) => ({ sessionActions: { ...s.sessionActions, [id]: a } }));

  it("start creates a background mcp chat without touching the active chat", async () => {
    const h = createMcpTaskHandler();
    const before = useChatStore.getState();
    const reply = await h.handle({ op: "start", prompt: "  open example.com ", title: "Check site" });
    const t = task(reply);
    const s = useChatStore.getState();
    expect(t).toMatchObject({ status: "running", title: "Check site", traces: [] });
    expect(s.activeChatId).toBe(before.activeChatId);
    expect(s.model).toBe(before.model);
    const chat = s.chats.find((c) => c.id === t.taskId)!;
    expect(chat).toMatchObject({ source: "mcp", unread: true, titleIsAuto: false });
    expect(s.launchQueue[t.taskId]).toEqual({ text: "open example.com" });
  });

  it("start without a title keeps the auto title", async () => {
    const t = task(await createMcpTaskHandler().handle({ op: "start", prompt: "x" }));
    expect(useChatStore.getState().chats.find((c) => c.id === t.taskId)?.titleIsAuto).toBe(true);
  });

  it("start validates the input", async () => {
    const h = createMcpTaskHandler();
    expect(await h.handle({ op: "start", prompt: "   " })).toHaveProperty("error");
    expect(await h.handle({ op: "start", prompt: "x".repeat(20_001) })).toHaveProperty("error");
    expect(await h.handle({ op: "start", prompt: "x", title: "t".repeat(201) })).toHaveProperty("error");
    expect(useChatStore.getState().chats.filter((c) => c.source === "mcp")).toHaveLength(0);
  });

  it("start fails fast when offline and creates nothing", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const n = useChatStore.getState().chats.length;
    const reply = await createMcpTaskHandler().handle({ op: "start", prompt: "x" });
    expect(reply).toHaveProperty("error");
    expect(useChatStore.getState().chats).toHaveLength(n);
  });

  it("caps tasks in running or needs_answer at 3, counted at once (concurrent starts)", async () => {
    const h = createMcpTaskHandler();
    const replies = await Promise.all([1, 2, 3, 4, 5].map((i) => h.handle({ op: "start", prompt: `p${i}` })));
    expect(replies.filter((r) => "task" in r)).toHaveLength(3);
    expect(replies.filter((r) => "error" in r)).toHaveLength(2);
    expect(useChatStore.getState().chats.filter((c) => c.source === "mcp")).toHaveLength(3);
  });

  it("a finished task frees a slot; chats the person started do not count", async () => {
    const h = createMcpTaskHandler();
    const ids = [];
    for (let i = 0; i < 3; i += 1) ids.push(task(await h.handle({ op: "start", prompt: "p" })).taskId);
    expect(await h.handle({ op: "start", prompt: "p" })).toHaveProperty("error");
    useChatStore.getState().consumeLaunchPayload(ids[0]);
    setActions(ids[0], actions({ messages: [user(), asst([text("done")])] }));
    expect(task(await h.handle({ op: "get", taskId: ids[0] })).status).toBe("done");
    expect(task(await h.handle({ op: "start", prompt: "p" })).status).toBe("running");
  });

  it("get reaches only mcp chats; unknown, non-mcp and malformed ids are errors", async () => {
    const h = createMcpTaskHandler();
    const plain = useChatStore.getState().chats[0].id;
    expect(await h.handle({ op: "get", taskId: plain })).toEqual({ error: "Unknown task" });
    expect(await h.handle({ op: "get", taskId: "nope" })).toEqual({ error: "Unknown task" });
    expect(await h.handle({ op: "get", taskId: "../x" })).toEqual({ error: "Invalid task id" });
    for (const op of ["stop", "message", "answer"] as const) {
      const req = { op, taskId: plain, text: "x", answers: [] } as never;
      expect(await h.handle(req)).toHaveProperty("error");
    }
  });

  it("get on a deleted task says so", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    useChatStore.getState().closeChat(id);
    expect(await h.handle({ op: "get", taskId: id })).toEqual({ error: "Task was deleted" });
  });

  it("get maps the session state: result, question, error, traces", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    useChatStore.getState().consumeLaunchPayload(id);
    setActions(id, actions({ messages: [user(), asst([askPending])] }));
    expect(task(await h.handle({ op: "get", taskId: id }))).toMatchObject({ status: "needs_answer", question: { questions: [{ id: "k" }] } });
    setActions(id, actions({ messages: [user()], error: "backend down" }));
    expect(task(await h.handle({ op: "get", taskId: id }))).toMatchObject({ status: "error", error: "backend down" });
    setActions(id, actions({ messages: [user(), asst([text("All good")])] }));
    expect(task(await h.handle({ op: "get", taskId: id }))).toMatchObject({ status: "done", result: "All good" });
  });

  it("answer goes to the session; errors pass through (first answer wins)", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    useChatStore.getState().consumeLaunchPayload(id);
    const a = actions({ messages: [user(), asst([askPending])] });
    setActions(id, a);
    expect(await h.handle({ op: "answer", taskId: id, answers: [{ id: "k", value: "v" }] })).toEqual({ ok: true });
    expect(a.answerAskUser).toHaveBeenCalledWith([{ id: "k", value: "v" }]);
    (a.answerAskUser as ReturnType<typeof vi.fn>).mockReturnValue({ error: "No question is waiting for an answer" });
    expect(await h.handle({ op: "answer", taskId: id, answers: [{ id: "k", value: "v" }] })).toEqual({ error: "No question is waiting for an answer" });
    expect(await h.handle({ op: "answer", taskId: id, answers: [{ id: "k", value: 5 }] as never })).toEqual({ error: "Invalid answers" });
  });

  it("message works on a finished task, not on a running one, not offline", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    useChatStore.getState().consumeLaunchPayload(id);
    const a = actions({ messages: [user(), asst([text("done")])] });
    setActions(id, a);
    expect(await h.handle({ op: "message", taskId: id, text: "more" })).toEqual({ ok: true });
    expect(a.sendText).toHaveBeenCalledWith("more");
    expect(await h.handle({ op: "message", taskId: id, text: " " })).toHaveProperty("error");
    setActions(id, actions({ busy: true, messages: [user()] }));
    expect(await h.handle({ op: "message", taskId: id, text: "more" })).toHaveProperty("error");
    setActions(id, a);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(await h.handle({ op: "message", taskId: id, text: "more" })).toHaveProperty("error");
  });

  it("stop calls the session Stop, marks the task stopped, and frees the cap", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    useChatStore.getState().consumeLaunchPayload(id);
    const a = actions({ busy: true, messages: [user(), asst([unresolved])] });
    setActions(id, a);
    expect(await h.handle({ op: "stop", taskId: id })).toEqual({ ok: true });
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(task(await h.handle({ op: "get", taskId: id })).status).toBe("stopped");
  });

  it("an in-app Stop before the first assistant chunk reads as stopped, not running", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    useChatStore.getState().consumeLaunchPayload(id);
    setActions(id, actions({ messages: [user()] }));
    expect(task(await h.handle({ op: "get", taskId: id })).status).toBe("stopped");
  });

  it("message on a stopped task with a pending question asks for the answer first", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    useChatStore.getState().consumeLaunchPayload(id);
    const a = actions({ messages: [user(), asst([askPending])] });
    setActions(id, a);
    await h.handle({ op: "stop", taskId: id });
    expect(await h.handle({ op: "message", taskId: id, text: "hi" })).toEqual({
      error: "Answer the pending question with answer_question first",
    });
    expect(a.sendText).not.toHaveBeenCalled();
  });

  it("stop of a task that never started drops its queued launch", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    await h.handle({ op: "stop", taskId: id });
    expect(useChatStore.getState().launchQueue[id]).toBeUndefined();
    expect(task(await h.handle({ op: "get", taskId: id })).status).toBe("stopped");
  });

  it("stop of a waiting question ends the wait", async () => {
    const h = createMcpTaskHandler();
    const id = task(await h.handle({ op: "start", prompt: "p" })).taskId;
    useChatStore.getState().consumeLaunchPayload(id);
    setActions(id, actions({ messages: [user(), asst([askPending])] }));
    await h.handle({ op: "stop", taskId: id });
    // The question stays answerable after a Stop: the client still gets it.
    const after = task(await h.handle({ op: "get", taskId: id }));
    expect(after.status).toBe("needs_answer");
    expect(after.question?.questions).toHaveLength(1);
  });

  it("list returns mcp tasks only, newest first, limited", async () => {
    const h = createMcpTaskHandler();
    const a = task(await h.handle({ op: "start", prompt: "a", title: "A" })).taskId;
    const b = task(await h.handle({ op: "start", prompt: "b", title: "B" })).taskId;
    useChatStore.setState((s) => ({ chats: s.chats.map((c) => (c.id === a ? { ...c, updatedAt: 100 } : c.id === b ? { ...c, updatedAt: 200 } : c)) }));
    const all = await h.handle({ op: "list", limit: 20 });
    expect("tasks" in all && all.tasks.map((t) => t.taskId)).toEqual([b, a]);
    const one = await h.handle({ op: "list", limit: 1 });
    expect("tasks" in one && one.tasks).toHaveLength(1);
  });

  it("rejects an unknown op", async () => {
    expect(await createMcpTaskHandler().handle({ op: "nope" } as never)).toHaveProperty("error");
  });
});

describe("startMcpBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useChatStore.setState(useChatStore.getInitialState());
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.penAgentPanel;
  });

  it("does nothing without the bridge", () => {
    window.penAgentPanel = { version: 3 };
    expect(() => startMcpBridge()()).not.toThrow();
  });

  it("registers the handler and notifies (throttled) for mcp chats only", async () => {
    const notifyChanged = vi.fn();
    const off = vi.fn();
    let handler!: (r: never) => Promise<McpPanelReply>;
    window.penAgentPanel = {
      version: 3,
      mcp: { onRequest: (h) => ((handler = h as never), off), notifyChanged },
    };
    const stop = startMcpBridge();
    const reply = await handler({ op: "start", prompt: "p" } as never);
    const id = task(reply).taskId;
    const plain = useChatStore.getState().chats[0].id;
    reportChatActivity(plain);
    reportChatActivity(id);
    reportChatActivity(id);
    vi.advanceTimersByTime(NOTIFY_THROTTLE_MS + 1);
    expect(notifyChanged).toHaveBeenCalledTimes(1);
    expect(notifyChanged).toHaveBeenCalledWith(id);
    stop();
    expect(off).toHaveBeenCalled();
    reportChatActivity(id);
    vi.advanceTimersByTime(NOTIFY_THROTTLE_MS + 1);
    expect(notifyChanged).toHaveBeenCalledTimes(1);
  });
});
