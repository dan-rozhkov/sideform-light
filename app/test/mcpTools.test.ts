import { describe, expect, it, vi } from "vitest";
import { MCP_TOOL_MANIFEST, createToolDispatcher } from "../src/main/mcp/tools";
import type { McpPanelPort, McpPanelReply, McpPanelRequest } from "../src/main/mcp/types";

function panel(reply: McpPanelReply | ((r: McpPanelRequest) => McpPanelReply)) {
  const port: McpPanelPort & { request: ReturnType<typeof vi.fn> } = {
    request: vi.fn(async (r: McpPanelRequest) => (typeof reply === "function" ? reply(r) : reply)),
    onChanged: () => () => undefined,
  };
  return port;
}
const text = (r: { content: { text: string }[] }) => r.content[0].text;
const task = { taskId: "t1", title: "T", status: "done" as const, updatedAt: 5, traces: [], result: "R" };

describe("tool manifest", () => {
  it("has exactly the ten tools with object schemas and real descriptions", () => {
    expect(MCP_TOOL_MANIFEST.map((t) => t.name)).toEqual(["start_task", "get_task", "answer_question", "send_message", "stop_task", "list_tasks", "memory_list", "memory_add", "memory_replace", "memory_remove"]);
    for (const t of MCP_TOOL_MANIFEST) {
      expect((t.inputSchema as { type: string }).type).toBe("object");
      expect(t.description.length).toBeGreaterThan(60);
    }
  });
  it("start_task says what the agent can do and how to follow it; get_task documents waitSeconds", () => {
    const start = MCP_TOOL_MANIFEST[0].description;
    for (const word of ["websites", "saved", "isolated", "question", "get_task", "waitSeconds", "answer_question"]) expect(start.toLowerCase()).toContain(word.toLowerCase());
    expect(MCP_TOOL_MANIFEST[1].description).toContain("waitSeconds");
  });
  it("required fields match the contract", () => {
    const req = (n: string) => (MCP_TOOL_MANIFEST.find((t) => t.name === n)!.inputSchema as { required?: string[] }).required;
    expect(req("start_task")).toEqual(["prompt"]);
    expect(req("get_task")).toEqual(["taskId"]);
    expect(req("answer_question")).toEqual(["taskId", "answers"]);
    expect(req("send_message")).toEqual(["taskId", "text"]);
    expect(req("stop_task")).toEqual(["taskId"]);
    expect(req("list_tasks")).toBeUndefined();
    expect(req("memory_list")).toBeUndefined();
    expect(req("memory_add")).toEqual(["target", "text"]);
    expect(req("memory_replace")).toEqual(["target", "oldText", "text"]);
    expect(req("memory_remove")).toEqual(["target", "oldText"]);
    const props = (n: string) => (MCP_TOOL_MANIFEST.find((t) => t.name === n)!.inputSchema as { properties: Record<string, { enum?: string[]; maxLength?: number }> }).properties;
    expect(props("memory_add").target.enum).toEqual(["memory", "user"]);
    expect(props("memory_add").text.maxLength).toBe(600);
  });
  it("memory tool descriptions explain the two stores", () => {
    for (const n of ["memory_list", "memory_add", "memory_replace", "memory_remove"]) {
      const d = MCP_TOOL_MANIFEST.find((t) => t.name === n)!.description;
      expect(d).toContain("who the person is");
      expect(d).toContain("injected into every turn");
    }
  });
});

