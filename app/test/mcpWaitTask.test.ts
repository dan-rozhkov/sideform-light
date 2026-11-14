import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_DELAY_MS, getTaskWaiting } from "../src/main/mcp/waitTask";
import type { McpPanelReply, McpPanelRequest, McpTaskStatus } from "../src/main/mcp/types";

const task = (status: McpTaskStatus): McpPanelReply => ({ task: { taskId: "t1", title: "T", status, updatedAt: 1, traces: [] } });

/** A panel whose answers follow a script; `changed` pushes a task-changed event. */
function harness(script: McpPanelReply[]) {
  const reads: McpPanelRequest[] = [];
  const listeners = new Set<(id: string) => void>();
  let i = 0;
  return {
    reads,
    listeners,
    changed: (id = "t1") => [...listeners].forEach((cb) => cb(id)),
    deps: {
      request: vi.fn(async (req: McpPanelRequest) => {
        reads.push(req);
        return script[Math.min(i++, script.length - 1)];
      }),
      onChanged: (cb: (id: string) => void) => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      },
    },
  };
}

describe("get_task waiting", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waitSeconds 0: one read, returned as is, even when running", async () => {
    const h = harness([task("running")]);
    expect(await getTaskWaiting(h.deps, "t1", 0)).toEqual(task("running"));
    expect(h.reads).toEqual([{ op: "get", taskId: "t1" }]);
  });

  it("an error reply (deleted task, no window) returns at once", async () => {
    const h = harness([{ error: "task was deleted" }]);
    expect(await getTaskWaiting(h.deps, "t1", 30)).toEqual({ error: "task was deleted" });
    expect(h.reads).toHaveLength(1);
  });

  it("returns early on a non-running status only after a second read one second later", async () => {
    const h = harness([task("done"), task("done")]);
    const p = getTaskWaiting(h.deps, "t1", 30);
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS - 1);
    expect(h.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual(task("done"));
    expect(h.reads).toHaveLength(2);
  });

  it("a gap between auto-continuations (not running, then running again) does not end the wait", async () => {
    const h = harness([task("running"), task("done"), task("running"), task("running"), task("done"), task("done")]);
    let result: McpPanelReply | undefined;
    void getTaskWaiting(h.deps, "t1", 30).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(0);
    h.changed(); // read 2: done (gap)
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS); // read 3: running again
    expect(result).toBeUndefined();
    h.changed(); // read 4: running
    await vi.advanceTimersByTimeAsync(0);
    h.changed(); // read 5: done
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS); // read 6: done -> settled
    expect(result).toEqual(task("done"));
  });

  it("a running task wakes on a change push of that task only", async () => {
    const h = harness([task("running"), task("running"), task("running")]);
    void getTaskWaiting(h.deps, "t1", 30);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.reads).toHaveLength(1);
    h.changed("other");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.reads).toHaveLength(1);
    h.changed("t1");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.reads).toHaveLength(2);
  });

  it("re-reads at least every 5 s even when no push arrives, and does not poll tightly", async () => {
    const h = harness([task("running")]);
    void getTaskWaiting(h.deps, "t1", 30);
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.reads).toHaveLength(2);
  });

  it("gives up at the deadline with the last (running) state", async () => {
    const h = harness([task("running")]);
    const p = getTaskWaiting(h.deps, "t1", 12);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await p).toEqual(task("running"));
    expect(h.listeners.size).toBe(0); // no leaked subscription
  });

  it("needs_answer and error statuses also end the wait (after confirmation)", async () => {
    for (const status of ["needs_answer", "error", "stopped"] as const) {
      const h = harness([task(status)]);
      const p = getTaskWaiting(h.deps, "t1", 30);
      await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS);
      expect(await p).toEqual(task(status));
    }
  });

  it("does not wait for a confirmation that cannot fit before the deadline", async () => {
    const h = harness([task("done")]);
    expect(await getTaskWaiting(h.deps, "t1", 0.5)).toEqual(task("done"));
    expect(h.reads).toHaveLength(1);
  });

  it("unsubscribes after a wake-up too", async () => {
    const h = harness([task("running"), task("done"), task("done")]);
    const p = getTaskWaiting(h.deps, "t1", 30);
    await vi.advanceTimersByTimeAsync(0);
    h.changed();
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS);
    await p;
    expect(h.listeners.size).toBe(0);
  });
});
