import { describe, expect, it, vi, beforeEach } from "vitest";

// Drives the two preload APIs through a mocked "electron" module (never imports Electron for real):
// - preload/tab.ts: `window.penDesktop`, the bridge of the ui's trace and settings pages;
// - preload/agentPanel.ts: `window.penAgentPanel` (version 3), the bridge of the agent panel.

const sendMock = vi.fn();
const onMock = vi.fn();
const removeListenerMock = vi.fn();
const invokeMock = vi.fn();

let exposedName: string | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let exposedApi: any;

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      exposedName = name;
      exposedApi = api;
    },
  },
  ipcRenderer: {
    send: sendMock,
    on: onMock,
    removeListener: removeListenerMock,
    invoke: invokeMock,
  },
}));

// The preloads' module-scope theme observers touch `document`/`window` at import time — stub the minimal shape
// they need (no DOM environment in this suite). `documentElement: null` takes the "defer until DOMContentLoaded"
// branch, which never touches anything else on these stubs; `window.top` is not `window`, so the panel's
// top-frame theme reporter stays off.
(globalThis as unknown as { document: unknown }).document = { documentElement: null, addEventListener: vi.fn() };
(globalThis as unknown as { window: unknown }).window = { addEventListener: vi.fn() };

async function load(file: "tab" | "agentPanel") {
  vi.resetModules();
  sendMock.mockClear();
  onMock.mockClear();
  removeListenerMock.mockClear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue("ok");
  exposedApi = undefined;
  exposedName = undefined;
  if (file === "tab") await import("../src/preload/tab");
  else await import("../src/preload/agentPanel");
}

describe("preload/tab.ts (trace and settings pages)", () => {
  beforeEach(() => load("tab"));

  it("exposes penDesktop with exactly traces, browserSettings and settings", () => {
    expect(exposedName).toBe("penDesktop");
    expect(Object.keys(exposedApi).sort()).toEqual(["browserSettings", "settings", "traces"]);
  });

  it("has no browser bridge and none of the removed surfaces", () => {
    for (const gone of ["browser", "canvases", "docs", "workflows", "logins", "auth", "appIcon", "canvasHost", "registerMcpBridge", "onMenuCommand", "setDocumentTitle", "agentLayout"]) {
      expect(exposedApi[gone], gone).toBeUndefined();
    }
  });

  it("traces is read only, over traces:read", async () => {
    expect(Object.keys(exposedApi.traces)).toEqual(["read"]);
    invokeMock.mockResolvedValueOnce({ error: "trace not found" });
    await expect(exposedApi.traces.read("t1")).resolves.toEqual({ error: "trace not found" });
    expect(invokeMock).toHaveBeenLastCalledWith("traces:read", "t1");
  });

  it("browserSettings get/set go over browser-settings:get / browser-settings:set", async () => {
    expect(Object.keys(exposedApi.browserSettings).sort()).toEqual(["get", "set"]);
    invokeMock.mockResolvedValueOnce({ adBlock: true });
    await expect(exposedApi.browserSettings.get()).resolves.toEqual({ adBlock: true });
    expect(invokeMock).toHaveBeenLastCalledWith("browser-settings:get");
    await exposedApi.browserSettings.set({ adBlock: false });
    expect(invokeMock).toHaveBeenLastCalledWith("browser-settings:set", { adBlock: false });
  });

  it("settings exposes open (over settings:open) and onSection", async () => {
    expect(Object.keys(exposedApi.settings)).toEqual(["open", "onSection"]);
    invokeMock.mockResolvedValueOnce({ ok: true });
    await expect(exposedApi.settings.open("browser")).resolves.toEqual({ ok: true });
    expect(invokeMock).toHaveBeenLastCalledWith("settings:open", "browser");
    await exposedApi.settings.open();
    expect(invokeMock).toHaveBeenLastCalledWith("settings:open", undefined);
  });

  it("onSection subscribes to settings:section, passes only strings, and unsubscribes", () => {
    const cb = vi.fn();
    const off = exposedApi.settings.onSection(cb);
    expect(onMock).toHaveBeenCalledWith("settings:section", expect.any(Function));
    const listener = onMock.mock.calls.find((c) => c[0] === "settings:section")![1];
    listener({}, "browser");
    listener({}, 42);
    listener({}, undefined);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("browser");
    off();
    expect(removeListenerMock).toHaveBeenCalledWith("settings:section", listener);
  });
});

