// The tab strip's loading fill follows the main-frame document, not every resource: a page whose
// subresource never answers must not keep the fill creeping at 80% (src/main/tabLoading.ts).

import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { launchShell, waitForShellViews } from "./launch";
import http from "node:http";
import type { AddressInfo } from "node:net";

let editorServer: http.Server;
let siteServer: http.Server;
let editorBaseUrl: string;
let site: string;

test.beforeAll(async () => {
  editorServer = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>Stub Editor</title><h1 id="ready">stub-editor</h1>`);
  });
  await new Promise<void>((resolve) => editorServer.listen(0, "127.0.0.1", resolve));
  editorBaseUrl = `http://127.0.0.1:${(editorServer.address() as AddressInfo).port}`;

  siteServer = http.createServer((req, res) => {
    if (req.url?.startsWith("/hang")) return; // never answers
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>Hanging subresource</title><h1 id="ready">page-ready</h1><img src="/hang" alt="never loads">`);
  });
  await new Promise<void>((resolve) => siteServer.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${(siteServer.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => editorServer.close(() => r()));
  siteServer.closeAllConnections();
  await new Promise<void>((r) => siteServer.close(() => r()));
});

const isLoadingAt = (app: ElectronApplication, prefix: string): Promise<boolean | null> =>
  app.evaluate(({ BaseWindow }, prefix) => {
    for (const w of BaseWindow.getAllWindows()) {
      for (const v of w.contentView.children) {
        if (!("webContents" in v)) continue;
        const wc = (v as unknown as { webContents: Electron.WebContents }).webContents;
        if (wc.getURL().startsWith(prefix)) return wc.isLoading();
      }
    }
    return null;
  }, prefix);

test("the loading fill ends at dom-ready although a subresource never completes", async () => {
  const app = await launchShell({ args: ["."], env: { ...process.env, SIDEFORM_LIGHT_UI_URL: editorBaseUrl } });
  try {
    const tabbar: Page = await waitForShellViews(app);
    const editor = app.agentPage;
    await expect(editor.locator("#ready")).toHaveText("stub-editor");
    const opened = await editor.evaluate(
      (url) => (window as unknown as { penAgentPanel: { browser: { open(o: { url: string }): Promise<{ error?: string }> } } }).penAgentPanel.browser.open({ url }),
      `${site}/`,
    );
    expect(opened.error).toBeUndefined();

    await expect(tabbar.locator(".tab")).toHaveCount(1);
    // The fill is finished (invisible) within a few seconds ...
    await expect
      .poll(() => tabbar.locator(".tab-progress").evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
      .toBe("0");
    // ... while the page is still "loading" for Chromium because of the hanging image.
    expect(await isLoadingAt(app, `${site}/`)).toBe(true);
  } finally {
    await app.close();
  }
});