describe("dispatcher", () => {
  it("start_task: validates first, asks the panel, returns { taskId, status } as JSON text", async () => {
    const p = panel({ task: { ...task, status: "running" } });
    const call = createToolDispatcher({ panel: p });
    const r = await call("start_task", { prompt: "do it", title: "X", ignored: 1 });
    expect(p.request).toHaveBeenCalledWith({ op: "start", prompt: "do it", title: "X" });
    expect(JSON.parse(text(r))).toEqual({ taskId: "t1", status: "running" });
    expect(r.isError).toBeUndefined();
  });

  it("invalid input never reaches the panel and is an isError result", async () => {
    const p = panel({ ok: true });
    const call = createToolDispatcher({ panel: p });
    for (const [name, args] of [
      ["start_task", { prompt: "" }],
      ["get_task", { taskId: "bad id" }],
      ["get_task", { taskId: "t", waitSeconds: 99 }],
      ["answer_question", { taskId: "t", answers: [] }],
      ["send_message", { taskId: "t", text: "" }],
      ["stop_task", {}],
      ["list_tasks", { limit: 0 }],
    ] as const) {
      const r = await call(name, args as Record<string, unknown>);
      expect(r.isError, name).toBe(true);
    }
    expect(p.request).not.toHaveBeenCalled();
  });

  it("get_task returns the full task state", async () => {
    const call = createToolDispatcher({ panel: panel({ task }) });
    expect(JSON.parse(text(await call("get_task", { taskId: "t1" })))).toEqual(task);
  });

  it("answer_question, send_message and stop_task return { ok: true }", async () => {
    const p = panel({ ok: true });
    const call = createToolDispatcher({ panel: p });
    for (const [name, args, req] of [
      ["answer_question", { taskId: "t", answers: [{ id: "q", value: ["a"] }] }, { op: "answer", taskId: "t", answers: [{ id: "q", value: ["a"] }] }],
      ["send_message", { taskId: "t", text: "more" }, { op: "message", taskId: "t", text: "more" }],
      ["stop_task", { taskId: "t" }, { op: "stop", taskId: "t" }],
    ] as const) {
      expect(JSON.parse(text(await call(name, args as never))), name).toEqual({ ok: true });
      expect(p.request).toHaveBeenLastCalledWith(req);
    }
  });

  it("list_tasks defaults the limit to 20 and returns { tasks }", async () => {
    const tasks = [{ taskId: "t", title: "T", status: "done" as const, updatedAt: 1 }];
    const p = panel({ tasks });
    const call = createToolDispatcher({ panel: p });
    expect(JSON.parse(text(await call("list_tasks", {})))).toEqual({ tasks });
    expect(p.request).toHaveBeenCalledWith({ op: "list", limit: 20 });
  });

  it("a panel error is an isError result with its text", async () => {
    const call = createToolDispatcher({ panel: panel({ error: "task was deleted" }) });
    const r = await call("get_task", { taskId: "t" });
    expect(r).toEqual({ content: [{ type: "text", text: "task was deleted" }], isError: true });
  });

  it("a reply of the wrong shape for the tool is an error, not forwarded", async () => {
    const call = createToolDispatcher({ panel: panel({ ok: true }) });
    expect((await call("get_task", { taskId: "t" })).isError).toBe(true);
    expect((await call("start_task", { prompt: "x" })).isError).toBe(true);
  });

  it("an unknown tool and a throwing panel are errors; the dispatcher never throws", async () => {
    const p: McpPanelPort = { request: async () => { throw new Error("boom secret"); }, onChanged: () => () => undefined };
    const call = createToolDispatcher({ panel: p });
    expect((await call("nope", {})).isError).toBe(true);
    const r = await call("stop_task", { taskId: "t" });
    expect(r).toEqual({ content: [{ type: "text", text: "Internal error." }], isError: true });
  });

  it("get_task with waitSeconds holds the call until the status leaves running", async () => {
    vi.useFakeTimers();
    try {
      let status: "running" | "done" = "running";
      const listeners = new Set<(id: string) => void>();
      const p: McpPanelPort = {
        request: async () => ({ task: { ...task, status } }),
        onChanged: (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
      };
      const call = createToolDispatcher({ panel: p });
      const pending = call("get_task", { taskId: "t1", waitSeconds: 30 });
      await vi.advanceTimersByTimeAsync(100);
      status = "done";
      listeners.forEach((cb) => cb("t1"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(JSON.parse(text(await pending)).status).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("memory tools", () => {
  const snap = { enabled: true, memory: ["ab", "cd"], user: ["x"], limits: { memory: 2200, user: 1375 } };

  it("memory_list asks memory-list and adds usage counted with the backend separator", async () => {
    const p = panel({ memory: snap });
    const r = await createToolDispatcher({ panel: p })("memory_list", {});
    expect(p.request).toHaveBeenCalledWith({ op: "memory-list" });
    expect(JSON.parse(text(r))).toEqual({ ...snap, usage: { memory: "7/2200 chars", user: "1/1375 chars" } });
  });

  it("memory_add, memory_replace and memory_remove build memory-apply and return the snapshot", async () => {
    const p = panel({ memory: snap });
    const call = createToolDispatcher({ panel: p });
    expect(JSON.parse(text(await call("memory_add", { target: "user", text: "likes tea", extra: 1 }))).user).toEqual(["x"]);
    await call("memory_replace", { target: "memory", oldText: "ab", text: "ef" });
    await call("memory_remove", { target: "memory", oldText: "cd" });
    expect(p.request.mock.calls.map((c) => c[0])).toEqual([
      { op: "memory-apply", target: "user", operations: [{ action: "add", content: "likes tea" }] },
      { op: "memory-apply", target: "memory", operations: [{ action: "replace", old_text: "ab", content: "ef" }] },
      { op: "memory-apply", target: "memory", operations: [{ action: "remove", old_text: "cd" }] },
    ]);
  });

  it("bad input never reaches the panel", async () => {
    const p = panel({ memory: snap });
    const call = createToolDispatcher({ panel: p });
    for (const [name, args] of [
      ["memory_add", { target: "other", text: "a" }],
      ["memory_add", { text: "a" }],
      ["memory_add", { target: "user", text: "" }],
      ["memory_add", { target: "user", text: "   " }],
      ["memory_add", { target: "user", text: "a".repeat(601) }],
      ["memory_replace", { target: "user", text: "a" }],
      ["memory_replace", { target: "user", oldText: "", text: "a" }],
      ["memory_replace", { target: "user", oldText: "a" }],
      ["memory_remove", { target: "user" }],
      ["memory_remove", { target: "user", oldText: "a".repeat(601) }],
    ] as const) {
      expect((await call(name, args as Record<string, unknown>)).isError, name).toBe(true);
    }
    expect(p.request).not.toHaveBeenCalled();
  });

  it("a panel error (backend rejection) is an isError result with its text", async () => {
    const r = await createToolDispatcher({ panel: panel({ error: "old_text matches 2 entries" }) })("memory_remove", { target: "memory", oldText: "a" });
    expect(r).toMatchObject({ isError: true });
    expect(text(r)).toBe("old_text matches 2 entries");
  });

  it("a reply of the wrong kind is an isError result", async () => {
    expect((await createToolDispatcher({ panel: panel({ ok: true }) })("memory_list", {})).isError).toBe(true);
  });
});
