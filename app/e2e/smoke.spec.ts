import { test, expect } from "@playwright/test";
import { launchShell } from "./launch";
import { startStubUi } from "./stubUi";

let stub: Awaited<ReturnType<typeof startStubUi>>;

test.beforeAll(async () => {
  stub = await startStubUi();
});

test.afterAll(() => stub.close());

test("launches Sideform Light: the agent panel loads from the ui origin with only its own bridge", async () => {
  const app = await launchShell({
    args: ["."],
    env: { ...process.env, SIDEFORM_LIGHT_UI_URL: stub.url },
  });
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBe("Sideform Light");

  const agent = app.agentPage;
  await expect(agent.locator("#ready")).toHaveText("stub-agent");
  expect(new URL(agent.url()).pathname).toBe("/agent");
  // The panel's bridge: version 3, browser + chats + traces + settings. No tab bridge in the panel.
  expect(await agent.evaluate(() => (window as never as { penAgentPanel?: { version: number } }).penAgentPanel?.version)).toBe(3);
  expect(await agent.evaluate(() => typeof (window as never as { penDesktop?: unknown }).penDesktop)).toBe("undefined");

  // The window starts empty: no tab, the start screen shows.
  const tabbar = app.windows().find((p) => p.url().endsWith("/tabbar/tabbar.html"))!;
  await expect(tabbar.locator(".tab")).toHaveCount(0);

  // The "+" button opens a browser tab.
  await tabbar.evaluate(() => (window as unknown as { penTabbar: { newTab(): void } }).penTabbar.newTab());
  await expect(tabbar.locator(".tab")).toHaveCount(1);
  await expect(tabbar.locator('.tab .tab-icon[data-icon="browser"]')).toHaveCount(1);

  await app.close();
});
