import { describe, expect, it, vi } from "vitest";
import { createPanelSenderRegistry, flushPage, flushThenClose, CHATS_FLUSH_SCRIPT, pendingCloseFlushes, withTimeout } from "../src/main/panelSenders";

function manualTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      pending.set(next, { fn, ms });
      return next++;
    },
    clearTimer: (h: unknown) => void pending.delete(h as number),
    fire: () => {
      for (const [k, t] of [...pending]) {
        pending.delete(k);
        t.fn();
      }
    },
    pending,
  };
}

describe("panel sender registry", () => {
  it("a panel is valid while its view lives", () => {
    const r = createPanelSenderRegistry();
    r.addPanel(7);
    expect(r.isPanel(7)).toBe(true);
    expect(r.isPanel(8)).toBe(false);
  });

  it("a released panel still delivers its final chat save during the grace period, then is forgotten", () => {
    const t = manualTimers();
    const r = createPanelSenderRegistry({ graceMs: 10_000, setTimer: t.setTimer, clearTimer: t.clearTimer });
    r.addPanel(7);
    r.release(7); // webContents "destroyed"
    expect(r.isPanel(7)).toBe(true);
    expect([...t.pending.values()][0].ms).toBe(10_000);
    t.fire();
    expect(r.isPanel(7)).toBe(false);
  });

  it("adding again cancels a pending release", () => {
    const t = manualTimers();
    const r = createPanelSenderRegistry({ setTimer: t.setTimer, clearTimer: t.clearTimer });
    r.addPanel(7);
    r.release(7);
    r.addPanel(7);
    expect(t.pending.size).toBe(0);
    t.fire();
    expect(r.isPanel(7)).toBe(true);
  });

  it("releasing an unknown id schedules nothing", () => {
    const t = manualTimers();
    const r = createPanelSenderRegistry({ setTimer: t.setTimer, clearTimer: t.clearTimer });
    r.release(99);
    expect(t.pending.size).toBe(0);
  });

  it("works with the real timer", () => {
    vi.useFakeTimers();
    try {
      const r = createPanelSenderRegistry({ graceMs: 50 });
      r.addPanel(1);
      r.release(1);
      expect(r.isPanel(1)).toBe(true);
      vi.advanceTimersByTime(60);
      expect(r.isPanel(1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withTimeout", () => {
  it("returns the value, or undefined for a rejection", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error("x")), 1000)).resolves.toBeUndefined();
  });

  it("gives up after the timeout when the promise never settles", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void withTimeout(new Promise(() => {}), 1000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("flushPage", () => {
  it("runs the handshake script and waits for its promise", async () => {
    let finish!: () => void;
    const runInPage = vi.fn(() => new Promise<void>((r) => (finish = r)));
    let done = false;
    void flushPage({ isDestroyed: () => false, runInPage }).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(runInPage).toHaveBeenCalledWith(CHATS_FLUSH_SCRIPT);
    expect(done).toBe(false);
    finish();
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(true);
  });

  it("the script calls window.penChatsFlush when it is a function", () => {
    expect(CHATS_FLUSH_SCRIPT).toBe("typeof window.penChatsFlush === 'function' ? window.penChatsFlush() : undefined");
  });

  it("does not run in a destroyed webContents and survives a throwing runInPage", async () => {
    const runInPage = vi.fn();
    await flushPage({ isDestroyed: () => true, runInPage });
    expect(runInPage).not.toHaveBeenCalled();
    await expect(flushPage({ isDestroyed: () => false, runInPage: () => { throw new Error("x"); } })).resolves.toBeUndefined();
  });
});

describe("flushThenClose", () => {
  it("flushes through the handshake, then closes (the order is the page's reply, not a tracker)", async () => {
    const order: string[] = [];
    let finishSave!: () => void;
    const port = {
      isDestroyed: () => false,
      runInPage: vi.fn((script: string) => {
        order.push("script:" + script);
        return new Promise<void>((r) => (finishSave = () => { order.push("saved"); r(); }));
      }),
      close: vi.fn(() => void order.push("close")),
    };
    const done = flushThenClose(port);
    await new Promise((r) => setTimeout(r, 20));
    expect(port.close).not.toHaveBeenCalled();
    expect(pendingCloseFlushes()).toHaveLength(1);
    finishSave();
    await done;
    expect(order).toEqual(["script:" + CHATS_FLUSH_SCRIPT, "saved", "close"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(pendingCloseFlushes()).toHaveLength(0);
  });

  it("closes even when the page script rejects", async () => {
    const port = { isDestroyed: () => false, runInPage: async () => { throw new Error("gone"); }, close: vi.fn() };
    await flushThenClose(port);
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  it("closes after the timeout when the page never answers", async () => {
    vi.useFakeTimers();
    try {
      const port = { isDestroyed: () => false, runInPage: () => new Promise<unknown>(() => {}), close: vi.fn() };
      const done = flushThenClose(port, { flushTimeoutMs: 3000 });
      await vi.advanceTimersByTimeAsync(2999);
      expect(port.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      await done;
      expect(port.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing to a webContents that is already destroyed", async () => {
    const port = { isDestroyed: () => true, runInPage: vi.fn(), close: vi.fn() };
    await flushThenClose(port);
    expect(port.runInPage).not.toHaveBeenCalled();
    expect(port.close).not.toHaveBeenCalled();
  });

  it("does not wait for another panel's flush", async () => {
    const slow = { isDestroyed: () => false, runInPage: () => new Promise<unknown>(() => {}), close: vi.fn() };
    const fast = { isDestroyed: () => false, runInPage: async () => undefined, close: vi.fn() };
    void flushThenClose(slow, { flushTimeoutMs: 60_000 });
    await flushThenClose(fast);
    expect(fast.close).toHaveBeenCalledTimes(1);
    expect(slow.close).not.toHaveBeenCalled();
  });
});
