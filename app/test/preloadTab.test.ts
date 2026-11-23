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

  it("exposes penDesktop with exactly traces, browserSettings, mcp, schedules and settings", () => {
    expect(exposedName).toBe("penDesktop");
    expect(Object.keys(exposedApi).sort()).toEqual(["browserSettings", "mcp", "schedules", "settings", "traces"]);
  });

  it("mcp get / set / regenerateToken go over mcp-settings:get / set / regenerate-token", async () => {
    expect(Object.keys(exposedApi.mcp).sort()).toEqual(["get", "regenerateToken", "set"]);
    invokeMock.mockResolvedValueOnce({ enabled: false });
    await expect(exposedApi.mcp.get()).resolves.toEqual({ enabled: false });
    expect(invokeMock).toHaveBeenLastCalledWith("mcp-settings:get");
    await exposedApi.mcp.set({ enabled: true });
    expect(invokeMock).toHaveBeenLastCalledWith("mcp-settings:set", { enabled: true });
    await exposedApi.mcp.regenerateToken();
    expect(invokeMock).toHaveBeenLastCalledWith("mcp-settings:regenerate-token");
  });

  it("schedules go over schedules:*, and onChanged subscribes to schedules:changed and unsubscribes", async () => {
    expect(Object.keys(exposedApi.schedules).sort()).toEqual(["list", "onChanged", "remove", "runNow", "save"]);
    await exposedApi.schedules.list();
    expect(invokeMock).toHaveBeenLastCalledWith("schedules:list");
    const input = { name: "n", prompt: "p", cron: "* * * * *", enabled: true };
    await exposedApi.schedules.save(input);
    expect(invokeMock).toHaveBeenLastCalledWith("schedules:save", input);
    await exposedApi.schedules.remove("s1");
    expect(invokeMock).toHaveBeenLastCalledWith("schedules:remove", "s1");
    await exposedApi.schedules.runNow("s1");
    expect(invokeMock).toHaveBeenLastCalledWith("schedules:run-now", "s1");
    const cb = vi.fn();
    const off = exposedApi.schedules.onChanged(cb);
    const listener = onMock.mock.calls.find((c) => c[0] === "schedules:changed")![1];
    listener({});
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(removeListenerMock).toHaveBeenCalledWith("schedules:changed", listener);
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

  it("exposes version 3 with browser, chats, traces, settings, mcp and schedules only", () => {
    expect(exposedName).toBe("penAgentPanel");
    expect(exposedApi.version).toBe(3);
    expect(Object.keys(exposedApi).sort()).toEqual(["browser", "chats", "mcp", "schedules", "settings", "traces", "version"]);
  });

  describe("schedules (agent tools)", () => {
    it("has exactly list and create, over the panel-only channels", async () => {
      expect(Object.keys(exposedApi.schedules).sort()).toEqual(["create", "list", "remove", "setEnabled"]);
      await exposedApi.schedules.list();
      expect(invokeMock).toHaveBeenLastCalledWith("schedules:panel-list");
      const input = { name: "n", prompt: "p", cron: "0 9 * * *" };
      await exposedApi.schedules.create(input);
      expect(invokeMock).toHaveBeenLastCalledWith("schedules:panel-create", input);
      await exposedApi.schedules.setEnabled("s1", false);
      expect(invokeMock).toHaveBeenLastCalledWith("schedules:panel-set-enabled", { id: "s1", enabled: false });
      await exposedApi.schedules.remove("s1");
      expect(invokeMock).toHaveBeenLastCalledWith("schedules:panel-remove", "s1");
    });
  });

  describe("mcp (agent bridge)", () => {
    const requestListener = () => onMock.mock.calls.find((c) => c[0] === "mcp:task-request")![1] as (e: unknown, m: unknown) => void;

    it("has exactly onRequest and notifyChanged", () => {
      expect(Object.keys(exposedApi.mcp).sort()).toEqual(["notifyChanged", "onRequest"]);
    });

    it("onRequest registers with main (mcp:panel-ready) and returns an unsubscribe", () => {
      const off = exposedApi.mcp.onRequest(async () => ({ ok: true }));
      expect(sendMock).toHaveBeenCalledWith("mcp:panel-ready");
      expect(typeof off).toBe("function");
    });

    it("answers a request with mcp:task-reply { requestId, reply }", async () => {
      const handler = vi.fn(async () => ({ task: { taskId: "t1" } }));
      exposedApi.mcp.onRequest(handler);
      requestListener()({}, { requestId: "r1", request: { op: "get", taskId: "t1" } });
      await vi.waitFor(() => expect(sendMock).toHaveBeenCalledWith("mcp:task-reply", { requestId: "r1", reply: { task: { taskId: "t1" } } }));
      expect(handler).toHaveBeenCalledWith({ op: "get", taskId: "t1" });
    });

    it("a failing handler answers with an error value, never leaves main waiting", async () => {
      exposedApi.mcp.onRequest(async () => {
        throw new Error("secret detail");
      });
      requestListener()({}, { requestId: "r2", request: {} });
      await vi.waitFor(() => expect(sendMock).toHaveBeenCalledWith("mcp:task-reply", { requestId: "r2", reply: { error: "The task request failed" } }));
    });

    it("a second onRequest replaces the first handler (one ipc listener only)", async () => {
      const first = vi.fn(async () => ({ ok: true }));
      const second = vi.fn(async () => ({ ok: true }));
      exposedApi.mcp.onRequest(first);
      exposedApi.mcp.onRequest(second);
      expect(onMock.mock.calls.filter((c) => c[0] === "mcp:task-request")).toHaveLength(1);
      requestListener()({}, { requestId: "r3", request: {} });
      await vi.waitFor(() => expect(second).toHaveBeenCalled());
      expect(first).not.toHaveBeenCalled();
    });

    it("after unsubscribe a request is answered 'not ready'; malformed messages are ignored", async () => {
      const off = exposedApi.mcp.onRequest(async () => ({ ok: true }));
      off();
      sendMock.mockClear();
      requestListener()({}, { requestId: "r4", request: {} });
      requestListener()({}, null);
      requestListener()({}, { request: {} });
      expect(sendMock.mock.calls).toEqual([["mcp:task-reply", { requestId: "r4", reply: { error: "Sideform Light is not ready" } }]]);
    });

    it("notifyChanged sends mcp:task-changed { taskId }", () => {
      exposedApi.mcp.notifyChanged("t9");
      expect(sendMock).toHaveBeenLastCalledWith("mcp:task-changed", { taskId: "t9" });
    });
  });

  it("browser has the contract commands, isolated, closeSession and revealAgentTab; no desktop-app members", () => {
    const methods = [
      "open", "act", "findImages", "snapshot", "perform", "assert", "read", "screenshot", "tabs",
      "applyFixture", "releaseFixture", "clearActEmulation", "fillLogin", "startJournal", "stopJournal", "captureCheckpoint", "requests", "capture",
    ];
    for (const m of methods) expect(typeof exposedApi.browser[m], m).toBe("function");
    for (const m of ["isolated", "closeSession", "revealAgentTab"]) expect(typeof exposedApi.browser[m], m).toBe("function");
    for (const gone of ["launchApp", "releaseApp", "nativeApps", "forChat"]) expect(exposedApi.browser[gone], gone).toBeUndefined();
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
      "applyFixture", "releaseFixture", "clearActEmulation", "fillLogin", "startJournal", "stopJournal", "captureCheckpoint", "requests", "capture",
    ];
    for (const m of methods) expect(typeof iso[m], m).toBe("function");
    for (const m of methods) {
      invokeMock.mockClear();
      await iso[m]({});
      expect(invokeMock.mock.calls[0][0]).toBe("browser:command");
      expect(invokeMock.mock.calls[0][1]).toMatchObject({ command: m, session: "run-1" });
    }
  });

  it("isolated(id, { seedCookies }) carries the flag; without it the key is absent", async () => {
    await exposedApi.browser.isolated("run-1", { seedCookies: true }).snapshot();
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ session: "run-1", seedCookies: true });
    invokeMock.mockClear();
    await exposedApi.browser.isolated("run-1").snapshot();
    expect("seedCookies" in invokeMock.mock.calls[0][1]).toBe(false);
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

  it("mcp.onRequest: subscribe, unsubscribe, subscribe again still runs one request once (one listener)", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const off = exposedApi.mcp.onRequest(handler);
    off();
    exposedApi.mcp.onRequest(handler);
    const listeners = onMock.mock.calls.filter((c) => c[0] === "mcp:task-request");
    expect(listeners).toHaveLength(1);
    sendMock.mockClear();
    listeners[0][1]({}, { requestId: "r1", request: { op: "list", limit: 1 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledTimes(1);
    const replies = sendMock.mock.calls.filter((c) => c[0] === "mcp:task-reply");
    expect(replies).toEqual([["mcp:task-reply", { requestId: "r1", reply: { ok: true } }]]);
  });
});

