import { test, expect, _electron as electron, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { revealMenuLabel } from "../src/main/revealMenuLabel";
import { startStubUi } from "./stubUi";

// Reveal in Finder in a real Electron window: the File item follows the active tab (enabled for a trace tab,
// which has a folder on disk; off for a browser tab), the click reveals the stored trace, and a right-click on
// a tab does not activate it. Native popups cannot be clicked from Playwright, so the tab context menu itself
// is covered by unit tests only.
let stub: Awaited<ReturnType<typeof startStubUi>>;

test.beforeAll(async () => {
  stub = await startStubUi();
});
test.afterAll(() => stub.close());

test("reveal item: disabled without a trace tab, enabled for one, click reveals the stored trace", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "reveal-e2e-"));
  // The trace folder exists (a saved trace has one); its trace.json does not, so the folder itself is opened.
  const traceDir = path.join(userData, "browse-traces", "tr_reveal");
  fs.mkdirSync(traceDir, { recursive: true });
  const app = await electron.launch({ args: ["."], env: { ...process.env, SIDEFORM_LIGHT_UI_URL: stub.url, SIDEFORM_LIGHT_USER_DATA_DIR: userData } });
  try {
    const find = async (pred: (u: string) => boolean): Promise<Page> =>
      app.windows().find((p) => pred(p.url())) ?? (await app.waitForEvent("window", { predicate: (p) => pred(p.url()) }));
    const tabbar = await find((u) => u.endsWith("/tabbar/tabbar.html"));
    const agent = await find((u) => u.startsWith(`${stub.url}/agent`));
    const itemState = () =>
      app.evaluate(({ Menu }) => {
        const i = Menu.getApplicationMenu()?.getMenuItemById("reveal-active-tab");
        return i ? { label: i.label, enabled: i.enabled } : null;
      });
    // The label is per platform: CI runs on Linux ("Show in Folder").
    expect(await itemState()).toEqual({ label: revealMenuLabel(process.platform), enabled: false });

    // Record shell calls instead of opening Finder.
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { revealed: string[] };
      g.revealed = [];
      (shell as unknown as { showItemInFolder: (p: string) => void }).showItemInFolder = (p) => void g.revealed.push("show:" + p);
      (shell as unknown as { openPath: (p: string) => Promise<string> }).openPath = async (p) => (g.revealed.push("open:" + p), "");
    });

    // The panel opens a trace tab (traces:open).
    const opened = await agent.evaluate(() => (window as unknown as { penAgentPanel: { traces: { open(id: string): Promise<unknown> } } }).penAgentPanel.traces.open("tr_reveal"));
    expect(opened).toEqual({ ok: true });
    await expect(tabbar.locator(".tab")).toHaveCount(1);
    await expect.poll(async () => (await itemState())?.enabled).toBe(true);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("reveal-active-tab")!.click());
    const revealed = () => app.evaluate(() => (globalThis as unknown as { revealed: string[] }).revealed);
    await expect.poll(async () => (await revealed()).length).toBe(1);
    expect((await revealed())[0]).toMatch(/^open:.*tr_reveal$/);

    // A browser tab has no file: the item turns off; a right-click on the trace tab does not activate it.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((m) => m.label === "File")!.submenu!.items.find((i) => i.label === "New Browser Tab")!.click());
    await expect(tabbar.locator(".tab")).toHaveCount(2);
    await expect.poll(async () => (await itemState())?.enabled).toBe(false);
    await tabbar.locator(".tab").first().dispatchEvent("mousedown", { button: 2 });
    await tabbar.waitForTimeout(300);
    await expect(tabbar.locator(".tab").nth(1)).toHaveClass(/active/);
    expect((await itemState())?.enabled).toBe(false);
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
