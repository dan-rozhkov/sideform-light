import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The loop itself is tested in @sideform/browser-agent; this suite pins the
// handler glue: what it hands the loop and the JSON strings it returns.
const runBrowseTask = vi.fn();
vi.mock("@sideform/browser-agent/loop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sideform/browser-agent/loop")>()),
  runBrowseTask: (...args: unknown[]) => runBrowseTask(...args),
}));

import { browseTask } from "@/lib/tools/browser/browseTask";
import { browseBackend } from "@/lib/tools/browser/backend";
import { BROWSER_NOT_AVAILABLE_ERROR } from "@/lib/tools/browser/shared";
import { setPenDesktop, stubBrowser } from "./helpers";

describe("browse_task handler", () => {
  beforeEach(() => {
    runBrowseTask.mockReset();
  });
  afterEach(() => {
    window.penAgentPanel = undefined;
    vi.unstubAllGlobals();
  });

  it("reports the missing browser without running the loop", async () => {
    window.penAgentPanel = undefined;
    const result = JSON.parse(await browseTask({ goal: "accept cookies" }));
    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
    expect(runBrowseTask).not.toHaveBeenCalled();
  });

  it("hands the loop the bridge, backend, storage, signal and sanitized args", async () => {
    const browser = setPenDesktop(stubBrowser());
    runBrowseTask.mockResolvedValue({ status: "done", steps: [], url: "u", title: "t" });
    const signal = new AbortController().signal;
    const out = await browseTask({ goal: "g", maxSteps: 7, url: "https://example.com" }, { signal } as never);
    expect(JSON.parse(out)).toEqual({ status: "done", steps: [], url: "u", title: "t" });
    const [goal, opts] = runBrowseTask.mock.calls[0];
    expect(goal).toBe("g");
    expect(opts).toMatchObject({
      browser,
      backend: browseBackend,
      storage: globalThis.localStorage,
      cloud: false,
      signal,
      maxSteps: 7,
      url: "https://example.com",
    });
    // No user-facing switches any more: always the safe defaults.
    expect(opts.permissions()).toEqual({ allowPasswordEntry: false, confirmIrreversible: true });
  });


  it("drops a non-finite maxSteps and an empty url", async () => {
    setPenDesktop(stubBrowser());
    runBrowseTask.mockResolvedValue(undefined);
    expect(await browseTask({ goal: 3, maxSteps: Number.NaN, url: "" })).toBe("{}");
    const [goal, opts] = runBrowseTask.mock.calls[0];
    expect(goal).toBe("");
    expect(opts.maxSteps).toBeUndefined();
    expect(opts.url).toBeUndefined();
  });

  it("returns a thrown error as a JSON error string", async () => {
    setPenDesktop(stubBrowser());
    runBrowseTask.mockRejectedValueOnce(new Error("boom"));
    expect(JSON.parse(await browseTask({ goal: "g" }))).toEqual({ error: "boom" });
    runBrowseTask.mockRejectedValueOnce("x");
    expect(JSON.parse(await browseTask({ goal: "g" }))).toEqual({ error: "browse_task failed." });
  });
});

describe("browse backend transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs JSON to the resolved API URL without cookies, and reads Retry-After", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "3" }),
      json: async () => ({ error: "slow down" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await browseBackend.request("/api/browse/step", { goal: "g" }, { timeoutMs: 1000 });
    expect(res).toEqual({ status: 429, ok: false, body: { error: "slow down" }, retryAfterSec: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/browse/step");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ goal: "g" }));
    expect(init.credentials).toBe("omit");
  });
});