describe("preload/agentPanel.ts (penAgentPanel v3)", () => {
  beforeEach(() => load("agentPanel"));

  it("exposes version 3 with browser, chats, traces and settings only", () => {
    expect(exposedName).toBe("penAgentPanel");
    expect(exposedApi.version).toBe(3);
    expect(Object.keys(exposedApi).sort()).toEqual(["browser", "chats", "settings", "traces", "version"]);
  });

  it("browser has the contract commands, isolated, closeSession and revealAgentTab; no desktop-app members", () => {
    const methods = [
      "open", "act", "findImages", "snapshot", "perform", "assert", "read", "screenshot", "tabs",
      "applyFixture", "releaseFixture", "clearActEmulation", "fillLogin", "startJournal", "stopJournal", "captureCheckpoint", "requests",
    ];
    for (const m of methods) expect(typeof exposedApi.browser[m], m).toBe("function");
    for (const m of ["isolated", "closeSession", "revealAgentTab"]) expect(typeof exposedApi.browser[m], m).toBe("function");
    for (const gone of ["capture", "launchApp", "releaseApp", "nativeApps", "forChat"]) expect(exposedApi.browser[gone], gone).toBeUndefined();
  });

  it("the shared browser sends no session key", async () => {
    await exposedApi.browser.open({ url: "https://a.test" });
    expect(invokeMock.mock.calls[0][1]).toEqual({ command: "open", args: { url: "https://a.test" } });
    expect("session" in invokeMock.mock.calls[0][1]).toBe(false);
  });

  it("isolated(id) has every method of browser and tags each call with the session", async () => {
    const iso = exposedApi.browser.isolated("run-1");
    const methods = [
      "open", "act", "findImages", "snapshot", "perform", "assert", "read", "screenshot", "tabs",
      "applyFixture", "releaseFixture", "clearActEmulation", "fillLogin", "startJournal", "stopJournal", "captureCheckpoint", "requests",
    ];
    for (const m of methods) expect(typeof iso[m], m).toBe("function");
    for (const m of methods) {
      invokeMock.mockClear();
      await iso[m]({});
      expect(invokeMock.mock.calls[0][0]).toBe("browser:command");
      expect(invokeMock.mock.calls[0][1]).toMatchObject({ command: m, session: "run-1" });
    }
  });

  it("isolated(undefined) still carries a session key, so main rejects it instead of using the shared browser", async () => {
    await exposedApi.browser.isolated(undefined).snapshot();
    expect("session" in invokeMock.mock.calls[0][1]).toBe(true);
  });

  it("closeSession sends the closeSession command", async () => {
    await exposedApi.browser.closeSession("run-1");
    expect(invokeMock).toHaveBeenCalledWith("browser:command", { command: "closeSession", session: "run-1" });
  });

  it("revealAgentTab goes over browser:reveal-agent-tab", async () => {
    await exposedApi.browser.revealAgentTab("run-1");
    expect(invokeMock).toHaveBeenLastCalledWith("browser:reveal-agent-tab", { session: "run-1" });
  });

  it("checkpoint journal commands: startJournal sends the opts, stopJournal and captureCheckpoint the token", async () => {
    await exposedApi.browser.startJournal({ origins: ["https://a.test"] });
    expect(invokeMock).toHaveBeenLastCalledWith("browser:command", { command: "startJournal", args: { origins: ["https://a.test"] } });
    await exposedApi.browser.stopJournal("tok");
    expect(invokeMock).toHaveBeenLastCalledWith("browser:command", { command: "stopJournal", args: { token: "tok" } });
    invokeMock.mockResolvedValue({ ok: true });
    await expect(exposedApi.browser.captureCheckpoint("tok")).resolves.toEqual({ ok: true });
    expect(invokeMock).toHaveBeenLastCalledWith("browser:command", { command: "captureCheckpoint", args: { token: "tok" } });
  });

  it("requests sends no args and resolves to the main result", async () => {
    invokeMock.mockResolvedValueOnce({ requests: [], dropped: 2 });
    await expect(exposedApi.browser.requests()).resolves.toEqual({ requests: [], dropped: 2 });
    expect(invokeMock).toHaveBeenLastCalledWith("browser:command", { command: "requests", args: {} });
  });

  it("fillLogin forwards only label and submit", async () => {
    await exposedApi.browser.fillLogin({ label: "Work", submit: true, password: "nope" });
    expect(invokeMock).toHaveBeenLastCalledWith("browser:command", { command: "fillLogin", args: { label: "Work", submit: true } });
  });

  it("chats: list, read, save and remove over chats:*", async () => {
    expect(Object.keys(exposedApi.chats).sort()).toEqual(["list", "read", "remove", "save"]);
    await exposedApi.chats.list();
    expect(invokeMock).toHaveBeenLastCalledWith("chats:list");
    await exposedApi.chats.read("c1");
    expect(invokeMock).toHaveBeenLastCalledWith("chats:read", "c1");
    await exposedApi.chats.save({ id: "c1" });
    expect(invokeMock).toHaveBeenLastCalledWith("chats:save", { id: "c1" });
    await exposedApi.chats.remove("c1");
    expect(invokeMock).toHaveBeenLastCalledWith("chats:delete", "c1");
  });

  it("traces: save, open, listTabs, read over traces:*", async () => {
    expect(Object.keys(exposedApi.traces).sort()).toEqual(["listTabs", "open", "read", "save"]);
    const payload = { manifest: { id: "t1" }, assets: [] };
    await exposedApi.traces.save(payload);
    expect(invokeMock).toHaveBeenLastCalledWith("traces:save", payload);
    await exposedApi.traces.open("t1");
    expect(invokeMock).toHaveBeenLastCalledWith("traces:open", "t1");
    await exposedApi.traces.listTabs();
    expect(invokeMock).toHaveBeenLastCalledWith("traces:list-tabs");
    await exposedApi.traces.read("t1");
    expect(invokeMock).toHaveBeenLastCalledWith("traces:read", "t1");
    await exposedApi.traces.read("t1", { frames: false });
    expect(invokeMock).toHaveBeenLastCalledWith("traces:read", "t1", { frames: false });
  });

  it("settings.open goes over settings:open", async () => {
    expect(Object.keys(exposedApi.settings)).toEqual(["open"]);
    await exposedApi.settings.open("appearance");
    expect(invokeMock).toHaveBeenLastCalledWith("settings:open", "appearance");
  });
});
