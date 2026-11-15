import { describe, expect, it, vi } from "vitest";
import { createScheduler, TICK_MS, type SchedulerTimers } from "../src/main/schedules/scheduler";
import { createScheduleStore, type SchedulesFs } from "../src/main/schedules/store";
import type { McpPanelReply, McpPanelRequest } from "../src/main/mcp/types";

const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

function setup(start = at(2026, 3, 10, 8, 59, 50)) {
  let clock = start;
  let text: string | null = null;
  const fs: SchedulesFs = { readText: () => text, writeText: (_p, t) => void (text = t) };
  let nextId = 0;
  const store = createScheduleStore({ filePath: "/x", fs, now: () => clock, newId: () => `s${++nextId}` });
  const requests: McpPanelRequest[] = [];
  let reply: () => Promise<McpPanelReply> = async () => ({ task: { taskId: "chat1", title: "t", status: "running", updatedAt: 1, traces: [] } });
  const panel = { request: vi.fn((r: McpPanelRequest) => (requests.push(r), reply())) };
  let tickFn: (() => void) | null = null;
  const timers: SchedulerTimers & { cleared: number; ms?: number } = {
    cleared: 0,
    setInterval: (fn, ms) => {
      tickFn = fn;
      timers.ms = ms;
      return { unref: vi.fn() };
    },
    clearInterval: () => void timers.cleared++,
  };
  const scheduler = createScheduler({ store, panel, now: () => clock, timers });
  const add = (over: Partial<{ name: string; prompt: string; cron: string; enabled: boolean }> = {}) => {
    const r = scheduler.save({ name: "Prices", prompt: "Check", cron: "0 9 * * *", enabled: true, ...over });
    if ("error" in r) throw new Error(r.error);
    return r.schedule;
  };
  const advance = async (ms: number) => {
    clock += ms;
    scheduler.tick();
    await vi.waitFor(() => void 0);
    await Promise.resolve();
  };
  return { scheduler, store, panel, requests, add, advance, set: (t: number) => void (clock = t), setReply: (f: () => Promise<McpPanelReply>) => void (reply = f), timers, tickFn: () => tickFn };
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("scheduler", () => {
  it("ticks every 15 s with an unref'd timer, and dispose clears it", () => {
    const s = setup();
    s.scheduler.start();
    s.scheduler.start();
    expect(s.timers.ms).toBe(TICK_MS);
    expect(TICK_MS).toBe(15_000);
    s.scheduler.dispose();
    expect(s.timers.cleared).toBe(1);
  });

  it("fires once per matching minute, however many ticks fall in it", async () => {
    const s = setup();
    const sch = s.add();
    await s.advance(5_000); // 08:59:55
    expect(s.requests).toHaveLength(0);
    await s.advance(5_000); // 09:00:00
    await flush();
    expect(s.requests).toEqual([{ op: "schedule-start", scheduleId: sch.id, prompt: "Check", title: "Prices" }]);
    for (let i = 0; i < 4; i++) {
      await s.advance(15_000); // 09:00:15 .. 09:01:00 (the last is 09:01:00: no match)
      await flush();
    }
    expect(s.requests).toHaveLength(1);
    expect(s.store.get(sch.id)!.lastRun).toMatchObject({ status: "started", chatId: "chat1" });
  });

  it("fires again the next matching minute and passes the previous chat id", async () => {
    const s = setup();
    const sch = s.add({ cron: "* * * * *" });
    await s.advance(10_000);
    await flush();
    await s.advance(60_000);
    await flush();
    expect(s.requests).toHaveLength(2);
    expect(s.requests[0]).not.toHaveProperty("previousChatId");
    expect(s.requests[1]).toMatchObject({ scheduleId: sch.id, previousChatId: "chat1" });
  });

  it("skips a disabled schedule", async () => {
    const s = setup();
    s.add({ enabled: false });
    await s.advance(10_000);
    await flush();
    expect(s.requests).toHaveLength(0);
  });

  it("a busy reply is recorded as skipped, other errors as failed, a throw as failed", async () => {
    const s = setup();
    const sch = s.add({ cron: "* * * * *" });
    s.setReply(async () => ({ error: "The previous run is still running", code: "busy" }));
    await s.advance(10_000);
    await flush();
    expect(s.store.get(sch.id)!.lastRun).toMatchObject({ status: "skipped", error: "The previous run is still running" });
    s.setReply(async () => ({ error: "Sideform Light has no open window" }));
    await s.advance(60_000);
    await flush();
    expect(s.store.get(sch.id)!.lastRun).toMatchObject({ status: "failed", error: "Sideform Light has no open window" });
    s.setReply(async () => {
      throw new Error("boom");
    });
    await s.advance(60_000);
    await flush();
    expect(s.store.get(sch.id)!.lastRun).toMatchObject({ status: "failed", error: "boom" });
    s.setReply(async () => ({ ok: true }));
    await s.advance(60_000);
    await flush();
    expect(s.store.get(sch.id)!.lastRun).toMatchObject({ status: "failed" });
  });

  it("no catch-up: a long gap fires only the current minute", async () => {
    const s = setup();
    s.add({ cron: "0 * * * *" }); // every hour
    await s.advance(10_000); // 09:00:00 fires
    await flush();
    expect(s.requests).toHaveLength(1);
    s.set(at(2026, 3, 10, 14, 30)); // woke up 5 hours later at :30
    s.scheduler.tick();
    await flush();
    expect(s.requests).toHaveLength(1);
    s.set(at(2026, 3, 10, 15, 0, 5));
    s.scheduler.tick();
    await flush();
    expect(s.requests).toHaveLength(2);
  });

  it("a fresh scheduler does not repeat the minute lastRun already covers", async () => {
    const s = setup();
    const sch = s.add({ cron: "* * * * *" });
    await s.advance(10_000);
    await flush();
    expect(s.requests).toHaveLength(1);
    // a new process: same file, in-memory keys gone
    const again = createScheduler({ store: s.store, panel: s.panel, now: () => at(2026, 3, 10, 9, 0, 40) });
    again.tick();
    await flush();
    expect(s.requests).toHaveLength(1);
    expect(s.store.get(sch.id)!.lastRun?.at).toBe(at(2026, 3, 10, 9, 0, 0));
  });

  it("never fires a schedule twice at once (in-flight guard), but still consumes the minute", async () => {
    const s = setup();
    s.add({ cron: "* * * * *" });
    let release: (r: McpPanelReply) => void = () => undefined;
    s.setReply(() => new Promise<McpPanelReply>((r) => (release = r)));
    await s.advance(10_000);
    await s.advance(60_000); // next minute, the first fire has not been answered yet
    expect(s.requests).toHaveLength(1);
    release({ task: { taskId: "c", title: "t", status: "running", updatedAt: 1, traces: [] } });
    await flush();
    await s.advance(60_000);
    await flush();
    expect(s.requests).toHaveLength(2);
  });

  it("runNow fires regardless of enabled and of the minute, and returns the updated view", async () => {
    const s = setup();
    const sch = s.add({ enabled: false });
    const r = await s.scheduler.runNow(sch.id);
    expect(s.requests).toHaveLength(1);
    expect(r).toMatchObject({ schedule: { id: sch.id, nextRunAt: null, lastRun: { status: "started", chatId: "chat1" } } });
  });

  it("runNow on an unknown id, or while the same schedule is starting, is an error without a second request", async () => {
    const s = setup();
    expect(await s.scheduler.runNow("ghost")).toEqual({ error: expect.any(String) });
    const sch = s.add();
    let release: (r: McpPanelReply) => void = () => undefined;
    s.setReply(() => new Promise<McpPanelReply>((r) => (release = r)));
    const first = s.scheduler.runNow(sch.id);
    expect(await s.scheduler.runNow(sch.id)).toEqual({ error: expect.any(String) });
    release({ ok: true });
    await first;
    expect(s.requests).toHaveLength(1);
  });

  it("runNow in the minute a schedule matches stops the tick from firing it again", async () => {
    const s = setup(at(2026, 3, 10, 9, 0, 5));
    const sch = s.add({ cron: "0 9 * * *" });
    await s.scheduler.runNow(sch.id);
    s.scheduler.tick();
    await flush();
    expect(s.requests).toHaveLength(1);
  });

  it("a skipped or failed fire keeps the chat id of the last started run, so the next fire still sends previousChatId", async () => {
    const s = setup();
    const sch = s.add({ cron: "* * * * *" });
    await s.advance(10_000);
    await flush();
    s.setReply(async () => ({ error: "still running", code: "busy" }));
    await s.advance(60_000);
    await flush();
    expect(s.store.get(sch.id)!.lastRun).toMatchObject({ status: "skipped", chatId: "chat1" });
    s.setReply(async () => {
      throw new Error("boom");
    });
    await s.advance(60_000);
    await flush();
    expect(s.store.get(sch.id)!.lastRun).toMatchObject({ status: "failed", chatId: "chat1" });
    await s.advance(60_000);
    await flush();
    expect(s.requests.slice(1).every((r) => r.op === "schedule-start" && r.previousChatId === "chat1")).toBe(true);
    expect(s.requests).toHaveLength(4);
  });

  it("runNow marks the minute fired even when the in-memory key held an older minute", async () => {
    const s = setup(at(2026, 3, 9, 9, 0, 5));
    const sch = s.add({ cron: "0 9 * * *" });
    s.scheduler.tick();
    await flush();
    expect(s.requests).toHaveLength(1); // fired yesterday at 09:00; firedMinute holds that minute
    s.set(at(2026, 3, 10, 9, 0, 5));
    await s.scheduler.runNow(sch.id);
    s.scheduler.tick();
    await flush();
    expect(s.requests).toHaveLength(2);
  });

  it("a repeated local minute (clock set back, DST end) does not fire twice", async () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const s = setup(Date.UTC(2026, 10, 1, 5, 30, 10)); // 01:30 EDT
      s.add({ cron: "30 1 * * *" });
      s.scheduler.tick();
      await flush();
      expect(s.requests).toHaveLength(1);
      s.set(Date.UTC(2026, 10, 1, 6, 30, 10)); // 01:30 EST, an hour later: same local minute
      s.scheduler.tick();
      await flush();
      expect(s.requests).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it("parses each cron string once (cache), also for list()", () => {
    const s = setup();
    s.add({ cron: "5 4 * * *" });
    const a = s.scheduler.list()[0].nextRunAt;
    expect(s.scheduler.list()[0].nextRunAt).toBe(a);
    expect(a).not.toBeNull();
  });

  it("list gives nextRunAt for enabled schedules only", () => {
    const s = setup(at(2026, 3, 10, 8, 0));
    const a = s.add({ cron: "30 9 * * *" });
    const b = s.add({ cron: "30 9 * * *", enabled: false });
    const list = s.scheduler.list();
    expect(list.find((x) => x.id === a.id)!.nextRunAt).toBe(at(2026, 3, 10, 9, 30));
    expect(list.find((x) => x.id === b.id)!.nextRunAt).toBeNull();
  });

  it("onChanged fires after save, remove and a run; the unsubscribe works; a throwing listener is contained", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = setup();
    const cb = vi.fn();
    const off = s.scheduler.onChanged(cb);
    s.scheduler.onChanged(() => {
      throw new Error("x");
    });
    const sch = s.add();
    expect(cb).toHaveBeenCalledTimes(1);
    await s.scheduler.runNow(sch.id);
    expect(cb).toHaveBeenCalledTimes(2);
    s.scheduler.remove(sch.id);
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    s.add();
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("a schedule removed while its run is in flight is not resurrected", async () => {
    const s = setup();
    const sch = s.add();
    let release: (r: McpPanelReply) => void = () => undefined;
    s.setReply(() => new Promise<McpPanelReply>((r) => (release = r)));
    const run = s.scheduler.runNow(sch.id);
    s.scheduler.remove(sch.id);
    release({ ok: true });
    expect(await run).toEqual({ error: expect.any(String) });
    expect(s.scheduler.list()).toEqual([]);
  });
});
