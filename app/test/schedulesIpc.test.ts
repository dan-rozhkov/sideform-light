import { describe, expect, it, vi } from "vitest";
import { registerSchedulesIpc } from "../src/main/schedules/schedulesIpc";
import type { BrowserSettingsEvent } from "../src/main/browserSettingsIpc";
import type { McpPanelReply } from "../src/main/mcp/types";

const VIEW = { id: "s1", name: "n", prompt: "p", cron: "* * * * *", enabled: true, createdAt: 1, updatedAt: 1, nextRunAt: 5 };
const INPUT = { name: "n", prompt: "p", cron: "* * * * *", enabled: true };

function setup(allowed = true) {
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
  const off = registerSchedulesIpc({ ipcMain, scheduler, panel, isSettingsSender: () => allowed, pushChanged, showPanel });
  const ev = { sender: { id: 1 } } as BrowserSettingsEvent;
  return { handlers, scheduler, panel, pushChanged, showPanel, off, ev, ipcMain, offChanged, fireChanged: () => changed(), setReply: (r: McpPanelReply) => void (reply = r) };
}
const CHANNELS = ["schedules:list", "schedules:open-chat", "schedules:remove", "schedules:run-now", "schedules:save"];

describe("schedules IPC", () => {
  it("registers exactly the five channels and removes them", () => {
    const s = setup();
    expect([...s.handlers.keys()].sort()).toEqual(CHANNELS);
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
});
