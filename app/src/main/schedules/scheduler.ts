// Fires schedules. Ticks every 15 s (clock and timers injectable); a schedule fires once per matching local minute
// (in-memory key, seeded lazily from `lastRun.at`), never catches up on minutes it missed, and never runs twice at the
// same time. A fire is one request on the MCP panel channel (`schedule-start`); its reply becomes `lastRun`.

import { nextRunAfter, parseCron, cronMatches, type CronParse } from "./cron";
import type { McpPanelPort } from "../mcp/types";
import type { Schedule, ScheduleInput, ScheduleStore, ScheduleView } from "./store";

export const TICK_MS = 15_000;

/** The local wall-clock minute as a key: matching uses local time, so a repeated local minute (DST end) is one key. */
const minuteKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
};

export interface SchedulerTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SchedulerOptions {
  store: ScheduleStore;
  panel: Pick<McpPanelPort, "request">;
  now?: () => number;
  timers?: SchedulerTimers;
  tickMs?: number;
}

export interface Scheduler {
  /** Starts ticking (the first check is one tick later, when the panel page has had time to register). Idempotent. */
  start(): void;
  /** Stops the timer and drops the listeners. */
  dispose(): void;
  /** One check of the clock. Exposed for tests; the timer calls it. */
  tick(): void;
  list(): ScheduleView[];
  save(input: ScheduleInput): { schedule: ScheduleView } | { error: string };
  remove(id: string): { ok: true } | { error: string };
  /** Fires now, whether or not the schedule is enabled. Resolves after the panel answered. */
  runNow(id: string): Promise<{ schedule: ScheduleView } | { error: string }>;
  /** Called after every change of the list or of a last run. Returns the unsubscribe. */
  onChanged(cb: () => void): () => void;
}

const defaultTimers: SchedulerTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const { store, panel } = opts;
  const now = opts.now ?? Date.now;
  const timers = opts.timers ?? defaultTimers;
  const tickMs = opts.tickMs ?? TICK_MS;
  const listeners = new Set<() => void>();
  /** schedule id -> local minute key of its last fire. */
  const firedMinute = new Map<string, string>();
  /** cron string -> parse result (the tick and `view` would otherwise reparse every schedule every time). */
  const cronCache = new Map<string, CronParse>();
  const parsedCron = (expr: string): CronParse => {
    let c = cronCache.get(expr);
    if (!c) {
      c = parseCron(expr);
      if (cronCache.size >= 500) cronCache.clear();
      cronCache.set(expr, c);
    }
    return c;
  };
  const inFlight = new Set<string>();
  let handle: unknown = null;

  const emit = () => {
    for (const cb of [...listeners]) {
      try {
        cb();
      } catch (err) {
        console.error("[schedules] change listener failed", err);
      }
    }
  };
  const view = (s: Schedule): ScheduleView => {
    let nextRunAt: number | null = null;
    if (s.enabled) {
      const parsed = parsedCron(s.cron);
      if ("cron" in parsed) nextRunAt = nextRunAfter(parsed.cron, new Date(now()))?.getTime() ?? null;
    }
    return { ...s, nextRunAt };
  };

  /** The fire itself. Returns null when this schedule is already starting or is gone. */
  async function fire(id: string): Promise<Schedule | null> {
    const s = store.get(id);
    if (!s || inFlight.has(id)) return null;
    inFlight.add(id);
    const at = now();
    firedMinute.set(id, minuteKey(at));
    // A skipped or failed fire keeps pointing at the most recent run that did start (it may still be running).
    const keepChat = s.lastRun?.chatId ? { chatId: s.lastRun.chatId } : {};
    let lastRun: NonNullable<Schedule["lastRun"]>;
    try {
      const reply = await panel.request({
        op: "schedule-start",
        scheduleId: s.id,
        prompt: s.prompt,
        title: s.name,
        ...(s.lastRun?.chatId ? { previousChatId: s.lastRun.chatId } : {}),
      });
      if ("task" in reply) lastRun = { at, status: "started", chatId: reply.task.taskId };
      else if ("error" in reply) lastRun = { at, status: reply.code === "busy" ? "skipped" : "failed", error: reply.error, ...keepChat };
      else lastRun = { at, status: "failed", error: "Sideform Light answered in an unexpected way.", ...keepChat };
    } catch (err) {
      lastRun = { at, status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "Could not start the run.", ...keepChat };
    } finally {
      inFlight.delete(id);
    }
    const updated = store.setLastRun(id, lastRun);
    emit();
    return updated;
  }

  function tick(): void {
    const t = now();
    const date = new Date(t);
    const minute = minuteKey(t);
    for (const s of store.list()) {
      if (!s.enabled) continue;
      const parsed = parsedCron(s.cron);
      if ("error" in parsed || !cronMatches(parsed.cron, date)) continue;
      const last = firedMinute.get(s.id) ?? (s.lastRun ? minuteKey(s.lastRun.at) : undefined);
      if (last === minute) continue;
      firedMinute.set(s.id, minute);
      void fire(s.id);
    }
  }

  return {
    start() {
      if (handle !== null) return;
      handle = timers.setInterval(tick, tickMs);
      (handle as { unref?: () => void } | null)?.unref?.();
    },
    dispose() {
      if (handle !== null) timers.clearInterval(handle);
      handle = null;
      listeners.clear();
    },
    tick,
    list: () => store.list().map(view),
    save(input) {
      const r = store.save(input);
      if ("error" in r) return r;
      emit();
      return { schedule: view(r.schedule) };
    },
    remove(id) {
      const r = store.remove(id);
      if ("error" in r) return r;
      firedMinute.delete(id);
      emit();
      return r;
    },
    async runNow(id) {
      if (!store.get(id)) return { error: "That schedule no longer exists." };
      if (inFlight.has(id)) return { error: "This schedule is already starting." };
      const updated = await fire(id);
      return updated ? { schedule: view(updated) } : { error: "That schedule no longer exists." };
    },
    onChanged(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
