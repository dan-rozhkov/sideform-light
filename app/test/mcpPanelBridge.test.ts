import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_ANSWER_ERROR, NO_WINDOW_ERROR, PANEL_REPLY_TIMEOUT_MS, createPanelBridge, parsePanelReply, type PanelEndpoint } from "../src/main/mcp/panelBridge";

function endpoint(id: number) {
  const sent: { requestId: string; request: unknown }[] = [];
  const ep: PanelEndpoint = { id, deliver: vi.fn((m) => void sent.push(m)) };
  return { ep, sent };
}
const ids = () => {
  let n = 0;
  return () => `r${++n}`;
};

describe("panel bridge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("no panel: the error 'Sideform Light has no open window'", async () => {
    const b = createPanelBridge({ newId: ids() });
    expect(await b.request({ op: "list", limit: 5 })).toEqual({ error: "Sideform Light has no open window" });
    expect(NO_WINDOW_ERROR).toBe("Sideform Light has no open window");
  });

  it("sends { requestId, request } to the panel and resolves with its reply", async () => {
    const b = createPanelBridge({ newId: ids() });
    const { ep, sent } = endpoint(5);
    b.registerPanel(ep);
    const p = b.request({ op: "get", taskId: "t1" });
    expect(sent).toEqual([{ requestId: "r1", request: { op: "get", taskId: "t1" } }]);
    b.handleReply(5, { requestId: "r1", reply: { ok: true } });
    expect(await p).toEqual({ ok: true });
  });

  it("times out after 15 s with 'Sideform Light did not answer', and a late reply is ignored", async () => {
    const b = createPanelBridge({ newId: ids() });
    b.registerPanel(endpoint(5).ep);
    const p = b.request({ op: "stop", taskId: "t1" });
    await vi.advanceTimersByTimeAsync(PANEL_REPLY_TIMEOUT_MS - 1);
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ error: NO_ANSWER_ERROR });
    expect(NO_ANSWER_ERROR).toBe("Sideform Light did not answer");
    b.handleReply(5, { requestId: "r1", reply: { ok: true } }); // must not throw
  });

  it("accepts replies only from the registered panel", async () => {
    const b = createPanelBridge({ newId: ids() });
    b.registerPanel(endpoint(5).ep);
    const p = b.request({ op: "stop", taskId: "t1" });
    b.handleReply(99, { requestId: "r1", reply: { ok: true } });
    b.handleReply(5, { requestId: "other", reply: { ok: true } });
    b.handleReply(5, "junk");
    b.handleReply(5, { reply: { ok: true } });
    await vi.advanceTimersByTimeAsync(PANEL_REPLY_TIMEOUT_MS);
    expect(await p).toEqual({ error: NO_ANSWER_ERROR });
  });

  it("a reply resolves its own request only, once", async () => {
    const b = createPanelBridge({ newId: ids() });
    b.registerPanel(endpoint(5).ep);
    const p1 = b.request({ op: "get", taskId: "a" });
    const p2 = b.request({ op: "get", taskId: "b" });
    b.handleReply(5, { requestId: "r2", reply: { error: "x" } });
    expect(await p2).toEqual({ error: "x" });
    b.handleReply(5, { requestId: "r1", reply: { ok: true } });
    b.handleReply(5, { requestId: "r1", reply: { error: "second" } });
    expect(await p1).toEqual({ ok: true });
  });

  it("the last panel to register wins; the replaced panel's pending requests fail", async () => {
    const b = createPanelBridge({ newId: ids() });
    const a = endpoint(1);
    const c = endpoint(2);
    b.registerPanel(a.ep);
    const p = b.request({ op: "get", taskId: "t" });
    b.registerPanel(c.ep);
    expect(await p).toEqual({ error: NO_WINDOW_ERROR });
    void b.request({ op: "get", taskId: "t" });
    expect(a.sent).toHaveLength(1);
    expect(c.sent).toHaveLength(1);
    b.handleReply(1, { requestId: "r2", reply: { ok: true } }); // the old panel is no longer trusted
  });

  it("unregister drops the panel and fails pending requests; a stale unregister is a no-op", async () => {
    const b = createPanelBridge({ newId: ids() });
    const off1 = b.registerPanel(endpoint(1).ep);
    const off2 = b.registerPanel(endpoint(2).ep);
    off1();
    expect(b.hasPanel()).toBe(true);
    const p = b.request({ op: "get", taskId: "t" });
    off2();
    expect(b.hasPanel()).toBe(false);
    expect(await p).toEqual({ error: NO_WINDOW_ERROR });
    expect(await b.request({ op: "get", taskId: "t" })).toEqual({ error: NO_WINDOW_ERROR });
  });

  it("a send that throws (panel destroyed) is a no-window error at once", async () => {
    const b = createPanelBridge({ newId: ids() });
    b.registerPanel({ id: 1, deliver: () => { throw new Error("gone"); } });
    expect(await b.request({ op: "get", taskId: "t" })).toEqual({ error: NO_WINDOW_ERROR });
  });

  it("task-changed reaches listeners only from the registered panel with a valid task id", () => {
    const b = createPanelBridge();
    b.registerPanel(endpoint(5).ep);
    const cb = vi.fn();
    const off = b.onChanged(cb);
    b.handleChanged(5, { taskId: "t1" });
    b.handleChanged(6, { taskId: "t2" });
    b.handleChanged(5, { taskId: "../bad" });
    b.handleChanged(5, { taskId: 3 });
    b.handleChanged(5, null);
    expect(cb.mock.calls).toEqual([["t1"]]);
    off();
    b.handleChanged(5, { taskId: "t3" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener does not stop the others", () => {
    const b = createPanelBridge();
    b.registerPanel(endpoint(5).ep);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ok = vi.fn();
    b.onChanged(() => { throw new Error("x"); });
    b.onChanged(ok);
    b.handleChanged(5, { taskId: "t1" });
    expect(ok).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("parsePanelReply", () => {
  it("passes the four contract shapes and turns anything else into an error", () => {
    expect(parsePanelReply({ error: "e" })).toEqual({ error: "e" });
    expect(parsePanelReply({ ok: true })).toEqual({ ok: true });
    const task = { taskId: "t", title: "T", status: "done", updatedAt: 1, traces: [] };
    expect(parsePanelReply({ task })).toEqual({ task });
    expect(parsePanelReply({ tasks: [] })).toEqual({ tasks: [] });
    for (const bad of [null, 5, "x", {}, { ok: false }, { task: 1 }, { tasks: "x" }]) expect("error" in parsePanelReply(bad), JSON.stringify(bad)).toBe(true);
  });
});
