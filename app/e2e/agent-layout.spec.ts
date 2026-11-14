import { test, expect, chromium, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { startStubUi } from "./stubUi";
import { ADDRESS_ROW_HEIGHT, TAB_ROW_HEIGHT } from "../src/main/layout";

// The agent panel: a view loading /agent sits below the tab bar, left of the
// tab views; the tab bar itself stays full width.

let stub: Awaited<ReturnType<typeof startStubUi>>;
let baseUrl: string;

test.beforeAll(async () => {
  stub = await startStubUi();
  baseUrl = stub.url;
});

test.afterAll(() => stub.close());

test("the window has a left /agent panel; tabs still work", async () => {
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, SIDEFORM_LIGHT_UI_URL: baseUrl },
  });

  const agentPage =
    app.windows().find((p) => p.url().startsWith(`${baseUrl}/agent`)) ??
    (await app.waitForEvent("window", { predicate: (p) => p.url().startsWith(`${baseUrl}/agent`) }));
  await expect(agentPage.locator("#ready")).toHaveText("stub-agent");
  // The panel keeps the sandboxed preload bridge: browser, chats, traces, settings.
  expect(await agentPage.evaluate(() => (window as never as { penAgentPanel?: { version: number } }).penAgentPanel)).toMatchObject({ version: 3 });
  expect(await agentPage.evaluate(() => Object.keys((window as never as { penAgentPanel: object }).penAgentPanel).sort())).toEqual(["browser", "chats", "settings", "traces", "version"]);
  expect(await agentPage.evaluate(() => typeof (window as never as { penDesktop?: unknown }).penDesktop)).toBe("undefined");

  // Empty start: no tab until one is opened (here: the tab bar's newTab, as the "+" button does).
  const tabbarPage =
    app.windows().find((p) => p.url().endsWith("/tabbar/tabbar.html")) ??
    (await app.waitForEvent("window", { predicate: (p) => p.url().endsWith("/tabbar/tabbar.html") }));
  await expect(tabbarPage.locator(".tab")).toHaveCount(0);
  await tabbarPage.evaluate(() => (window as unknown as { penTabbar: { newTab(): void } }).penTabbar.newTab());
  await expect(tabbarPage.locator(".tab")).toHaveCount(1);

  const bounds = await app.evaluate(({ BaseWindow }, base) => {
    const win = BaseWindow.getAllWindows()[0];
    const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const child of win.contentView.children) {
      const wc = (child as unknown as { webContents?: Electron.WebContents }).webContents;
      if (!wc) continue;
      const url = wc.getURL();
      if (url.startsWith(`${base}/agent`)) out.agent = child.getBounds();
      else if (!url.startsWith("file:")) out.browser = child.getBounds(); // the browser tab (about:blank or still unloaded)
      else if (url.endsWith("/tabbar/tabbar.html")) out.tabbar = child.getBounds();
    }
    return out;
  }, baseUrl);
  const winW = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getContentBounds().width);
  // Tab bar spans the full window width at the top (traffic lights stay put).
  expect(bounds.tabbar).toMatchObject({ x: 0, y: 0, width: winW });
  // Glass + islands: panel and tab views sit below the bar, 8px gaps between them and to the left/right/bottom window edges.
  const winH = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getContentBounds().height);
  // The panel starts under the tab row; the browser tab island also holds the address row (browser tabs only).
  expect(bounds.agent.y).toBe(TAB_ROW_HEIGHT);
  expect(bounds.browser.y).toBe(TAB_ROW_HEIGHT + ADDRESS_ROW_HEIGHT);
  expect(bounds.agent.x).toBe(8);
  expect(bounds.browser.x - (bounds.agent.x + bounds.agent.width)).toBe(8);
  expect(winW - (bounds.browser.x + bounds.browser.width)).toBe(8);
  expect(winH - (bounds.agent.y + bounds.agent.height)).toBe(8);
  expect(winH - (bounds.browser.y + bounds.browser.height)).toBe(8);

  // The panel is not a tab: only the browser tab is in the strip.
  await expect(tabbarPage.locator(".tab")).toHaveCount(1);
  // The tab strip starts at the tab island's left edge (or later, past the macOS traffic lights).
  const panelRight = bounds.browser.x;
  const rowPad = await tabbarPage.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".tab-row")!).paddingLeft));
  expect(rowPad).toBe(process.platform === "darwin" ? Math.max(88, panelRight) : panelRight);

  // Eyeball aid: composite the three views at their bounds (native traffic
  // lights are not part of a view capture) into a PNG.
  const shots = await app.evaluate(async ({ BaseWindow }) => {
    const win = BaseWindow.getAllWindows()[0];
    const out: { b: { x: number; y: number; width: number; height: number }; png: string }[] = [];
    for (const child of win.contentView.children) {
      const wc = (child as unknown as { webContents?: Electron.WebContents }).webContents;
      if (!wc) continue;
      try {
        const img = await wc.capturePage();
        out.push({ b: child.getBounds(), png: img.toPNG().toString("base64") });
      } catch {
        // A hidden view cannot be captured; the picture is only an eyeball aid.
      }
    }
    return { size: win.getContentBounds(), views: out };
  });
  const outFile = process.env.AGENT_LAYOUT_SHOT;
  if (outFile) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: shots.size.width, height: shots.size.height } });
    await page.setContent(
      `<body style="margin:0;background:#ececec;position:relative">${shots.views
        .map((v) => `<img src="data:image/png;base64,${v.png}" style="position:absolute;left:${v.b.x}px;top:${v.b.y}px;width:${v.b.width}px;height:${v.b.height}px">`)
        .join("")}</body>`,
    );
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.screenshot({ path: outFile });
    await browser.close();
  }

  // Tabs still work: open a second browser tab.
  await tabbarPage.evaluate(() => (window as unknown as { penTabbar: { newTab(): void } }).penTabbar.newTab());
  await expect(tabbarPage.locator(".tab")).toHaveCount(2);
  // Every tab has a leading globe icon, drawn as an inline svg (no favicon image).
  await expect(tabbarPage.locator(".tab .tab-icon")).toHaveCount(2);
  await expect(tabbarPage.locator('.tab .tab-icon[data-icon="browser"]')).toHaveCount(2);
  await expect(tabbarPage.locator('.tab .tab-icon svg.glyph[data-pen-icon="Globe"]')).toHaveCount(2);
  await expect(tabbarPage.locator(".tab .tab-icon img")).toHaveCount(0);
  // File > New Browser Tab opens one more.
  await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const it of items) {
        if (it.label === "New Browser Tab" && it.click) return it;
        const hit = it.submenu ? find(it.submenu.items) : undefined;
        if (hit) return hit;
      }
      return undefined;
    };
    find(Menu.getApplicationMenu()!.items)!.click();
  });
  await expect(tabbarPage.locator(".tab")).toHaveCount(3);

  await app.close();
});
