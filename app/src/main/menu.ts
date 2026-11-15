import { agentPanelMenuLabel } from "./agentPanelSettings";
import type { MenuItemConstructorOptions } from "electron";
import { defaultCursorSettings } from "./cursorSettings";
import { revealMenuLabel } from "./revealMenuLabel";
import { t, type Language } from "./i18n";

/** Id of File > Reveal: window.ts toggles its `enabled` in place when the active tab changes (no menu rebuild). */
export const REVEAL_MENU_ITEM_ID = "reveal-active-tab";

/** What the View > Show Agent Cursor item shows. `enabledLocked` = an env var
 * decides the value, so the item renders disabled. */
export interface CursorMenuState {
  enabled: boolean;
  enabledLocked: boolean;
}

export interface MenuActions {
  /** Opens a new built-in browser tab. */
  newBrowserTab(): void;
  /** Opens (or activates) the Settings tab. */
  openSettings(): void;
  /** Opens (or focuses) the Passwords tab. */
  openPasswords(): void;
  /** Opens (or focuses) the History tab. */
  openHistory(): void;
  /** Closes the active tab; does nothing with no tab (never the window). */
  closeTab(): void;
  /** Closes the focused window (File > Close Window, Cmd/Ctrl+Shift+W). */
  closeWindow(): void;
  nextTab(): void;
  prevTab(): void;
  /** Saves + applies the agent cursor's on/off switch (View menu). */
  setCursorEnabled(enabled: boolean): void;
  /** Show/hide the agent chat panel (View menu, same as the tab bar's sidebar button). */
  toggleAgentPanel(): void;
  /** File > Reveal in Finder: shows the active tab's stored file (a trace) in the OS file manager; a no-op with no revealable tab. */
  revealActiveTab(): void;
}

/** What the File > Reveal item shows: the platform label, and whether the active tab has a file. */
export interface RevealMenuState {
  label: string;
  enabled: boolean;
}

/**
 * Right-click menu of a tab: reveal its file (disabled when the tab has none), then close.
 * Native, like the "+" popup: the tab bar view is only as tall as the strip.
 */
export function buildTabContextMenuTemplate(
  reveal: RevealMenuState,
  actions: { reveal(): void; closeTab(): void },
  lang: Language = "en",
): MenuItemConstructorOptions[] {
  return [
    { label: reveal.label, enabled: reveal.enabled, click: () => actions.reveal() },
    { type: "separator" },
    { label: t(lang, "menu.closeTab"), click: () => actions.closeTab() },
  ];
}

/**
 * Application menu. Every item is a local action (no command is forwarded to a page);
 * Edit/View use native roles so text fields and zoom behave like any mac app.
 * window.ts rebuilds the template (and calls Menu.setApplicationMenu again) whenever
 * something it shows changes, since a native menu template has no live-binding mechanism.
 */
export function buildMenuTemplate(
  actions: MenuActions,
  opts: { isMac: boolean; appName?: string; agentPanel?: { collapsed: boolean }; reveal?: RevealMenuState; lang?: Language },
  cursor: CursorMenuState = { ...defaultCursorSettings(), enabledLocked: false },
): MenuItemConstructorOptions[] {
  const lang = opts.lang ?? "en";
  const L = (key: Parameters<typeof t>[1], params?: Record<string, string | number>): string => t(lang, key, params);
  const appName = opts.appName ?? "App";
  const settingsItem: MenuItemConstructorOptions = {
    label: L("menu.settings"),
    accelerator: "CmdOrCtrl+,",
    click: () => actions.openSettings(),
  };
  const fileMenu: MenuItemConstructorOptions = {
    label: L("menu.file"),
    submenu: [
      { label: L("menu.newBrowserTab"), accelerator: "CmdOrCtrl+T", click: () => actions.newBrowserTab() },
      { label: L("menu.passwords"), click: () => actions.openPasswords() },
      // Cmd+Y on macOS; on Windows/Linux Ctrl+Y is the Edit menu's Redo, so History uses Chrome's Ctrl+H there.
      { label: L("menu.history"), accelerator: opts.isMac ? "Cmd+Y" : "Ctrl+H", click: () => actions.openHistory() },
      // On macOS Settings… lives in the app menu (below), as in every mac app.
      ...(opts.isMac ? [] : [settingsItem]),
      // No accelerator. Without `opts.reveal` the item shows the platform label, disabled.
      {
        id: REVEAL_MENU_ITEM_ID,
        label: opts.reveal?.label ?? revealMenuLabel(opts.isMac ? "darwin" : process.platform, lang),
        enabled: opts.reveal?.enabled ?? false,
        click: () => actions.revealActiveTab(),
      },
      { type: "separator" },
      { label: L("menu.closeTab"), accelerator: "CmdOrCtrl+W", click: () => actions.closeTab() },
      { label: L("menu.closeWindow"), accelerator: "CmdOrCtrl+Shift+W", click: () => actions.closeWindow() },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: L("menu.edit"),
    submenu: [
      { role: "undo", label: L("menu.undo") },
      { role: "redo", label: L("menu.redo") },
      { type: "separator" },
      { role: "cut", label: L("menu.cut") },
      { role: "copy", label: L("menu.copy") },
      { role: "paste", label: L("menu.paste") },
      { role: "selectAll", label: L("menu.selectAll") },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: L("menu.view"),
    submenu: [
      { role: "reload", label: L("menu.reload") },
      { type: "separator" },
      { role: "resetZoom", label: L("menu.resetZoom") },
      { role: "zoomIn", label: L("menu.zoomIn") },
      { role: "zoomOut", label: L("menu.zoomOut") },
      { type: "separator" },
      { role: "togglefullscreen" },
      { role: "toggleDevTools", label: L("menu.toggleDevTools") },
      { type: "separator" },
            ...(opts.agentPanel
        ? [
            { label: agentPanelMenuLabel(opts.agentPanel.collapsed, lang), accelerator: "CmdOrCtrl+Alt+B", click: () => actions.toggleAgentPanel() },
            { type: "separator" } as MenuItemConstructorOptions,
          ]
        : []),
      {
        label: L("menu.showAgentCursor"),
        type: "checkbox",
        checked: cursor.enabled,
        enabled: !cursor.enabledLocked,
        // `item` may be absent: a bare click must not throw.
        click: (item) => actions.setCursorEnabled(item?.checked ?? !cursor.enabled),
      },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: L("menu.window"),
    submenu: [
      { role: "minimize", label: L("menu.minimize") },
      { role: "zoom", label: L("menu.zoom") },
      { type: "separator" },
      { label: L("menu.nextTab"), accelerator: "Ctrl+Tab", click: () => actions.nextTab() },
      { label: L("menu.previousTab"), accelerator: "Ctrl+Shift+Tab", click: () => actions.prevTab() },
    ],
  };

  const template: MenuItemConstructorOptions[] = [fileMenu, editMenu, viewMenu, windowMenu];
  // macOS: an explicit app menu = Electron's default `appMenu` role plus Settings… (the first menu's
  // title is always the app name on macOS; `label` only matters for tests).
  if (opts.isMac) {
    template.unshift({
      label: appName,
      submenu: [
        { role: "about", label: L("menu.about", { appName }) },
        { type: "separator" },
        settingsItem,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: L("menu.hide", { appName }) },
        { role: "hideOthers", label: L("menu.hideOthers") },
        { role: "unhide", label: L("menu.unhide") },
        { type: "separator" },
        { role: "quit", label: L("menu.quit", { appName }) },
      ],
    });
  }
  return template;
}
