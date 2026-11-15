import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchShell, newBrowserTabViaTabbar } from "./launch";
import { startStubUi } from "./stubUi";

// Interface language (src/main/i18n): the ui is the source of truth and sets `<html lang>`; the agent panel's preload reports
// it (`panel:language`), main re-labels the native menu and sends every local shell page its dictionary (`shell:i18n`). The
// stub agent page stands in for the ui: this spec sets its `<html lang>` by hand. Own userData dir: the language is persisted.

let stub: Awaited<ReturnType<typeof startStubUi>>;
test.beforeAll(async () => {
  stub = await startStubUi();
});
test.afterAll(() => stub.close());

const shellPage = (app: Awaited<ReturnType<typeof launchShell>>, suffix: string): Page => app.windows().find((p) => p.url().endsWith(suffix))!;
const setUiLanguage = (agent: Page, lang: string) => agent.evaluate((l) => void (document.documentElement.lang = l), lang);

test("the shell follows the ui's <html lang>, persists it and starts in it next time", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "language-"));
  const launch = () =>
    launchShell({ args: ["."], env: { ...process.env, SIDEFORM_LIGHT_UI_URL: stub.url, SIDEFORM_LIGHT_USER_DATA_DIR: userData } });
  try {
    const app = await launch();
    const tabbar = shellPage(app, "/tabbar/tabbar.html");
    const empty = shellPage(app, "/tabbar/empty.html");

    // English (SIDEFORM_LIGHT_LANGUAGE=en in e2e): the defaults.
    await expect(empty.locator(".headline")).toHaveText("Where shall we start?");
    await expect(tabbar.locator("#new-tab")).toHaveAttribute("title", "New Browser Tab (Cmd/Ctrl+T)");

    // The ui switches to Russian: the tab bar, the empty start and an open tab's default title follow.
    await setUiLanguage(app.agentPage, "ru");
    await expect(tabbar.locator("#new-tab")).toHaveAttribute("title", "Новая вкладка (Cmd/Ctrl+T)");
    await expect(tabbar.locator("html")).toHaveAttribute("lang", "ru");
    await expect(empty.locator(".headline")).toHaveText("С чего начнём?");
    await expect(empty.locator("html")).toHaveAttribute("lang", "ru");
    await newBrowserTabViaTabbar(tabbar);
    await expect(tabbar.locator(".tab .title")).toHaveText("Новая вкладка");
    await expect(tabbar.locator("#url-input")).toHaveAttribute("placeholder", "Введите запрос или адрес");
    await expect(tabbar.locator(".tab .close")).toHaveAttribute("aria-label", "Закрыть вкладку");

    // The native menu is rebuilt in the language.
    await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? [])).toContain("Файл");

    // An unsupported code is ignored; a supported one wins.
    await setUiLanguage(app.agentPage, "xx");
    await setUiLanguage(app.agentPage, "de");
    await expect(tabbar.locator(".tab .title")).toHaveText("Neuer Tab");
    await expect(tabbar.locator("html")).toHaveAttribute("lang", "de");
    await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? [])).toContain("Datei");
    expect(JSON.parse(fs.readFileSync(path.join(userData, "ui-language.json"), "utf8"))).toEqual({ language: "de" });
    await app.close();

    // Next start: the persisted language wins over the environment, before any ui has reported.
    const again = await launch();
    await expect(shellPage(again, "/tabbar/empty.html").locator(".headline")).toHaveText("Womit möchten Sie beginnen?");
    await again.close();
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
