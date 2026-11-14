import { describe, expect, it } from "vitest";
import { createIsolatedEvaluator } from "../src/main/isolatedEval";

function fake(handlers: Record<string, (p?: Record<string, unknown>, n?: number) => unknown>) {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const counts: Record<string, number> = {};
  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    counts[method] = (counts[method] ?? 0) + 1;
    const h = handlers[method];
    if (!h) throw new Error(`unexpected ${method}`);
    return h(params, counts[method]);
  };
  return { send, calls };
}

const okHandlers = {
  "Page.getFrameTree": () => ({ frameTree: { frame: { id: "F1" } } }),
  "Page.createIsolatedWorld": (_p?: Record<string, unknown>, n = 1) => ({ executionContextId: 6 + n }),
  "Runtime.evaluate": () => ({ result: { value: 42 } }),
};

describe("createIsolatedEvaluator", () => {
  it("creates the world in the main frame and evaluates in that context by value", async () => {
    const { send, calls } = fake(okHandlers);
    expect(await createIsolatedEvaluator(send, "w").evaluate("1+1")).toBe(42);
    expect(calls.map((c) => c.method)).toEqual(["Page.getFrameTree", "Page.createIsolatedWorld", "Runtime.evaluate"]);
    expect(calls[1]!.params).toEqual({ frameId: "F1", worldName: "w" });
    expect(calls[2]!.params).toMatchObject({ expression: "1+1", contextId: 7, awaitPromise: true, returnByValue: true });
  });

  it("caches the context: the second eval is one Runtime.evaluate", async () => {
    const { send, calls } = fake(okHandlers);
    const ev = createIsolatedEvaluator(send, "w");
    await ev.evaluate("a");
    calls.length = 0;
    await ev.evaluate("b");
    expect(calls.map((c) => c.method)).toEqual(["Runtime.evaluate"]);
  });

  it("drops the cache on a main-frame navigation only", async () => {
    const { send, calls } = fake(okHandlers);
    const ev = createIsolatedEvaluator(send, "w");
    await ev.evaluate("a");
    ev.onCdpEvent("Page.frameNavigated", { frame: { id: "child", parentId: "F1" } });
    calls.length = 0;
    await ev.evaluate("b");
    expect(calls.map((c) => c.method)).toEqual(["Runtime.evaluate"]);
    ev.onCdpEvent("Page.frameNavigated", { frame: { id: "F2" } });
    calls.length = 0;
    await ev.evaluate("c");
    expect(calls.map((c) => c.method)).toEqual(["Page.getFrameTree", "Page.createIsolatedWorld", "Runtime.evaluate"]);
  });

  it("recreates a dead context once", async () => {
    let evals = 0;
    const { send } = fake({
      ...okHandlers,
      "Runtime.evaluate": () => {
        evals++;
        if (evals === 2) throw new Error("Cannot find context with specified id");
        return { result: { value: evals } };
      },
    });
    const ev = createIsolatedEvaluator(send, "w");
    expect(await ev.evaluate("a")).toBe(1);
    expect(await ev.evaluate("b")).toBe(3);
  });

  it("rejects when the tab has no frame or no world comes back", async () => {
    await expect(createIsolatedEvaluator(fake({ "Page.getFrameTree": () => ({}) }).send, "w").evaluate("x")).rejects.toThrow("Frame no longer exists.");
    const { send } = fake({ ...okHandlers, "Page.createIsolatedWorld": () => ({}) });
    await expect(createIsolatedEvaluator(send, "w").evaluate("x")).rejects.toThrow("isolated world");
  });

  it("turns a thrown script into a rejection with its description", async () => {
    const { send } = fake({ ...okHandlers, "Runtime.evaluate": () => ({ exceptionDetails: { text: "Uncaught", exception: { description: "Error: boom" } } }) });
    await expect(createIsolatedEvaluator(send, "w").evaluate("x")).rejects.toThrow("Error: boom");
  });
});
