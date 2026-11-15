import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { agentPanelMenuLabel } from "../src/main/agentPanelSettings";
import { minimizedAgentNotice } from "../src/main/agentActivity";
import { buildBrowserToolsMenuTemplate, type BrowserToolsActions, type BrowserToolsState } from "../src/main/browserToolsMenu";
import { savePromptCopy } from "../src/main/browser/loginCapture";
import { LANGUAGES } from "../src/main/i18n";
import { buildMenuTemplate, buildTabContextMenuTemplate, type MenuActions } from "../src/main/menu";
import { revealMenuLabel } from "../src/main/revealMenuLabel";

const actions = new Proxy({}, { get: () => vi.fn() }) as MenuActions;
const flatten = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])]);
const labels = (items: MenuItemConstructorOptions[]) => flatten(items).map((i) => i.label).filter((l): l is string => typeof l === "string");

describe("application menu in the interface language", () => {
  it("is English by default and Russian with lang ru", () => {
    expect(buildMenuTemplate(actions, { isMac: false }).map((m) => m.label)).toEqual(["File", "Edit", "View", "Window"]);
    const ru = buildMenuTemplate(actions, { isMac: false, lang: "ru" });
    expect(ru.map((m) => m.label)).toEqual(["Файл", "Правка", "Вид", "Окно"]);
    const l = labels(ru);
    for (const text of ["Новая вкладка браузера", "Пароли…", "История…", "Настройки…", "Закрыть вкладку", "Закрыть окно", "Следующая вкладка", "Предыдущая вкладка", "Показывать курсор агента", "Копировать", "Вставить"]) {
      expect(l, text).toContain(text);
    }
  });

  it("keeps every role and accelerator whatever the language", () => {
    const rolesOf = (lang: "en" | "ru" | "de") => flatten(buildMenuTemplate(actions, { isMac: true, lang })).map((i) => i.role ?? null);
    expect(rolesOf("ru")).toEqual(rolesOf("en"));
    expect(rolesOf("de")).toEqual(rolesOf("en"));
    const accel = (lang: "en" | "fr") => flatten(buildMenuTemplate(actions, { isMac: true, lang })).map((i) => i.accelerator ?? null);
    expect(accel("fr")).toEqual(accel("en"));
  });

  it("the macOS app menu uses the app name in the localized About / Hide / Quit labels", () => {
    const app = buildMenuTemplate(actions, { isMac: true, appName: "Sideform Light", lang: "de" })[0];
    expect(app.label).toBe("Sideform Light");
    const l = labels([app]);
    expect(l).toContain("Über Sideform Light");
    expect(l).toContain("Sideform Light ausblenden");
    expect(l).toContain("Sideform Light beenden");
    expect(l).toContain("Einstellungen…");
  });

  it("the agent panel toggle and the reveal item follow the language", () => {
    const view = (lang: "ru" | "fr") =>
      labels(buildMenuTemplate(actions, { isMac: true, lang, agentPanel: { collapsed: true }, reveal: { label: revealMenuLabel("darwin", lang), enabled: true } }));
    expect(view("ru")).toContain("Показать панель агента");
    expect(view("ru")).toContain("Показать в Finder");
    expect(view("fr")).toContain("Afficher dans le Finder");
    expect(agentPanelMenuLabel(false, "de")).toBe("Agent-Panel ausblenden");
    expect(agentPanelMenuLabel(false)).toBe("Hide Agent Panel");
  });

  it("every language builds a menu with a non-empty label on every labelled item", () => {
    for (const lang of LANGUAGES) {
      for (const item of flatten(buildMenuTemplate(actions, { isMac: true, lang, agentPanel: { collapsed: false } }))) {
        // services and togglefullscreen keep the OS label on purpose (it changes by itself: Enter / Exit Full Screen).
        if (item.type === "separator" || item.role === "services" || item.role === "togglefullscreen") continue;
        expect(String(item.label ?? "").length, `${lang} ${item.role ?? ""}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("tab menu, browser tools and dialogs", () => {
  it("tab context menu closes with a localized label", () => {
    const t = buildTabContextMenuTemplate({ label: revealMenuLabel("win32", "it"), enabled: false }, { reveal: vi.fn(), closeTab: vi.fn() }, "it");
    expect(t.map((i) => i.label)).toEqual(["Mostra in Esplora risorse", undefined, "Chiudi scheda"]);
  });

  const state: BrowserToolsState = { hasDebugger: true, hasDocument: true, viewport: "responsive", devToolsOpen: false, zoomFactor: 1, zoomLevel: 0 };
  const toolActions = new Proxy({}, { get: () => vi.fn() }) as BrowserToolsActions;

  it("browser tools menu in German", () => {
    const l = labels(buildBrowserToolsMenuTemplate(state, toolActions, "de"));
    for (const text of ["Viewport", "Responsiv (Fenstergröße)", "iPhone 15 — 393×852", "Desktop — 1440×900", "Entwicklertools öffnen", "Zoom", "Vergrößern", "Verkleinern", "Tatsächliche Größe", "Verlauf anzeigen", "100%"]) {
      expect(l, text).toContain(text);
    }
    expect(labels(buildBrowserToolsMenuTemplate({ ...state, devToolsOpen: true }, toolActions, "de"))).toContain("Entwicklertools schließen");
  });

  it("browser tools menu is English without a language", () => {
    const l = labels(buildBrowserToolsMenuTemplate(state, toolActions));
    expect(l).toContain("Responsive (window size)");
    expect(l).toContain("Desktop — 1920×1080");
    expect(l).toContain("Open Developer Tools");
  });

  it("the save-password dialog and the minimized notice are localized", () => {
    const ru = savePromptCopy({ origin: "https://example.com", username: "alice", update: false }, "ru");
    expect(ru.message).toBe("Сохранить пароль для example.com?");
    expect(ru.buttons).toEqual(["Сохранить", "Никогда для этого сайта", "Не сейчас"]);
    expect(savePromptCopy({ origin: "https://example.com", username: "a", update: true }, "fr").message).toBe("Mettre à jour le mot de passe pour example.com ?");
    expect(savePromptCopy({ origin: "https://example.com", username: "a", update: false }).buttons).toEqual(["Save", "Never for This Site", "Not Now"]);
    expect(minimizedAgentNotice("de").title).toBe("Der Browser-Tab des Agenten ist pausiert");
    expect(minimizedAgentNotice().title).toBe("The agent's browser tab is paused");
  });
});
