import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/store/chatStore";
import { useLanguageStore } from "@/i18n";
import {
  createScheduleViaBridge,
  formatScheduleTime,
  parseScheduleCreateInput,
  precheckScheduleCreate,
  scheduleList,
  BACKGROUND_CREATE_ERROR,
} from "../schedules";
import type { ScheduleView } from "@/lib/desktopBridge";

const at = new Date(2026, 10, 16, 9, 0).getTime();
const view: ScheduleView = {
  id: "s1",
  name: "Digest",
  prompt: "p",
  cron: "0 9 * * 1-5",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: at,
  lastRun: { at, status: "started" },
};
const ctx = { sessionId: "x" } as never;
const valid = { name: "Digest", prompt: "Do it", cron: "0 9 * * 1-5" };

function setBridge(b: unknown) {
  (window as unknown as { penAgentPanel?: unknown }).penAgentPanel = b === undefined ? undefined : { version: 3, schedules: b };
}

beforeEach(() => useChatStore.setState(useChatStore.getInitialState()));
afterEach(() => {
  setBridge(undefined);
  useLanguageStore.setState({ language: "en" });
});

describe("capability", () => {
  it("is sent only with the bridge", async () => {
    vi.resetModules();
    setBridge({ list: vi.fn(), create: vi.fn() });
    const on = await import("@/lib/chatTransport");
    expect((on.CLIENT_CAPABILITIES as Record<string, unknown>).schedules).toBe(true);
    vi.resetModules();
    setBridge(undefined);
    const off = await import("@/lib/chatTransport");
    expect("schedules" in off.CLIENT_CAPABILITIES).toBe(false);
  });
});

describe("schedule_list", () => {
  it("maps views to summaries", async () => {
    setBridge({ list: async () => ({ schedules: [view, { ...view, id: "s2", nextRunAt: null, lastRun: undefined }] }), create: vi.fn() });
    const out = JSON.parse(await scheduleList({}, ctx));
    expect(out.schedules[0]).toEqual({
      id: "s1",
      name: "Digest",
      cron: "0 9 * * 1-5",
      description: "Every weekday at 09:00",
      enabled: true,
      nextRun: "Mon 16 Nov 2026, 09:00",
      lastRun: { status: "started", at: "Mon 16 Nov 2026, 09:00" },
    });
    expect(out.schedules[1].nextRun).toBeUndefined();
    expect(out.schedules[1].lastRun).toBeUndefined();
    expect(formatScheduleTime(at)).toBe("Mon 16 Nov 2026, 09:00");
  });
  it("keeps the model-facing text English whatever the UI language", async () => {
    useLanguageStore.setState({ language: "ru" });
    setBridge({ list: async () => ({ schedules: [{ ...view, cron: "0 9 * * 1" }] }), create: vi.fn() });
    const out = JSON.parse(await scheduleList({}, ctx));
    expect(out.schedules[0].description).toBe("Every Monday at 09:00");
    expect(out.schedules[0].nextRun).toBe("Mon 16 Nov 2026, 09:00");
    expect(out.schedules[0].lastRun.at).toBe("Mon 16 Nov 2026, 09:00");
  });
  it("errors without the bridge and on bridge error", async () => {
    expect(JSON.parse(await scheduleList({}, ctx)).status).toBe("error");
    setBridge({ list: async () => ({ error: "boom" }), create: vi.fn() });
    expect(JSON.parse(await scheduleList({}, ctx))).toEqual({ status: "error", error: "boom" });
  });
});

describe("schedule_create precheck", () => {
  beforeEach(() => setBridge({ list: vi.fn(), create: vi.fn() }));
  it("stays pending for a valid call in a normal chat", () => {
    expect(precheckScheduleCreate(valid, useChatStore.getState().chats[0].id)).toBeNull();
  });
  it("rejects bad input", () => {
    for (const bad of [null, {}, { ...valid, name: "" }, { ...valid, name: "x".repeat(101) }, { ...valid, prompt: "" }, { ...valid, prompt: "x".repeat(20001) }, { ...valid, cron: "" }, { ...valid, cron: 5 }]) {
      expect(JSON.parse(precheckScheduleCreate(bad, undefined) as string).status).toBe("error");
    }
    expect(parseScheduleCreateInput(valid)).toEqual(valid);
  });
  it("errors in background chats", () => {
    const s = useChatStore.getState();
    for (const source of ["mcp", "schedule"] as const) {
      const id = s.createChat({ activate: false, source });
      expect(JSON.parse(precheckScheduleCreate(valid, id) as string)).toEqual({ status: "error", error: BACKGROUND_CREATE_ERROR });
    }
  });
  it("errors without the bridge", () => {
    setBridge(undefined);
    expect(JSON.parse(precheckScheduleCreate(valid, undefined) as string).status).toBe("error");
  });
});

describe("createScheduleViaBridge", () => {
  it("passes the exact input and returns created", async () => {
    const create = vi.fn(async () => ({ schedule: view }));
    setBridge({ list: vi.fn(), create });
    const out = JSON.parse(await createScheduleViaBridge(valid));
    expect(create).toHaveBeenCalledWith(valid);
    expect(out.status).toBe("created");
    expect(out.schedule.nextRun).toBe("Mon 16 Nov 2026, 09:00");
  });
  it("returns main's error message", async () => {
    setBridge({ list: vi.fn(), create: async () => ({ error: "Invalid cron" }) });
    expect(JSON.parse(await createScheduleViaBridge(valid))).toEqual({ status: "error", error: "Invalid cron" });
  });
});
