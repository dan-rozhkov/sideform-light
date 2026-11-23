import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpTaskHandler } from "../mcpTasks";
import type { McpPanelRequest } from "../mcpTypes";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const snapshot = { ok: true, memory: ["a"], user: ["b"], limits: { memory: 2200, user: 1375 } };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem("pen.userId", "u1");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("MCP memory ops in the panel handler", () => {
  it("memory-list returns the snapshot without a running task", async () => {
    fetchMock.mockResolvedValue(json({ available: true, enabled: true, memory: ["a"], user: [], limits: { memory: 2200, user: 1375 } }));
    const reply = await createMcpTaskHandler().handle({ op: "memory-list" });
    expect(reply).toEqual({ memory: { enabled: true, memory: ["a"], user: [], limits: { memory: 2200, user: 1375 } } });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("/api/memory?userId=u1");
  });

  it("memory-list: unavailable and failing backends are errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ available: false }));
    expect(await createMcpTaskHandler().handle({ op: "memory-list" })).toHaveProperty("error");
    fetchMock.mockResolvedValueOnce(json({ error: "boom" }, 500));
    expect(await createMcpTaskHandler().handle({ op: "memory-list" })).toEqual({ error: "boom" });
  });

  it("memory-apply posts the operations and returns the snapshot after the write", async () => {
    fetchMock.mockResolvedValue(json(snapshot));
    const reply = await createMcpTaskHandler().handle({ op: "memory-apply", target: "user", operations: [{ action: "add", content: "likes tea" }] });
    expect(reply).toEqual({ memory: { enabled: true, memory: ["a"], user: ["b"], limits: { memory: 2200, user: 1375 } } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/memory/operations?userId=u1");
    expect(init.method).toBe("POST");
  });

  it("maps 400 memory_rejected and 409 memory_disabled to the backend's text", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "old_text matches 2 entries", code: "memory_rejected" }, 400));
    const op: McpPanelRequest = { op: "memory-apply", target: "memory", operations: [{ action: "remove", old_text: "x" }] };
    expect(await createMcpTaskHandler().handle(op)).toEqual({ error: "old_text matches 2 entries" });
    fetchMock.mockResolvedValueOnce(json({ error: "Memory is turned off in Settings > Memory.", code: "memory_disabled" }, 409));
    expect(await createMcpTaskHandler().handle(op)).toEqual({ error: "Memory is turned off in Settings > Memory." });
  });

  it("validates again: bad target, no operations, empty or long text never reach the backend", async () => {
    const h = createMcpTaskHandler();
    for (const req of [
      { op: "memory-apply", target: "x", operations: [{ action: "add", content: "a" }] },
      { op: "memory-apply", target: "user", operations: [] },
      { op: "memory-apply", target: "user", operations: [{ action: "add", content: " " }] },
      { op: "memory-apply", target: "user", operations: [{ action: "add", content: "a".repeat(601) }] },
      { op: "memory-apply", target: "user", operations: [{ action: "replace", old_text: "a", content: "" }] },
    ]) {
      expect(await h.handle(req as never)).toHaveProperty("error");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("memory-list hides the entries while memory is off", async () => {
    fetchMock.mockResolvedValue(json({ available: true, enabled: false, memory: ["a"], user: ["b"], limits: { memory: 2200, user: 1375 } }));
    expect(await createMcpTaskHandler().handle({ op: "memory-list" })).toEqual({ memory: { enabled: false, memory: [], user: [], limits: { memory: 2200, user: 1375 } } });
  });

  it("memory-list rejects limits that are not positive numbers", async () => {
    fetchMock.mockResolvedValue(json({ available: true, enabled: true, memory: [], user: [], limits: { memory: 0, user: 5 } }));
    expect(await createMcpTaskHandler().handle({ op: "memory-list" })).toHaveProperty("error");
  });

  it("memory-apply posts only the validated fields of each operation", async () => {
    fetchMock.mockResolvedValue(json(snapshot));
    await createMcpTaskHandler().handle({
      op: "memory-apply",
      target: "user",
      operations: [
        { action: "add", content: "a", evil: 1 },
        { action: "replace", old_text: "b", content: "c", extra: true },
        { action: "remove", old_text: "d", content: "ignored" },
      ],
    } as never);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.operations).toEqual([
      { action: "add", content: "a" },
      { action: "replace", old_text: "b", content: "c" },
      { action: "remove", old_text: "d" },
    ]);
  });

  it("memory-apply passes an abort signal and maps a timeout to the retry-after-list message", async () => {
    fetchMock.mockImplementation((_u: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(new DOMException("timed out", "TimeoutError"));
    });
    const reply = await createMcpTaskHandler().handle({ op: "memory-apply", target: "user", operations: [{ action: "add", content: "a" }] });
    expect(reply).toEqual({ error: expect.stringContaining("call memory_list before retrying") });
    expect((reply as { error: string }).error).toContain("may still have been saved");
  });
});
