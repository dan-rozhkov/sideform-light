import { describe, expect, it, vi } from "vitest";
import { parseMcpSettingsPatch, registerMcpSettingsIpc } from "../src/main/mcp/mcpSettingsIpc";
import type { BrowserSettingsEvent } from "../src/main/browserSettingsIpc";
import { isMcpPanelSender } from "../src/main/mcp/mcpPanelIpc";

const VIEW = { enabled: true, port: 47821, url: "http://127.0.0.1:47821/mcp", token: "t", status: { state: "listening" as const } };
function setup(allowed = true) {
  const handlers = new Map<string, (e: BrowserSettingsEvent, ...a: unknown[]) => unknown>();
  const ipcMain = { handle: (c: string, l: never) => void handlers.set(c, l), removeHandler: vi.fn((c: string) => void handlers.delete(c)) };
  const service = { get: vi.fn(() => VIEW), setEnabled: vi.fn(async () => VIEW), regenerateToken: vi.fn(async () => VIEW) };
  const off = registerMcpSettingsIpc({ ipcMain, service, isSettingsSender: () => allowed });
  const ev = { sender: { id: 1 } } as BrowserSettingsEvent;
  return { handlers, service, off, ev, ipcMain };
}

describe("mcp-settings IPC", () => {
  it("registers exactly the three channels and removes them", () => {
    const s = setup();
    expect([...s.handlers.keys()].sort()).toEqual(["mcp-settings:get", "mcp-settings:regenerate-token", "mcp-settings:set"]);
    s.off();
    expect(s.handlers.size).toBe(0);
  });

  it("answers the Settings page", async () => {
    const s = setup();
    expect(await s.handlers.get("mcp-settings:get")!(s.ev)).toEqual(VIEW);
    expect(await s.handlers.get("mcp-settings:set")!(s.ev, { enabled: true })).toEqual(VIEW);
    expect(s.service.setEnabled).toHaveBeenCalledWith(true);
    expect(await s.handlers.get("mcp-settings:regenerate-token")!(s.ev)).toEqual(VIEW);
  });

  it("any other sender gets { error: 'Not allowed.' } and nothing runs", async () => {
    const s = setup(false);
    for (const c of ["mcp-settings:get", "mcp-settings:set", "mcp-settings:regenerate-token"]) {
      expect(await s.handlers.get(c)!(s.ev, { enabled: true }), c).toEqual({ error: "Not allowed." });
    }
    expect(s.service.get).not.toHaveBeenCalled();
    expect(s.service.setEnabled).not.toHaveBeenCalled();
    expect(s.service.regenerateToken).not.toHaveBeenCalled();
  });

  it("set rejects a bad patch without calling the service", async () => {
    const s = setup();
    for (const bad of [undefined, null, [], "x", {}, { enabled: "yes" }, { enabled: true, token: "x" }, { port: 1 }]) {
      expect(await s.handlers.get("mcp-settings:set")!(s.ev, bad), JSON.stringify(bad)).toEqual({ error: "Invalid settings." });
    }
    expect(s.service.setEnabled).not.toHaveBeenCalled();
  });

  it("a throwing service gives an error value", async () => {
    const s = setup();
    s.service.get.mockImplementation(() => {
      throw new Error("secret");
    });
    expect(await s.handlers.get("mcp-settings:get")!(s.ev)).toEqual({ error: "Could not complete the request." });
  });

  it("parseMcpSettingsPatch accepts exactly { enabled: boolean }", () => {
    expect(parseMcpSettingsPatch({ enabled: false })).toEqual({ enabled: false });
    expect(parseMcpSettingsPatch(Object.create(null, { enabled: { value: true, enumerable: true } }))).toEqual({ enabled: true });
  });
});

describe("mcp panel sender check", () => {
  const PANEL = "app://sideform/agent";
  const deps = { panelUrlOf: (id: number) => (id === 3 ? PANEL : undefined) };
  it("accepts the panel's own webContents on the panel page only", () => {
    expect(isMcpPanelSender(deps, { id: 3, frameUrl: PANEL })).toBe(true);
    expect(isMcpPanelSender(deps, { id: 3, frameUrl: `${PANEL}?x=1` })).toBe(true);
  });
  it("rejects other webContents, other pages and a vanished frame", () => {
    expect(isMcpPanelSender(deps, { id: 4, frameUrl: PANEL })).toBe(false);
    expect(isMcpPanelSender(deps, { id: 3, frameUrl: "app://sideform/settings" })).toBe(false);
    expect(isMcpPanelSender(deps, { id: 3, frameUrl: "https://evil.example/agent" })).toBe(false);
    expect(isMcpPanelSender(deps, { id: 3, frameUrl: null })).toBe(false);
  });
});
