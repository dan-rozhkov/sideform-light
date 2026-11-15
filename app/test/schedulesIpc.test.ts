import { describe, expect, it, vi } from "vitest";
import { registerSchedulesIpc } from "../src/main/schedules/schedulesIpc";
import type { BrowserSettingsEvent } from "../src/main/browserSettingsIpc";
import type { McpPanelReply } from "../src/main/mcp/types";

const VIEW = { id: "s1", name: "n", prompt: "p", cron: "* * * * *", enabled: true, createdAt: 1, updatedAt: 1, nextRunAt: 5 };
const INPUT = { name: "n", prompt: "p", cron: "* * * * *", enabled: true };

function setup(allowed = true, panelAllowed = false) {
  const handlers = new Map<string, (e: BrowserSettingsEvent, ...a: unknown[]) => unknown>();
  const ipcMain = { handle: (c: string, l: never) => void handlers.set(c, l), removeHandler: vi.fn((c: string) => void handlers.delete(c)) };
  let changed: () => void = () => undefined;
  const offChanged = vi.fn();
  const scheduler = {
    list: vi.fn(() => [VIEW]),
    save: vi.fn((i: unknown) => ({ schedule: { ...VIEW, ...(i as object) } })),
    remove: vi.fn(() => ({ ok: true as const })),
    runNow: vi.fn(async () => ({ schedule: VIEW })),
    onChanged: vi.fn((cb: () => void) => ((changed = cb), offChanged)),
  };
  let reply: McpPanelReply = { ok: true };
  const panel = { request: vi.fn(async () => reply) };
  const pushChanged = vi.fn();
  const showPanel = vi.fn();
  const off = registerSchedulesIpc({ ipcMain, scheduler, panel, isSettingsSender: () => allowed, isPanelSender: () => panelAllowed, pushChanged, showPanel });
  const ev = { sender: { id: 1 } } as BrowserSettingsEvent;
  return { handlers, scheduler, panel, pushChanged, showPanel, off, ev, ipcMain, offChanged, fireChanged: () => changed(), setReply: (r: McpPanelReply) => void (reply = r) };
}
const CHANNELS = ["schedules:list", "schedules:open-chat", "schedules:remove", "schedules:run-now", "schedules:save"];
const PANEL_CHANNELS = ["schedules:panel-create", "schedules:panel-list"];
const PANEL_INPUT = { name: "n", prompt: "p", cron: "0 9 * * *" };

