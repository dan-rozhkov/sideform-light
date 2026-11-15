import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/store/chatStore";
import { useLanguageStore } from "@/i18n";
import {
  createScheduleViaBridge,
  formatScheduleTime,
  parseScheduleCreateInput,
  precheckScheduleCreate,
  precheckScheduleAction,
  parseScheduleActionInput,
  runScheduleAction,
  scheduleSetEnabled,
  scheduleDelete,
  scheduleList,
  BACKGROUND_ACTION_ERROR,
  BACKGROUND_CREATE_ERROR,
  isScheduleActionTool,
  SCHEDULE_ACTION_TOOLS,
} from "../schedules";
import { pendingScheduleActions } from "../pendingScheduleActions";
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

describe("schedule_set_enabled / schedule_delete", () => {
  const paused = { ...view, enabled: false };
  const bridge = (over: Record<string, unknown> = {}) => ({
    list: vi.fn(async () => ({ schedules: [view, { ...paused, id: "p1" }] })),
    create: vi.fn(),
    setEnabled: vi.fn(async (_id: string, enabled: boolean) => ({ schedule: { ...view, enabled } })),
    remove: vi.fn(async () => ({ ok: true as const })),
    ...over,
  });
  const err = (e: string) => JSON.stringify({ status: "error", error: e });

  it("validates the input (id pattern, enabled boolean)", async () => {
    setBridge(bridge());
    for (const bad of [null, {}, { id: "" }, { id: "a b", enabled: true }, { id: "x".repeat(129), enabled: true }, { id: "s1" }, { id: "s1", enabled: "yes" }]) {
      const out = JSON.parse((await precheckScheduleAction("schedule_set_enabled", bad, undefined)) as string);
      expect(out.status).toBe("error");
    }
    expect(JSON.parse((await precheckScheduleAction("schedule_delete", { id: "bad id" }, undefined)) as string).status).toBe("error");
    expect(parseScheduleActionInput("schedule_delete", { id: "s1", enabled: 5 })).toEqual({ tool: "schedule_delete", id: "s1" });
    expect(parseScheduleActionInput("schedule_set_enabled", { id: "s_1-A", enabled: false })).toEqual({ tool: "schedule_set_enabled", id: "s_1-A", enabled: false });
  });

  it("errors in background chats with the change wording, create keeps its own", async () => {
    setBridge(bridge());
    const s = useChatStore.getState();
    for (const source of ["mcp", "schedule"] as const) {
      const id = s.createChat({ activate: false, source });
      expect(await precheckScheduleAction("schedule_delete", { id: "s1" }, id)).toBe(err(BACKGROUND_ACTION_ERROR));
    }
    expect(BACKGROUND_ACTION_ERROR).toBe("Schedules can be changed only in a chat with the person.");
    expect(BACKGROUND_ACTION_ERROR).not.toContain("created");
    expect(BACKGROUND_CREATE_ERROR).toContain("created");
  });

  it("errors without the bridge methods", async () => {
    setBridge(undefined);
    expect(JSON.parse((await precheckScheduleAction("schedule_delete", { id: "s1" }, undefined)) as string).status).toBe("error");
    setBridge({ list: vi.fn(), create: vi.fn() });
    expect(JSON.parse((await precheckScheduleAction("schedule_set_enabled", { id: "s1", enabled: false }, undefined)) as string).status).toBe("error");
  });

  it("answers an unknown id at once", async () => {
    setBridge(bridge());
    const want = err("Unknown schedule id. Call schedule_list.");
    expect(await precheckScheduleAction("schedule_delete", { id: "nope" }, undefined)).toBe(want);
    expect(await precheckScheduleAction("schedule_set_enabled", { id: "nope", enabled: true }, undefined)).toBe(want);
  });

  it("answers a change that does nothing with updated, and keeps real changes pending", async () => {
    setBridge(bridge());
    const same = JSON.parse((await precheckScheduleAction("schedule_set_enabled", { id: "s1", enabled: true }, undefined)) as string);
    expect(same).toMatchObject({ status: "updated", schedule: { id: "s1", enabled: true, description: "Every weekday at 09:00" } });
    const samePaused = JSON.parse((await precheckScheduleAction("schedule_set_enabled", { id: "p1", enabled: false }, undefined)) as string);
    expect(samePaused).toMatchObject({ status: "updated", schedule: { id: "p1", enabled: false } });
    expect(await precheckScheduleAction("schedule_set_enabled", { id: "s1", enabled: false }, undefined)).toBeNull();
    expect(await precheckScheduleAction("schedule_set_enabled", { id: "p1", enabled: true }, undefined)).toBeNull();
    // delete never short-circuits on state
    expect(await precheckScheduleAction("schedule_delete", { id: "p1" }, undefined)).toBeNull();
  });

  it("records the schedule's details for the card only when it stays pending", async () => {
    setBridge(bridge());
    expect(await precheckScheduleAction("schedule_delete", { id: "s1" }, undefined, "c1")).toBeNull();
    expect(pendingScheduleActions.get("c1")).toEqual({ name: view.name, cron: view.cron, prompt: view.prompt, enabled: true });
    // answered at once: no record
    await precheckScheduleAction("schedule_delete", { id: "nope" }, undefined, "c2");
    await precheckScheduleAction("schedule_set_enabled", { id: "s1", enabled: true }, undefined, "c3");
    expect(pendingScheduleActions.get("c2")).toBeUndefined();
    expect(pendingScheduleActions.get("c3")).toBeUndefined();
    pendingScheduleActions.delete("c1");
    expect(pendingScheduleActions.get("c1")).toBeUndefined();
  });

  it("isScheduleActionTool follows SCHEDULE_ACTION_TOOLS", () => {
    for (const t of SCHEDULE_ACTION_TOOLS) expect(isScheduleActionTool(t)).toBe(true);
    expect(isScheduleActionTool("schedule_create")).toBe(false);
    expect(isScheduleActionTool(undefined)).toBe(false);
  });

  it("reports a list error", async () => {
    setBridge(bridge({ list: async () => ({ error: "boom" }) }));
    expect(await precheckScheduleAction("schedule_delete", { id: "s1" }, undefined)).toBe(JSON.stringify({ status: "error", error: "boom", fromShell: true }));
  });

  it("registry fallbacks never act", async () => {
    setBridge(bridge());
    expect(JSON.parse(await scheduleSetEnabled({ id: "s1", enabled: false }, ctx)).status).toBe("error");
    expect(JSON.parse(await scheduleDelete({ id: "s1" }, ctx)).status).toBe("error");
  });

  it("runScheduleAction calls the right bridge method with exact args", async () => {
    const b = bridge();
    setBridge(b);
    const u = JSON.parse(await runScheduleAction({ tool: "schedule_set_enabled", id: "s1", enabled: false }));
    expect(b.setEnabled).toHaveBeenCalledWith("s1", false);
    expect(u).toMatchObject({ status: "updated", schedule: { id: "s1", enabled: false, nextRun: "Mon 16 Nov 2026, 09:00" } });
    const d = JSON.parse(await runScheduleAction({ tool: "schedule_delete", id: "s1" }));
    expect(b.remove).toHaveBeenCalledWith("s1");
    expect(d).toEqual({ status: "deleted", id: "s1" });
    expect(b.create).not.toHaveBeenCalled();
  });

  it("runScheduleAction returns main's error message", async () => {
    setBridge(bridge({ setEnabled: async () => ({ error: "Schedule not found" }), remove: async () => ({ error: "Nope" }) }));
    expect(JSON.parse(await runScheduleAction({ tool: "schedule_set_enabled", id: "s1", enabled: true }))).toEqual({ status: "error", error: "Schedule not found", fromShell: true });
    expect(JSON.parse(await runScheduleAction({ tool: "schedule_delete", id: "s1" }))).toEqual({ status: "error", error: "Nope", fromShell: true });
  });

  it("keeps the summary English under a Russian UI", async () => {
    useLanguageStore.setState({ language: "ru" });
    setBridge(bridge());
    const out = JSON.parse((await precheckScheduleAction("schedule_set_enabled", { id: "s1", enabled: true }, undefined)) as string);
    expect(out.schedule.description).toBe("Every weekday at 09:00");
    expect(out.schedule.nextRun).toBe("Mon 16 Nov 2026, 09:00");
    const e = JSON.parse((await precheckScheduleAction("schedule_delete", { id: "zz" }, undefined)) as string);
    expect(e.error).toBe("Unknown schedule id. Call schedule_list.");
  });
});
