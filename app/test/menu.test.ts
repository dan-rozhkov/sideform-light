import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildMenuTemplate, buildTabContextMenuTemplate, type MenuActions, REVEAL_MENU_ITEM_ID } from "../src/main/menu";
import type { MenuItemConstructorOptions } from "electron";

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...flatten((i.submenu as MenuItemConstructorOptions[]) ?? [])]);
}

function makeActions(): MenuActions {
  return {
    newBrowserTab: vi.fn(),
    openSettings: vi.fn(),
    openPasswords: vi.fn(),
    openHistory: vi.fn(),
    closeTab: vi.fn(),
    closeWindow: vi.fn(),
    nextTab: vi.fn(),
    prevTab: vi.fn(),
    setCursorEnabled: vi.fn(),
    toggleAgentPanel: vi.fn(),
    revealActiveTab: vi.fn(),
  };
}

describe("buildMenuTemplate", () => {
  let actions: MenuActions;

  beforeEach(() => {
    actions = makeActions();
  });

  function item(label: string): MenuItemConstructorOptions {
    const found = flatten(buildMenuTemplate(actions, { isMac: true })).find((i) => i.label === label);
    if (!found) throw new Error(`menu item not found: ${label}`);
    return found;
  }

  const fileLabels = (isMac: boolean) =>
    (buildMenuTemplate(actions, { isMac }).find((m) => m.label === "File")!.submenu as MenuItemConstructorOptions[]).map((i) => i.label ?? i.type);

  it("has the app menu first on mac only", () => {
    expect(buildMenuTemplate(actions, { isMac: true, appName: "Sideform Light" })[0].label).toBe("Sideform Light");
    expect(buildMenuTemplate(actions, { isMac: false })[0].label).toBe("File");
  });

  it("mac app menu keeps the default roles and adds Settings… (CmdOrCtrl+,) after About", () => {
    const appMenu = buildMenuTemplate(actions, { isMac: true })[0];
    const sub = appMenu.submenu as MenuItemConstructorOptions[];
    expect(sub.map((i) => i.role ?? i.type ?? i.label)).toEqual([
      "about", "separator", "Settings…", "separator", "services", "separator", "hide", "hideOthers", "unhide", "separator", "quit",
    ]);
    const settings = sub.find((i) => i.label === "Settings…")!;
    expect(settings.accelerator).toBe("CmdOrCtrl+,");
    (settings.click as () => void)();
    expect(actions.openSettings).toHaveBeenCalledOnce();
    // Not duplicated in File on mac.
    expect(fileLabels(true)).not.toContain("Settings…");
  });

  it("off mac, Settings… (CmdOrCtrl+,) is in the File menu", () => {
    const file = buildMenuTemplate(actions, { isMac: false }).find((i) => i.label === "File")!;
    const settings = (file.submenu as MenuItemConstructorOptions[]).find((i) => i.label === "Settings…")!;
    expect(settings.accelerator).toBe("CmdOrCtrl+,");
    (settings.click as () => void)();
    expect(actions.openSettings).toHaveBeenCalledOnce();
  });

  it("New Browser Tab is CmdOrCtrl+T and the only new-tab item", () => {
    const i = item("New Browser Tab");
    expect(i.accelerator).toBe("CmdOrCtrl+T");
    (i.click as () => void)();
    expect(actions.newBrowserTab).toHaveBeenCalledOnce();
    const labels = flatten(buildMenuTemplate(actions, { isMac: false })).map((x) => String(x.label));
    expect(labels.filter((l) => /^New /.test(l))).toEqual(["New Browser Tab"]);
  });

  it("the File menu is exactly the browser items", () => {
    expect(fileLabels(true)).toEqual(["New Browser Tab", "Passwords…", "History…", "Reveal in Finder", "separator", "Close Tab", "Close Window"]);
    expect(fileLabels(false)).toEqual(["New Browser Tab", "Passwords…", "History…", "Settings…", "Reveal in Finder", "separator", "Close Tab", "Close Window"]);
  });

  it("has no item of a removed feature (canvas, documents, workflows, sign-in, MCP, import/export)", () => {
    const labels = flatten(buildMenuTemplate(actions, { isMac: true })).map((x) => String(x.label ?? ""));
    for (const l of labels) expect(l).not.toMatch(/canvas|document|workflow|sign in|mcp|\.pen|\.json|tokens|open…/i);
  });

  it("Passwords… opens the Passwords tab", () => {
    (item("Passwords…").click as () => void)();
    expect(actions.openPasswords).toHaveBeenCalledTimes(1);
  });

  it("History… sits right after Passwords… and opens the History tab", () => {
    expect(fileLabels(true).indexOf("History…")).toBe(fileLabels(true).indexOf("Passwords…") + 1);
    const i = item("History…");
    expect(i.accelerator).toBe("Cmd+Y");
    (i.click as () => void)();
    expect(actions.openHistory).toHaveBeenCalledTimes(1);
  });

  it("History… avoids Redo's Ctrl+Y outside macOS", () => {
    const file = buildMenuTemplate(actions, { isMac: false }).find((m) => m.label === "File")!;
    const i = (file.submenu as MenuItemConstructorOptions[]).find((x) => x.label === "History…")!;
    expect(i.accelerator).toBe("Ctrl+H");
  });

  it("Reveal item sits before the first separator, without an accelerator", () => {
    const file = buildMenuTemplate(actions, { isMac: true, reveal: { label: "Reveal in Finder", enabled: true } }).find((m) => m.label === "File")!;
    const sub = file.submenu as MenuItemConstructorOptions[];
    const at = sub.findIndex((i) => i.label === "Reveal in Finder");
    // window.ts finds the item by this id to toggle `enabled` in place.
    expect(sub[at].id).toBe(REVEAL_MENU_ITEM_ID);
    expect(sub[at].enabled).toBe(true);
    expect(sub[at].accelerator).toBeUndefined();
    expect(sub[at + 1].type).toBe("separator");
  });

  it("Reveal item calls revealActiveTab and survives a bare click", () => {
    const i = item("Reveal in Finder");
    expect(() => (i.click as () => void)()).not.toThrow();
    expect(actions.revealActiveTab).toHaveBeenCalledTimes(1);
  });

  it("Reveal item without opts.reveal is disabled; with it, label and state come from the opts", () => {
    expect(item("Reveal in Finder").enabled).toBe(false);
    const off = buildMenuTemplate(actions, { isMac: false, reveal: { label: "Show in Explorer", enabled: false } }).find((m) => m.label === "File")!;
    const e = (off.submenu as MenuItemConstructorOptions[]).find((i) => i.label === "Show in Explorer")!;
    expect(e.enabled).toBe(false);
  });

  it("Close Window triggers closeWindow with CmdOrCtrl+Shift+W", () => {
    const i = item("Close Window");
    expect(i.accelerator).toBe("CmdOrCtrl+Shift+W");
    (i.click as () => void)();
    expect(actions.closeWindow).toHaveBeenCalled();
  });

  it("Close Tab triggers closeTab with CmdOrCtrl+W", () => {
    const i = item("Close Tab");
    expect(i.accelerator).toBe("CmdOrCtrl+W");
    (i.click as () => void)();
    expect(actions.closeTab).toHaveBeenCalled();
  });

  it("tab cycling shortcuts exist", () => {
    expect(item("Next Tab").accelerator).toBe("Ctrl+Tab");
    expect(item("Previous Tab").accelerator).toBe("Ctrl+Shift+Tab");
  });

  it("Edit menu uses native roles (undo/redo/cut/copy/paste/selectAll)", () => {
    const roles = flatten(buildMenuTemplate(actions, { isMac: true })).map((i) => i.role);
    for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) {
      expect(roles).toContain(role);
    }
  });

  it("View menu has zoom, fullscreen and devtools roles", () => {
    const roles = flatten(buildMenuTemplate(actions, { isMac: true })).map((i) => i.role);
    for (const role of ["resetZoom", "zoomIn", "zoomOut", "togglefullscreen", "toggleDevTools", "reload"]) {
      expect(roles).toContain(role);
    }
  });

  describe("View > Show Agent Cursor", () => {
    const state = { enabled: true, enabledLocked: false };
    const cursorItem = (cursor = state) => {
      const view = buildMenuTemplate(actions, { isMac: true }, cursor).find((m) => m.label === "View")!;
      const found = (view.submenu as MenuItemConstructorOptions[]).find((i) => i.label === "Show Agent Cursor");
      if (!found) throw new Error("Show Agent Cursor item missing");
      return found;
    };

    it("is a checkbox directly in the View menu", () => {
      expect(cursorItem().type).toBe("checkbox");
    });

    it("reflects the current enabled flag", () => {
      expect(cursorItem().checked).toBe(true);
      expect(cursorItem({ ...state, enabled: false }).checked).toBe(false);
    });

    it("clicking forwards the new checkbox state", () => {
      (cursorItem().click as (i: { checked: boolean }) => void)({ checked: false });
      expect(actions.setCursorEnabled).toHaveBeenCalledWith(false);
    });

    it("survives a bare click", () => {
      expect(() => (cursorItem().click as () => void)()).not.toThrow();
    });

    it("is disabled when an env var locks the value", () => {
      expect(cursorItem({ ...state, enabledLocked: true }).enabled).toBe(false);
      expect(cursorItem().enabled).toBe(true);
    });
  });

  describe("View > Agent Panel", () => {
    it("View menu has a Show/Hide Agent Panel item (Cmd/Ctrl+Alt+B) when asked for", () => {
      const labels = (opts: Parameters<typeof buildMenuTemplate>[1]) => {
        const view = buildMenuTemplate(actions, opts).find((m) => m.label === "View");
        return (view?.submenu as MenuItemConstructorOptions[]).map((m) => m.label);
      };
      expect(labels({ isMac: true })).not.toContain("Hide Agent Panel");
      expect(labels({ isMac: true, agentPanel: { collapsed: false } })).toContain("Hide Agent Panel");
      expect(labels({ isMac: true, agentPanel: { collapsed: true } })).toContain("Show Agent Panel");
      const view = buildMenuTemplate(actions, { isMac: false, agentPanel: { collapsed: false } }).find((m) => m.label === "View");
      const it = (view?.submenu as MenuItemConstructorOptions[]).find((m) => m.label === "Hide Agent Panel")!;
      expect(it.accelerator).toBe("CmdOrCtrl+Alt+B");
      (it.click as () => void)();
      expect(actions.toggleAgentPanel).toHaveBeenCalledTimes(1);
    });
  });
});

describe("buildTabContextMenuTemplate", () => {
  it("has the reveal item, a separator and Close Tab, wired to the actions", () => {
    const actions = { reveal: vi.fn(), closeTab: vi.fn() };
    const t = buildTabContextMenuTemplate({ label: "Reveal in Finder", enabled: true }, actions);
    expect(t.map((i) => i.label ?? i.type)).toEqual(["Reveal in Finder", "separator", "Close Tab"]);
    expect(t[0].enabled).toBe(true);
    (t[0].click as () => void)();
    (t[2].click as () => void)();
    expect(actions.reveal).toHaveBeenCalledTimes(1);
    expect(actions.closeTab).toHaveBeenCalledTimes(1);
  });
  it("disables reveal for a tab without a file", () => {
    const t = buildTabContextMenuTemplate({ label: "Show in Folder", enabled: false }, { reveal: vi.fn(), closeTab: vi.fn() });
    expect(t[0].enabled).toBe(false);
  });
});
