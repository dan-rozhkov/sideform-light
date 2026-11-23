// A popup (`window.open`) of a browser tab is a real child window hosted as a tab: it keeps `window.opener`
// (OAuth / "Sign in with Google" report back with `opener.postMessage`), `window.open` returns a window,
// `window.close()` closes the tab and the opener sees `popup.closed`. Exactly ONE tab opens per call.
// Local http servers only, no network.

import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { launchShell } from "./launch";
import http from "node:http";
import type { AddressInfo } from "node:net";

let uiServer: http.Server;
let siteServer: http.Server;
let uiUrl: string;
let site: string;
let popupHits = 0;

test.beforeAll(async () => {
  uiServer = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>Stub Editor</title><h1 id="ready">stub-editor</h1>`);
  });
  await new Promise<void>((r) => uiServer.listen(0, "127.0.0.1", r));
  uiUrl = `http://127.0.0.1:${(uiServer.address() as AddressInfo).port}`;

  siteServer = http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    res.setHeader("content-type", "text/html");
    if (path === "/opener") {
      res.end(`<!doctype html><title>opener</title><script>
        window.received = [];
        window.addEventListener("message", (e) => window.received.push(e.data));
      </script>`);
      return;
    }
    if (path === "/popup") {
      popupHits++;
      // Replies through window.opener, then closes itself.
      res.end(`<!doctype html><title>popup</title><script>
        window.opener.postMessage("ok", "*");
        window.__sandboxed = typeof require === "undefined" && typeof process === "undefined";
        setTimeout(() => window.close(), 200);
      </script>`);
      return;
    }
    if (path === "/blank-writer") {
      res.end(`<!doctype html><title>writer</title><script>window.open2 = () => { const w = window.open(); w.document.write('<p id="x">hi</p>'); window.w = w; return !!w; };</script>`);
      return;
    }
    res.end(`<!doctype html><title>other</title>`);
  });
  await new Promise<void>((r) => siteServer.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${(siteServer.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  uiServer.closeAllConnections();
  await new Promise<void>((r) => uiServer.close(() => r()));
  siteServer.closeAllConnections();
  await new Promise<void>((r) => siteServer.close(() => r()));
});

type Tab = { tabId: number; url: string };
const tabsOf = async (editor: Page): Promise<Tab[]> =>
  ((await editor.evaluate(() =>
    (window as unknown as { penAgentPanel: { browser: { tabs(a: unknown): Promise<unknown> } } }).penAgentPanel.browser.tabs({ action: "list" }),
  )) as { tabs?: Tab[] }).tabs ?? [];
const browserCall = (editor: Page, method: string, arg: unknown): Promise<Record<string, unknown>> =>
  editor.evaluate(
    ({ method, arg }) =>
      (window as unknown as { penAgentPanel: { browser: Record<string, (a: unknown) => Promise<unknown>> } }).penAgentPanel.browser[method](arg),
    { method, arg },
  ) as Promise<Record<string, unknown>>;
const currentTab = async (editor: Page): Promise<Tab | undefined> =>
  (((await browserCall(editor, "tabs", { action: "list" })).tabs ?? []) as (Tab & { current?: boolean })[]).find((t) => t.current);
const pageAt = (app: ElectronApplication, url: string): Page | undefined => app.windows().find((p) => !p.isClosed() && p.url() === url);

test("window.open is a real child window: one tab, opener kept, postMessage and close() work", async () => {
  const app = await launchShell({ args: ["."], env: { ...process.env, SIDEFORM_LIGHT_UI_URL: uiUrl } });
  try {
    const editor = app.agentPage;
    const opened = await editor.evaluate(
      (url) => (window as unknown as { penAgentPanel: { browser: { open(a: unknown): Promise<unknown> } } }).penAgentPanel.browser.open({ url }),
      `${site}/opener`,
    );
    expect((opened as { error?: string }).error).toBeUndefined();
    await expect.poll(() => pageAt(app, `${site}/opener`) !== undefined).toBe(true);
    const opener = pageAt(app, `${site}/opener`)!;
    expect(await tabsOf(editor)).toHaveLength(1);

    // A third, unrelated tab sits between nothing and the popup: the opener must come back, not the left neighbour.
    expect((await browserCall(editor, "tabs", { action: "new", url: `${site}/other` })).error).toBeUndefined();
    await expect.poll(async () => (await tabsOf(editor)).length).toBe(2);
    const openerTab = (await tabsOf(editor)).find((t) => t.url === `${site}/opener`)!;
    expect((await browserCall(editor, "tabs", { action: "switch", tabId: openerTab.tabId })).error).toBeUndefined();
    await expect.poll(async () => (await currentTab(editor))?.tabId).toBe(openerTab.tabId);

    const isWindow = await opener.evaluate((url) => {
      const w = window.open(url, "x", "width=500,height=600");
      (window as unknown as { popup: Window | null }).popup = w;
      return w !== null && typeof w === "object";
    }, `${site}/popup`);
    expect(isWindow).toBe(true);

    // Exactly one new tab while the popup is open (3 in all).
    await expect.poll(async () => (await tabsOf(editor)).length).toBe(3);
    const popup = pageAt(app, `${site}/popup`);
    if (popup) expect(await popup.evaluate(() => (window as unknown as { __sandboxed?: boolean }).__sandboxed)).toBe(true);
    // The popup replied through window.opener.
    await expect.poll(() => opener.evaluate(() => (window as unknown as { received: unknown[] }).received)).toEqual(["ok"]);
    // window.close() in the popup: the opener sees it closed and the strip lost the tab.
    await expect.poll(() => opener.evaluate(() => (window as unknown as { popup: Window }).popup.closed)).toBe(true);
    await expect.poll(async () => (await tabsOf(editor)).length).toBe(2);
    expect((await tabsOf(editor)).some((t) => t.url.endsWith("/popup"))).toBe(false);
    expect(popupHits).toBe(1);
    // The agent follows back to the opener (not an unrelated tab) and the opener is the visible tab again.
    await expect.poll(async () => (await currentTab(editor))?.tabId).toBe(openerTab.tabId);
    await expect.poll(() => opener.evaluate(() => document.visibilityState)).toBe("visible");
    // The opener tab itself survived.
    expect(pageAt(app, `${site}/opener`)).toBeDefined();
  } finally {
    await app.close();
  }
});

test("a popup tab is hardened like any browser tab, shows up once, and outlives its closed opener", async () => {
  const app = await launchShell({ args: ["."], env: { ...process.env, SIDEFORM_LIGHT_UI_URL: uiUrl } });
  try {
    const editor = app.agentPage;
    await editor.evaluate(
      (url) => (window as unknown as { penAgentPanel: { browser: { open(a: unknown): Promise<unknown> } } }).penAgentPanel.browser.open({ url }),
      `${site}/opener`,
    );
    await expect.poll(() => pageAt(app, `${site}/opener`) !== undefined).toBe(true);
    const opener = pageAt(app, `${site}/opener`)!;
    // A popup that stays open, plus a scheme that must be denied (null: no window, no tab).
    const results = await opener.evaluate((url) => ({ ok: window.open(url + "?stay", "_blank") !== null, bad: window.open("file:///etc/passwd") === null }), `${site}/other`);
    expect(results).toEqual({ ok: true, bad: true });
    await expect.poll(async () => (await tabsOf(editor)).length).toBe(2);
    const popup = pageAt(app, `${site}/other?stay`)!;
    expect(popup).toBeDefined();
    expect(await popup.evaluate(() => typeof require === "undefined" && typeof process === "undefined" && !("penDesktop" in window))).toBe(true);
    expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
    // Closing the opener tab keeps the popup (like Chrome).
    const list = await tabsOf(editor);
    const openerTab = list.find((t) => t.url === `${site}/opener`)!;
    await editor.evaluate(
      (id) => (window as unknown as { penAgentPanel: { browser: { tabs(a: unknown): Promise<unknown> } } }).penAgentPanel.browser.tabs({ action: "close", tabId: id }),
      openerTab.tabId,
    );
    await expect.poll(async () => (await tabsOf(editor)).map((t) => t.url)).toEqual([`${site}/other?stay`]);
    expect(pageAt(app, `${site}/other?stay`)).toBeDefined();
  } finally {
    await app.close();
  }
});

test("window.open() filled by document.write: a gated CDP command on the popup tab answers at once", async () => {
  const app = await launchShell({ args: ["."], env: { ...process.env, SIDEFORM_LIGHT_UI_URL: uiUrl } });
  try {
    const editor = app.agentPage;
    await browserCall(editor, "open", { url: `${site}/blank-writer` });
    await expect.poll(() => pageAt(app, `${site}/blank-writer`) !== undefined).toBe(true);
    const opener = pageAt(app, `${site}/blank-writer`)!;
    expect(await opener.evaluate(() => (window as unknown as { open2(): boolean }).open2())).toBe(true);
    await expect.poll(async () => (await tabsOf(editor)).length).toBe(2);
    // The agent follows a popup of its own tab; `emulate` sends gated Emulation.* CDP (a 10 s gate timeout and an error if the popup never committed a document).
    const t0 = Date.now();
    await expect.poll(async () => JSON.stringify(await browserCall(editor, "read", {})), { timeout: 8000 }).toContain("hi");
    const res = await browserCall(editor, "applyFixture", { version: 1, emulate: { device: "iphone-15" } });
    expect(res.error, JSON.stringify(res)).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(6000);
  } finally {
    await app.close();
  }
});
