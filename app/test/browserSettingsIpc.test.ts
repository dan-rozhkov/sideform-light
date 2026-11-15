import { describe, it, expect, vi } from "vitest";
import { createBrowserSettingsIpc, isSettingsSender, type BrowserSettingsEvent } from "../src/main/browserSettingsIpc";

const SETTINGS = "app://sideform/settings?section=browser";
function setup() {
  const handlers = new Map<string, (e: BrowserSettingsEvent, ...a: unknown[]) => unknown>();
  const ipcMain = { handle: (c: string, l: never) => void handlers.set(c, l), removeHandler: vi.fn((c: string) => void handlers.delete(c)) };
  const state = { adBlock: true };
  const store = { get: () => ({ ...state }), set: vi.fn((p: Partial<typeof state>) => Object.assign(state, p) && { ...state }) };
  const ipc = createBrowserSettingsIpc({ ipcMain, store });
  const main = { url: "" };
  const port = { isSettingsViewer: (id: number, url: string | undefined) => id === 7 && url === SETTINGS };
  ipc.addWindow(port);
  const ev = (id: number, url: string | undefined, top = true): BrowserSettingsEvent => ({
    sender: { id, mainFrame: main },
    senderFrame: top ? Object.assign(main, { url }) : { url },
  });
  return { handlers, ipc, store, ev, ipcMain, port };
}

describe("browser-settings IPC", () => {
  it("registers exactly the two channels", () => {
    expect([...setup().handlers.keys()].sort()).toEqual(["browser-settings:get", "browser-settings:set"]);
  });
  it("isSender applies the same rule to any event (used by mcp-settings:*)", () => {
    const s = setup();
    expect(s.ipc.isSender(s.ev(7, SETTINGS))).toBe(true);
    expect(s.ipc.isSender(s.ev(8, SETTINGS))).toBe(false);
    expect(s.ipc.isSender(s.ev(7, SETTINGS, false))).toBe(false);
  });
  it("pushSchedulesChanged reaches every window; showAgentPanelOf expands only the window that owns the panel", () => {
    const s = setup();
    const a = { isSettingsViewer: () => false, sendSchedulesChanged: vi.fn(), showAgentPanel: vi.fn(), ownsPanel: (id: number) => id === 11 };
    const b = { isSettingsViewer: () => false, showAgentPanel: vi.fn(), ownsPanel: (id: number) => id === 22 };
    const withdraw = s.ipc.addWindow(a);
    s.ipc.addWindow(b);
    s.ipc.pushSchedulesChanged();
    s.ipc.showAgentPanelOf(11);
    s.ipc.showAgentPanelOf(null);
    s.ipc.showAgentPanelOf(99);
    expect(a.sendSchedulesChanged).toHaveBeenCalledTimes(1);
    expect(a.showAgentPanel).toHaveBeenCalledTimes(1);
    expect(b.showAgentPanel).not.toHaveBeenCalled();
    withdraw();
    s.ipc.pushSchedulesChanged();
    expect(a.sendSchedulesChanged).toHaveBeenCalledTimes(1);
  });
  it("answers the settings page top frame", () => {
    const s = setup();
    expect(s.handlers.get("browser-settings:get")!(s.ev(7, SETTINGS))).toEqual({ adBlock: true });
    expect(s.handlers.get("browser-settings:set")!(s.ev(7, SETTINGS), { adBlock: false })).toEqual({ adBlock: false });
  });
  it("rejects the removed keys", () => {
    const s = setup();
    for (const patch of [{ askAppAccess: true }, { mcpBrowser: true }]) {
      expect(s.handlers.get("browser-settings:set")!(s.ev(7, SETTINGS), patch)).toEqual({ error: "Invalid settings." });
    }
    expect(s.store.set).not.toHaveBeenCalled();
  });
  it("rejects a bad patch with an error and stores nothing", () => {
    const s = setup();
    const r = s.handlers.get("browser-settings:set")!(s.ev(7, SETTINGS), { adBlock: "x" }) as { error: string };
    expect(r.error).toBeTruthy();
    expect(s.store.set).not.toHaveBeenCalled();
  });
  it("answers a failed save with an error", () => {
    const s = setup();
    s.store.set.mockReturnValueOnce(null as never);
    expect(s.handlers.get("browser-settings:set")!(s.ev(7, SETTINGS), { adBlock: false })).toEqual({ error: "Could not save the setting." });
  });
  it("denies other senders, sub-frames and other pages", () => {
    const s = setup();
    for (const e of [s.ev(8, SETTINGS), s.ev(7, "https://app.test/app"), s.ev(7, SETTINGS, false), { sender: { id: 7 }, senderFrame: null }]) {
      expect(s.handlers.get("browser-settings:get")!(e as never)).toEqual({ error: "Not allowed." });
      expect(s.handlers.get("browser-settings:set")!(e as never, { adBlock: false })).toEqual({ error: "Not allowed." });
    }
    expect(s.store.set).not.toHaveBeenCalled();
  });
  it("a withdrawn window no longer answers; dispose removes handlers", () => {
    const s = setup();
    const off = s.ipc.addWindow({ isSettingsViewer: () => true });
    expect(isSettingsSender([{ isSettingsViewer: () => true }], s.ev(1, "x"))).toBe(true);
    off();
    expect(s.handlers.get("browser-settings:get")!(s.ev(9, SETTINGS))).toEqual({ error: "Not allowed." });
    s.ipc.dispose();
    expect(s.handlers.size).toBe(0);
  });
});
