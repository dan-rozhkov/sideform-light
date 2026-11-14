import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { canSaveBrowseTrace, saveBrowseTrace, TRACE_SAVE_SAFETY_MARGIN_MS, TRACE_SAVE_TIMEOUT_MS } from "../browseTraces";

const JPEG = `data:image/jpeg;base64,${"/9j/".repeat(40)}`;
const trace: BrowseTrace = {
  format: "sideform.browse-trace",
  version: 1,
  id: "t1",
  goal: "g",
  startedAt: 1,
  endedAt: 2,
  status: "done",
  steps: [],
  frames: [{ id: 0, at: 1, kind: "step", src: JPEG }],
  console: [],
  network: [],
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  delete window.penAgentPanel;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const panelWith = (save: (payload: never) => Promise<{ id: string } | { error: string }>) => {
  window.penAgentPanel = { version: 3, traces: { save: save as never, open: vi.fn() } };
};

describe("saveBrowseTrace", () => {
  it("saves through the agent panel bridge with frames split out, as a local trace", async () => {
    const save = vi.fn(async () => ({ id: "p1" }));
    panelWith(save);
    await expect(saveBrowseTrace(trace)).resolves.toEqual({ id: "p1", source: "local" });
    const [payload] = save.mock.calls[0] as unknown as [{ manifest: BrowseTrace; assets: Array<{ path: string; dataUrl: string }> }];
    expect(payload.assets).toEqual([expect.objectContaining({ path: "frames/0.jpg", dataUrl: JPEG })]);
    expect(payload.manifest.frames[0].src).toBe("frames/0.jpg");
  });

  it("without a save bridge stores nothing and never touches the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(canSaveBrowseTrace()).toBe(false);
    await expect(saveBrowseTrace(trace)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("canSaveBrowseTrace is true with a panel save bridge", () => {
    panelWith(async () => ({ id: "x" }));
    expect(canSaveBrowseTrace()).toBe(true);
  });

  it("an {error} answer logs and gives no trace", async () => {
    panelWith(async () => ({ error: "disk full" }));
    await expect(saveBrowseTrace(trace)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[browse trace] not saved:", "disk full");
  });

  it("gives up after the timeout when the save hangs", async () => {
    vi.useFakeTimers();
    panelWith(() => new Promise(() => {}));
    const pending = saveBrowseTrace(trace);
    await vi.advanceTimersByTimeAsync(TRACE_SAVE_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[browse trace] not saved:", "timed out");
  });
});

describe("saveBrowseTrace budget and stop", () => {
  it("skips the save when the outer timeout leaves no room", async () => {
    const save = vi.fn(async () => ({ id: "p1" }));
    panelWith(save);
    await expect(saveBrowseTrace(trace, { outerEnd: Date.now() + TRACE_SAVE_SAFETY_MARGIN_MS - 1 })).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("waits no longer than the time left before the outer timeout", async () => {
    vi.useFakeTimers();
    panelWith(() => new Promise(() => {}));
    const pending = saveBrowseTrace(trace, { outerEnd: Date.now() + TRACE_SAVE_SAFETY_MARGIN_MS + 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[browse trace] not saved:", "timed out");
  });

  it("Stop ends the wait for a hanging shell save", async () => {
    panelWith(() => new Promise(() => {}));
    const stop = new AbortController();
    const pending = saveBrowseTrace(trace, { signal: stop.signal });
    stop.abort();
    await expect(pending).resolves.toBeUndefined();
  });
});
