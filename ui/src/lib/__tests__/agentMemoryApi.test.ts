import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAgentMemory,
  deleteMemoryEntry,
  fetchAgentMemory,
  memoryUsage,
  setAgentMemoryEnabled,
} from "../agentMemoryApi";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

describe("agentMemoryApi", () => {
  it("GETs /api/memory with the userId and no credentials, and normalizes the body", async () => {
    fetchMock.mockResolvedValue(json({ available: true, enabled: true, memory: ["a", 3], user: ["b"], limits: { memory: 2200, user: 1375 } }));
    const res = await fetchAgentMemory();
    expect(res).toEqual({
      ok: true,
      data: { available: true, enabled: true, memory: ["a"], user: ["b"], limits: { memory: 2200, user: 1375 } },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/memory?userId=u1");
    expect(init.credentials).toBe("omit");
  });

  it("defaults a sparse body to unavailable with empty lists", async () => {
    fetchMock.mockResolvedValue(json({}));
    const res = await fetchAgentMemory();
    expect(res).toEqual({ ok: true, data: { available: false, enabled: true, memory: [], user: [], limits: { memory: 0, user: 0 } } });
  });

  it("reports a 503 as 'not available', not an error", async () => {
    fetchMock.mockResolvedValue(json({ error: "memory_unavailable" }, 503));
    const res = await fetchAgentMemory();
    expect(res.ok && res.data.available).toBe(false);
  });

  it("reports a 404 as 'not available' too", async () => {
    fetchMock.mockResolvedValue(json({ error: "not_found" }, 404));
    const res = await fetchAgentMemory();
    expect(res.ok && res.data.available).toBe(false);
  });

  it("returns other failures and network errors as { ok: false }", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "boom" }, 500));
    expect(await fetchAgentMemory()).toEqual({ ok: false, error: "boom", status: 500 });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchAgentMemory()).toEqual({ ok: false, error: "offline" });
  });

  it("DELETEs one entry with target and text in the body", async () => {
    fetchMock.mockResolvedValue(json({ removed: true }));
    expect(await deleteMemoryEntry("user", "likes tea")).toEqual({ ok: true, data: { removed: true } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/memory/entry?userId=u1");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ target: "user", text: "likes tea" });
  });

  it("reports a 404 on delete with its status", async () => {
    fetchMock.mockResolvedValue(json({ error: "not_found" }, 404));
    expect(await deleteMemoryEntry("memory", "x")).toMatchObject({ ok: false, status: 404 });
  });

  it("clears all memory and PUTs the enabled flag", async () => {
    fetchMock.mockResolvedValueOnce(json({ cleared: { memory: 2, user: 1 } }));
    expect(await clearAgentMemory()).toEqual({ ok: true, data: { cleared: { memory: 2, user: 1 } } });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("DELETE");
    fetchMock.mockResolvedValueOnce(json({ enabled: false }));
    expect(await setAgentMemoryEnabled(false)).toEqual({ ok: true, data: { enabled: false } });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/memory/settings?userId=u1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false });
  });

  it("counts usage like the backend: entries joined with a section-sign separator", () => {
    expect(memoryUsage([])).toBe(0);
    expect(memoryUsage(["abc"])).toBe(3);
    expect(memoryUsage(["abc", "de"])).toBe("abc\n§\nde".length);
  });
});
