import { agentPanelMenuLabel } from "./agentPanelSettings";
import type { MenuItemConstructorOptions } from "electron";
import { defaultCursorSettings } from "./cursorSettings";
import { revealMenuLabel } from "./revealMenuLabel";

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
): MenuItemConstructorOptions[] {
  return [
    { label: reveal.label, enabled: reveal.enabled, click: () => actions.reveal() },
    { type: "separator" },
    { label: "Close Tab", click: () => actions.closeTab() },
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
  opts: { isMac: boolean; appName?: string; agentPanel?: { collapsed: boolean }; reveal?: RevealMenuState },
  cursor: CursorMenuState = { ...defaultCursorSettings(), enabledLocked: false },
): MenuItemConstructorOptions[] {
  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () => actions.openSettings(),
  };
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      { label: "New Browser Tab", accelerator: "CmdOrCtrl+T", click: () => actions.newBrowserTab() },
      { label: "Passwords…", click: () => actions.openPasswords() },
      // Cmd+Y on macOS; on Windows/Linux Ctrl+Y is the Edit menu's Redo, so History uses Chrome's Ctrl+H there.
      { label: "History…", accelerator: opts.isMac ? "Cmd+Y" : "Ctrl+H", click: () => actions.openHistory() },
      // On macOS Settings… lives in the app menu (below), as in every mac app.
      ...(opts.isMac ? [] : [settingsItem]),
      // No accelerator. Without `opts.reveal` the item shows the platform label, disabled.
      {
        id: REVEAL_MENU_ITEM_ID,
        label: opts.reveal?.label ?? revealMenuLabel(opts.isMac ? "darwin" : process.platform),
        enabled: opts.reveal?.enabled ?? false,
        click: () => actions.revealActiveTab(),
      },
      { type: "separator" },
      { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => actions.closeTab() },
      { label: "Close Window", accelerator: "CmdOrCtrl+Shift+W", click: () => actions.closeWindow() },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
      { role: "toggleDevTools" },
      { type: "separator" },
            ...(opts.agentPanel
        ? [
            { label: agentPanelMenuLabel(opts.agentPanel.collapsed), accelerator: "CmdOrCtrl+Alt+B", click: () => actions.toggleAgentPanel() },
            { type: "separator" } as MenuItemConstructorOptions,
          ]
        : []),
      {
        label: "Show Agent Cursor",
        type: "checkbox",
        checked: cursor.enabled,
        enabled: !cursor.enabledLocked,
        // `item` may be absent: a bare click must not throw.
        click: (item) => actions.setCursorEnabled(item?.checked ?? !cursor.enabled),
      },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { label: "Next Tab", accelerator: "Ctrl+Tab", click: () => actions.nextTab() },
      { label: "Previous Tab", accelerator: "Ctrl+Shift+Tab", click: () => actions.prevTab() },
    ],
  };

  const template: MenuItemConstructorOptions[] = [fileMenu, editMenu, viewMenu, windowMenu];
  // macOS: an explicit app menu = Electron's default `appMenu` role plus Settings… (the first menu's
  // title is always the app name on macOS; `label` only matters for tests).
  if (opts.isMac) {
    template.unshift({
      label: opts.appName ?? "App",
      submenu: [
        { role: "about" },
        { type: "separator" },
        settingsItem,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }
  return template;
}
