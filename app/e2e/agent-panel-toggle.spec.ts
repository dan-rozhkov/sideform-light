import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startStubUi } from "./stubUi";

// Agent layout sidebar toggle: collapses/expands the panel island (view hidden, not destroyed),
// the tab island takes the width, the choice persists across a relaunch (userData file), and
// opening a tab while collapsed does NOT auto-expand. Own userData dir: the choice is persisted.

let stub: Awaited<ReturnType<typeof startStubUi>>;
let baseUrl: string;

test.beforeAll(async () => {
  stub = await startStubUi();
  baseUrl = stub.url;
});
test.afterAll(() => stub.close());

/** The tab bar's strip offset (CSS var) and the tab row's computed left padding. */
async function stripOffsets(tabbar: import("@playwright/test").Page) {
  return tabbar.evaluate(() => ({
    stripLeft: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tab-strip-left")),
    rowPadding: parseFloat(getComputedStyle(document.querySelector(".tab-row")!).paddingLeft),
    chromeMargin: parseFloat(getComputedStyle(document.querySelector(".chrome-row")!).marginLeft),
  }));
}

async function views(app: ElectronApplication) {
  return app.evaluate(({ BaseWindow }, base) => {
    const win = BaseWindow.getAllWindows()[0];
    const out: Record<string, { x: number; y: number; width: number; height: number; visible: boolean }> = {};
    for (const child of win.contentView.children) {
      const wc = (child as unknown as { webContents?: Electron.WebContents }).webContents;
      if (!wc) continue;
      const url = wc.getURL();
      const v = { ...child.getBounds(), visible: (child as unknown as { getVisible(): boolean }).getVisible() };
      if (url.startsWith(`${base}/agent`)) out.agent = v;
      else if (url.endsWith("/tabbar/tabbar.html")) out.tabbar = v;
      else if (!url.startsWith("file:")) out.tab = v; // the browser tab
    }
    return out;
  }, baseUrl);
}

test("sidebar toggle collapses and expands the agent panel and persists across a relaunch", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "agent-panel-toggle-"));
  const launch = () =>
    electron.launch({
      args: ["."],
      env: { ...process.env, SIDEFORM_LIGHT_UI_URL: baseUrl, SIDEFORM_LIGHT_USER_DATA_DIR: userData },
    });
  const tabbarOf = async (app: ElectronApplication) =>
    app.windows().find((p) => p.url().endsWith("/tabbar/tabbar.html")) ??
    (await app.waitForEvent("window", { predicate: (p) => p.url().endsWith("/tabbar/tabbar.html") }));

  let app = await launch();
  let tabbar = await tabbarOf(app);
  await tabbar.evaluate(() => (window as unknown as { penTabbar: { newTab(): void } }).penTabbar.newTab());
  await expect(tabbar.locator(".tab")).toHaveCount(1);
  const toggle = tabbar.locator("#toggle-panel");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-label", "Hide agent panel");
  await expect.poll(async () => (await views(app)).tab?.x).toBe(396);
  // The tab bar's strip offset matches the tab island (expanded).
  await expect.poll(async () => (await stripOffsets(tabbar)).stripLeft).toBe(396);
  // Poll the strip padding / margin: they follow tabbar:strip-left / tabbar:state asynchronously.
  await expect.poll(async () => (await stripOffsets(tabbar)).rowPadding).toBe(396);
  await expect.poll(async () => (await stripOffsets(tabbar)).chromeMargin).toBe(396);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("aria-label", "Show agent panel");
  // The slide's last frames already round to x = 8 while the panel is still visible: poll both.
  await expect
    .poll(async () => {
      const cur = await views(app);
      return { x: cur.tab?.x, agentVisible: cur.agent?.visible };
    })
    .toEqual({ x: 8, agentVisible: false });
  // ... and follows the collapse: the strip var is the new island x; the row never starts left of it.
  await expect.poll(async () => (await stripOffsets(tabbar)).stripLeft).toBe(8);
  await expect.poll(async () => (await stripOffsets(tabbar)).rowPadding).toBeGreaterThanOrEqual(8);
  await expect.poll(async () => (await stripOffsets(tabbar)).chromeMargin).toBe(8);
  let v = await views(app);
  expect(v.agent.visible).toBe(false); // hidden, not destroyed (agent view still exists)
  const winW = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getContentBounds().width);
  expect(v.tab.x + v.tab.width).toBe(winW - 8);

  // A tab opened while collapsed does not expand the panel.
  await tabbar.evaluate(() => (window as unknown as { penTabbar: { newTab(): void } }).penTabbar.newTab());
  await expect(tabbar.locator(".tab")).toHaveCount(2);
  v = await views(app);
  expect(v.agent.visible).toBe(false);
  await app.close();

  // Relaunch: still collapsed.
  app = await launch();
  tabbar = await tabbarOf(app);
  await expect(tabbar.locator("#toggle-panel")).toHaveAttribute("aria-pressed", "false");
  await tabbar.evaluate(() => (window as unknown as { penTabbar: { newTab(): void } }).penTabbar.newTab());
  await expect.poll(async () => (await views(app)).tab?.x).toBe(8);

  // Expand again.
  await tabbar.locator("#toggle-panel").click();
  await expect.poll(async () => (await views(app)).tab?.x).toBe(396);
  await expect.poll(async () => (await stripOffsets(tabbar)).stripLeft).toBe(396);
  await expect.poll(async () => (await stripOffsets(tabbar)).rowPadding).toBe(396);
  expect((await views(app)).agent.visible).toBe(true);
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
});
