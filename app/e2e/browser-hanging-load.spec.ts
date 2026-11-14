// A page whose load never finishes (one subresource that never answers) must stay scriptable for
// the agent: snapshot / read / act / screenshot answer at once although webContents.isLoading() is
// still true. webContents.executeJavaScript is gated on the load ending (electron/electron#5183);
// a tab whose navigation committed and reached dom-ready but still loads runs its page scripts through the
// main frame instead (scriptRoute.ts); every other tab keeps the default path.
// Stub servers on localhost only, no backend, no LLM.

import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { launchShell } from "./launch";
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
    res.end(
      `<!doctype html><title>Hanging subresource</title><h1>page-ready</h1>` +
        `<button id="go" onclick="document.title='clicked'">Go</button><p>Some readable text on the page.</p>` +
        `<img src="/hang" alt="never loads" width="1" height="1">`,
    );
  });
  await new Promise<void>((resolve) => siteServer.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${(siteServer.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => editorServer.close(() => r()));
  siteServer.closeAllConnections();
  await new Promise<void>((r) => siteServer.close(() => r()));
});

type Res = Record<string, unknown> & { error?: string };

function call(page: Page, session: string | null, method: string, ...args: unknown[]): Promise<Res> {
  return page.evaluate(
    ({ session, method, args }) => {
      const b = (window as unknown as { penAgentPanel: { browser: Record<string, unknown> & { isolated(id: string): Record<string, unknown> } } })
        .penAgentPanel.browser;
      const target = session === null ? b : b.isolated(session);
      return (target[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    },
    { session, method, args },
  ) as Promise<Res>;
}

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

for (const session of [null, "hang-iso"]) {
  test(`${session === null ? "shared browser" : "isolated session"}: commands answer fast while the page is still loading`, async () => {
    const app = await launchShell({ args: ["."], env: { ...process.env, SIDEFORM_LIGHT_UI_URL: editorBaseUrl } });
    try {
      const editor = app.agentPage;
      await expect(editor.locator("#ready")).toHaveText("stub-editor");
      const timed = async <T extends Res>(name: string, method: string, ...args: unknown[]): Promise<T> => {
        const t0 = Date.now();
        const r = (await call(editor, session, method, ...args)) as T;
        const ms = Date.now() - t0;
        console.log(`hang-timing ${session ?? "shared"} ${name}: ${ms}ms`);
        expect(r.error, `${name} error`).toBeUndefined();
        expect(ms, `${name} duration`).toBeLessThan(5_000);
        return r;
      };

      await timed("open", "open", { url: `${site}/` });
      const snap = await timed<Res & { snapshotId: string; elements: { index: number; label: string }[] }>("snapshot", "snapshot");
      const go = snap.elements.find((e) => e.label === "Go");
      expect(go, "the Go button is in the snapshot").toBeDefined();
      expect(await isLoadingAt(app, `${site}/`)).toBe(true);

      const read = await timed<Res & { text?: string }>("read", "read");
      expect(JSON.stringify(read)).toContain("Some readable text");

      await timed("perform click by index", "perform", { snapshotId: snap.snapshotId, index: go!.index, operation: "CLICK" });
      await timed("screenshot annotate", "screenshot", { annotate: true });
      expect(await isLoadingAt(app, `${site}/`)).toBe(true);
    } finally {
      await app.close();
    }
  });
}