describe("schedules IPC", () => {
  it("registers exactly the seven channels and removes them", () => {
    const s = setup();
    expect([...s.handlers.keys()].sort()).toEqual([...CHANNELS, ...PANEL_CHANNELS].sort());
    s.off();
    expect(s.handlers.size).toBe(0);
    expect(s.offChanged).toHaveBeenCalled();
  });

  it("answers the Settings page", async () => {
    const s = setup();
    expect(await s.handlers.get("schedules:list")!(s.ev)).toEqual({ schedules: [VIEW] });
    expect(await s.handlers.get("schedules:save")!(s.ev, INPUT)).toEqual({ schedule: { ...VIEW, ...INPUT } });
    expect(await s.handlers.get("schedules:remove")!(s.ev, "s1")).toEqual({ ok: true });
    expect(s.scheduler.remove).toHaveBeenCalledWith("s1");
    expect(await s.handlers.get("schedules:run-now")!(s.ev, "s1")).toEqual({ schedule: VIEW });
    expect(s.scheduler.runNow).toHaveBeenCalledWith("s1");
  });

  it("any other sender gets { error: 'Not allowed.' } and nothing runs", async () => {
    const s = setup(false);
    for (const c of CHANNELS) expect(await s.handlers.get(c)!(s.ev, INPUT), c).toEqual({ error: "Not allowed." });
    expect(s.scheduler.list).not.toHaveBeenCalled();
    expect(s.scheduler.save).not.toHaveBeenCalled();
    expect(s.scheduler.remove).not.toHaveBeenCalled();
    expect(s.scheduler.runNow).not.toHaveBeenCalled();
    expect(s.panel.request).not.toHaveBeenCalled();
    expect(s.showPanel).not.toHaveBeenCalled();
  });

  it("save rejects bad payloads without calling the scheduler", async () => {
    const s = setup();
    const bad = [undefined, null, [], "x", {}, { ...INPUT, cron: "nope" }, { ...INPUT, name: "" }, { ...INPUT, enabled: 1 }, { ...INPUT, extra: 1 }, { ...INPUT, id: "bad id" }, { ...INPUT, prompt: "x".repeat(20001) }];
    for (const p of bad) expect(await s.handlers.get("schedules:save")!(s.ev, p), JSON.stringify(p)?.slice(0, 40)).toEqual({ error: expect.any(String) });
    expect(s.scheduler.save).not.toHaveBeenCalled();
  });

  it("save passes the cleaned input (trimmed) to the scheduler", async () => {
    const s = setup();
    await s.handlers.get("schedules:save")!(s.ev, { ...INPUT, name: "  n  " });
    expect(s.scheduler.save).toHaveBeenCalledWith(INPUT);
  });

  it("remove and run-now reject a bad id", async () => {
    const s = setup();
    for (const c of ["schedules:remove", "schedules:run-now"]) {
      for (const bad of [undefined, null, 5, "", "a b", "x".repeat(129), {}, ["s1"]]) {
        expect(await s.handlers.get(c)!(s.ev, bad), c).toEqual({ error: expect.any(String) });
      }
    }
    expect(s.scheduler.remove).not.toHaveBeenCalled();
    expect(s.scheduler.runNow).not.toHaveBeenCalled();
  });

  it("open-chat validates the id, sends op open and shows the panel on success", async () => {
    const s = setup();
    for (const bad of [undefined, 5, "", "a/b", "../x", "x".repeat(129)]) {
      expect(await s.handlers.get("schedules:open-chat")!(s.ev, bad)).toEqual({ error: expect.any(String) });
    }
    expect(s.panel.request).not.toHaveBeenCalled();
    expect(await s.handlers.get("schedules:open-chat")!(s.ev, "chat-1")).toEqual({ ok: true });
    expect(s.panel.request).toHaveBeenCalledWith({ op: "open", taskId: "chat-1" });
    expect(s.showPanel).toHaveBeenCalledTimes(1);
  });

  it("open-chat passes the panel's error through and does not show the panel", async () => {
    const s = setup();
    s.setReply({ error: "No such chat" });
    expect(await s.handlers.get("schedules:open-chat")!(s.ev, "chat-1")).toEqual({ error: "No such chat" });
    s.setReply({ tasks: [] });
    expect(await s.handlers.get("schedules:open-chat")!(s.ev, "chat-1")).toEqual({ error: expect.any(String) });
    expect(s.showPanel).not.toHaveBeenCalled();
  });

  it("a throwing scheduler gives an error value, never a throw", async () => {
    const s = setup();
    s.scheduler.list.mockImplementation(() => {
      throw new Error("secret");
    });
    expect(await s.handlers.get("schedules:list")!(s.ev)).toEqual({ error: "Could not complete the request." });
    s.panel.request.mockRejectedValueOnce(new Error("secret"));
    expect(await s.handlers.get("schedules:open-chat")!(s.ev, "c1")).toEqual({ error: "Could not complete the request." });
  });

  it("pushes schedules:changed on every scheduler change, and survives a failing push", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = setup();
    s.fireChanged();
    expect(s.pushChanged).toHaveBeenCalledTimes(1);
    s.pushChanged.mockImplementation(() => {
      throw new Error("x");
    });
    expect(() => s.fireChanged()).not.toThrow();
  });
  describe("panel channels", () => {
    it("list and create work for the agent panel only", async () => {
      const s = setup(false, true);
      expect(await s.handlers.get("schedules:panel-list")!(s.ev)).toEqual({ schedules: [VIEW] });
      expect(await s.handlers.get("schedules:panel-create")!(s.ev, PANEL_INPUT)).toEqual({ schedule: { ...VIEW, ...PANEL_INPUT, enabled: true } });
      expect(s.scheduler.save).toHaveBeenCalledWith({ ...PANEL_INPUT, enabled: true });
      // the Settings page rule does not apply to them, and the Settings channels stay closed to the panel
      expect(await s.handlers.get("schedules:save")!(s.ev, INPUT)).toEqual({ error: "Not allowed." });
    });

    it("a Settings tab or any other sender is rejected and nothing runs", async () => {
      const s = setup(true, false);
      for (const c of PANEL_CHANNELS) expect(await s.handlers.get(c)!(s.ev, PANEL_INPUT), c).toEqual({ error: "Not allowed." });
      expect(s.scheduler.list).not.toHaveBeenCalled();
      expect(s.scheduler.save).not.toHaveBeenCalled();
    });

    it("rejects extra keys, missing keys and non-string values", async () => {
      const s = setup(false, true);
      const create = s.handlers.get("schedules:panel-create")!;
      const bad: unknown[] = [
        null, "x", [], 5,
        { ...PANEL_INPUT, enabled: false },
        { ...PANEL_INPUT, id: "abc" },
        { name: "n", prompt: "p" },
        { ...PANEL_INPUT, name: 3 },
        { ...PANEL_INPUT, cron: undefined },
        Object.create({ inherited: 1 }),
      ];
      for (const b of bad) expect(await create(s.ev, b), JSON.stringify(b)).toEqual({ error: "Invalid schedule." });
      expect(s.scheduler.save).not.toHaveBeenCalled();
    });

    it("validates like schedules:save: trims, limits, and says what is wrong with the cron", async () => {
      const s = setup(false, true);
      const create = s.handlers.get("schedules:panel-create")!;
      await create(s.ev, { name: "  n  ", prompt: " p ", cron: " 0 9 * * * " });
      expect(s.scheduler.save).toHaveBeenCalledWith({ name: "n", prompt: "p", cron: "0 9 * * *", enabled: true });
      expect(await create(s.ev, { ...PANEL_INPUT, name: "   " })).toEqual({ error: "The name must be 1 to 100 characters." });
      expect(await create(s.ev, { ...PANEL_INPUT, prompt: "x".repeat(20001) })).toEqual({ error: "The task must be 1 to 20000 characters." });
      const bad = (await create(s.ev, { ...PANEL_INPUT, cron: "every day" })) as { error: string };
      expect(bad.error).toContain("5 fields");
      expect(bad.error).toContain("minute hour day-of-month month day-of-week");
      const badField = (await create(s.ev, { ...PANEL_INPUT, cron: "99 9 * * *" })) as { error: string };
      expect(badField.error).toContain("Invalid minute field");
      expect(s.scheduler.save).toHaveBeenCalledTimes(1);
    });

    it("returns the scheduler's own error (for example the 50 limit) and never throws", async () => {
      const s = setup(false, true);
      s.scheduler.save.mockReturnValueOnce({ error: "You can have at most 50 schedules." } as never);
      expect(await s.handlers.get("schedules:panel-create")!(s.ev, PANEL_INPUT)).toEqual({ error: "You can have at most 50 schedules." });
      s.scheduler.save.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      expect(await s.handlers.get("schedules:panel-create")!(s.ev, PANEL_INPUT)).toEqual({ error: "Could not complete the request." });
    });

    it("a change the scheduler reports (a panel create included) is pushed to the Settings tabs", () => {
      const s = setup(false, true);
      s.fireChanged();
      expect(s.pushChanged).toHaveBeenCalledTimes(1);
    });
  });
});
