import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TabManager,
  shouldFocusAddressBar,
  planNewTab,
  parseReorderPayload,
  type TabKind,
  type TabViewHandle,
  type TabsSnapshot,
  decideActivationFocus,
} from "../src/main/tabManager";

function makeFakeView() {
  let titleCb: ((t: string) => void) | undefined;
  let themeCb: ((theme: "light" | "dark") => void) | undefined;
  let loadingCb: ((loading: boolean) => void) | undefined;
  let navCb: ((s: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }) => void) | undefined;
  const view = {
    loadURL: vi.fn(() => Promise.resolve()),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    destroy: vi.fn(),
    sendMenuCommand: vi.fn(),
    sendSettingsSection: vi.fn(),
    focus: vi.fn(),
    getWebContentsId: vi.fn(() => 0),
    onDocumentTitleChanged: vi.fn((cb: (t: string) => void) => {
      titleCb = cb;
    }),
    onThemeChanged: vi.fn((cb: (theme: "light" | "dark") => void) => {
      themeCb = cb;
    }),
    onLoadingChanged: vi.fn((cb: (loading: boolean) => void) => {
      loadingCb = cb;
    }),
    onNavigationStateChanged: vi.fn(
      (cb: (s: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }) => void) => {
        navCb = cb;
      },
    ),
    getURL: vi.fn(() => ""),
    getTitle: vi.fn(() => ""),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    executeJavaScript: vi.fn(() => Promise.resolve(null)),
    isLoading: vi.fn(() => false),
    onceDomReady: vi.fn(() => Promise.resolve()),
    emitTitle: (t: string) => titleCb?.(t),
    emitTheme: (theme: "light" | "dark") => themeCb?.(theme),
    emitLoading: (l: boolean) => loadingCb?.(l),
    emitNavState: (s: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }) => navCb?.(s),
  };
  return view as TabViewHandle & {
    emitTitle: (t: string) => void;
    emitTheme: (theme: "light" | "dark") => void;
    emitLoading: (loading: boolean) => void;
    emitNavState: (s: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }) => void;
    loadURL: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
    setBounds: ReturnType<typeof vi.fn>;
    goBack: ReturnType<typeof vi.fn>;
    goForward: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    getWebContentsId: ReturnType<typeof vi.fn>;
    onDocumentTitleChanged: ReturnType<typeof vi.fn>;
    onThemeChanged: ReturnType<typeof vi.fn>;
    onNavigationStateChanged: ReturnType<typeof vi.fn>;
  };
}

describe("TabManager", () => {
  let views: ReturnType<typeof makeFakeView>[];
  let states: TabsSnapshot[];
  let tm: TabManager;
  let nextWebContentsId: number;

  beforeEach(() => {
    views = [];
    states = [];
    nextWebContentsId = 1;
    tm = new TabManager({
      createView: (_kind: TabKind) => {
        const v = makeFakeView();
        v.getWebContentsId.mockReturnValue(nextWebContentsId++);
        views.push(v);
        return v;
      },
      uiOrigin: "app://sideform",
      onStateChanged: (s) => states.push(s),
    });
  });

  it("loading flag follows the view, one push per reported flip", () => {
    const e = tm.newTab("settings");
    const b = tm.newTab("browser");
    expect(tm.getSnapshot().tabs.every((t) => !t.loading)).toBe(true);
    const before = states.length;
    views[1].emitLoading(true);
    expect(states.length).toBe(before + 1);
    expect(tm.getSnapshot().tabs.find((t) => t.id === b)?.loading).toBe(true);
    expect(tm.getSnapshot().tabs.find((t) => t.id === e)?.loading).toBeFalsy();
    // The view handle reports flips only (createTabLoading owns "on change only", see tabLoading.test.ts).
    views[1].emitLoading(false);
    expect(states.length).toBe(before + 2);
    expect(tm.getSnapshot().tabs.find((t) => t.id === b)?.loading).toBeFalsy();
    views[0].emitLoading(true); // page tabs too
    expect(tm.getSnapshot().tabs.find((t) => t.id === e)?.loading).toBe(true);
  });

  it("a loading event fired synchronously inside loadURL (entry not in the list yet) emits no snapshot", () => {
    const seen: TabsSnapshot[] = [];
    const m = new TabManager({
      createView: () => {
        const v = makeFakeView();
        v.loadURL.mockImplementation(() => {
          v.emitLoading(true); // like webContents did-start-loading firing inside loadURL
          return Promise.resolve();
        });
        return v;
      },
      uiOrigin: "app://sideform",
      onStateChanged: (s) => seen.push(s),
    });
    m.newTab("settings", undefined, { activate: false });
    // No snapshot lacking the new tab: every emitted snapshot holds it, and carries loading: true.
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s.tabs).toHaveLength(1);
    expect(seen[seen.length - 1].tabs[0].loading).toBe(true);
  });

  it("newTab defaults to a browser tab: loads nothing, titled New Tab, becomes active", () => {
    const id = tm.newTab();
    expect(views[0].loadURL).not.toHaveBeenCalled();
    expect(tm.getSnapshot().activeId).toBe(id);
    expect(tm.count()).toBe(1);
    expect(tm.getSnapshot().tabs[0].title).toBe("New Tab");
    expect(tm.getSnapshot().tabs[0].kind).toBe("browser");
    expect(tm.getSnapshot().activeKind).toBe("browser");
  });

  describe("moveTab", () => {
    const order = () => tm.getSnapshot().tabs.map((t) => t.id);
    let a: number, b: number, c: number, d: number;
    beforeEach(() => {
      a = tm.newTab("settings");
      b = tm.newTab("browser");
      c = tm.newTab("settings");
      d = tm.newTab("history");
      tm.activate(b);
      states.length = 0;
    });

    it("moves a tab forward (before a later tab)", () => {
      tm.moveTab(a, d);
      expect(order()).toEqual([b, c, a, d]);
    });

    it("moves a tab backward", () => {
      tm.moveTab(d, a);
      expect(order()).toEqual([d, a, b, c]);
    });

    it("beforeId null moves a tab to the end", () => {
      tm.moveTab(a, null);
      expect(order()).toEqual([b, c, d, a]);
    });

    it("is a no-op (and pushes no state) for unknown ids, self, unknown anchor and an unchanged position", () => {
      tm.moveTab(999, a);
      tm.moveTab(a, 999);
      tm.moveTab(a, a);
      tm.moveTab(a, b); // already right before b
      tm.moveTab(d, null); // already last
      expect(order()).toEqual([a, b, c, d]);
      expect(states).toHaveLength(0);
    });

    it("pushes one snapshot in the new order and keeps the active tab, focus and pins", () => {
      const focusCalls = views.map((v) => (v.focus as unknown as ReturnType<typeof vi.fn>).mock.calls.length);
      const pinned = tm.currentBrowserTabId();
      tm.moveTab(b, null);
      expect(states).toHaveLength(1);
      expect(states[0].tabs.map((t) => t.id)).toEqual([a, c, d, b]);
      expect(states[0].activeId).toBe(b);
      expect(tm.getSnapshot().activeId).toBe(b);
      expect(views.map((v) => (v.focus as unknown as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual(focusCalls);
      expect(tm.currentBrowserTabId()).toBe(pinned);
    });

    it("is anchored on ids: a tab opened or closed meanwhile does not misplace it", () => {
      const e = tm.newTab("settings"); // appended after d
      tm.moveTab(a, d);
      expect(order()).toEqual([b, c, a, d, e]);
      tm.closeTab(c);
      tm.moveTab(e, b);
      expect(order()).toEqual([e, b, a, d]);
    });

    it("nextTab / prevTab follow the new order", () => {
      tm.moveTab(a, null); // b c d a, active b
      tm.nextTab();
      expect(tm.getSnapshot().activeId).toBe(c);
      tm.prevTab();
      tm.prevTab();
      expect(tm.getSnapshot().activeId).toBe(a); // wraps backwards from b
    });

  });

  describe("parseReorderPayload", () => {
    it("accepts integer ids with an integer or null anchor", () => {
      expect(parseReorderPayload({ id: 3, beforeId: 5 })).toEqual({ id: 3, beforeId: 5 });
      expect(parseReorderPayload({ id: 3, beforeId: null })).toEqual({ id: 3, beforeId: null });
    });

    it("rejects malformed payloads", () => {
      for (const raw of [undefined, null, 5, "x", [], {}, { id: 1 }, { id: 1.5, beforeId: null }, { id: "1", beforeId: null },
        { id: 1, beforeId: "2" }, { id: 1, beforeId: 2.5 }, { id: 1, beforeId: undefined }, { id: Number.NaN, beforeId: null },
        { id: 1, beforeId: Number.POSITIVE_INFINITY }]) {
        expect(parseReorderPayload(raw), JSON.stringify(raw)).toBeNull();
      }
    });
  });





  describe("passwords tab", () => {
    it("opens as a local tab: titled Passwords, active, loads no URL", () => {
      const id = tm.openPasswordsTab({ focus: true });
      expect(views[0].loadURL).not.toHaveBeenCalled();
      expect(views[0].focus).toHaveBeenCalled();
      const snap = tm.getSnapshot();
      expect(snap).toMatchObject({ activeId: id, activeKind: "passwords" });
      expect(snap.tabs[0]).toMatchObject({ kind: "passwords", title: "Passwords" });
      expect(tm.findPasswordsTab()).toBe(id);
    });

    it("is a singleton: a second open activates the existing tab", () => {
      const first = tm.openPasswordsTab({ focus: true });
      const other = tm.newTab("browser");
      expect(tm.getSnapshot().activeId).toBe(other);
      expect(tm.openPasswordsTab({ focus: true })).toBe(first);
      expect(tm.getSnapshot()).toMatchObject({ activeId: first, activeKind: "passwords" });
      expect(views).toHaveLength(2);
    });

    it("is not a page tab (those load the ui with the tab preload)", () => {
      tm.newTab("settings");
      views[0].getWebContentsId.mockReturnValue(10);
      tm.openPasswordsTab();
      views[1].getWebContentsId.mockReturnValue(11);
      expect(tm.isPageTab(10)).toBe(true);
      expect(tm.isPageTab(11)).toBe(false);
      expect(tm.getSnapshot()).toMatchObject({ activeKind: "passwords" });
    });

    it("can be reopened after it was closed", () => {
      const first = tm.openPasswordsTab();
      tm.closeTab(first);
      expect(tm.findPasswordsTab()).toBeNull();
      const second = tm.openPasswordsTab();
      expect(second).not.toBe(first);
      expect(views).toHaveLength(2);
    });
  });

  describe("history tab", () => {
    it("opens as a local tab: titled History, active, loads no URL", () => {
      const id = tm.openHistoryTab({ focus: true });
      expect(views[0].loadURL).not.toHaveBeenCalled();
      expect(views[0].focus).toHaveBeenCalled();
      const snap = tm.getSnapshot();
      expect(snap).toMatchObject({ activeId: id, activeKind: "history" });
      expect(snap.tabs[0]).toMatchObject({ kind: "history", title: "History" });
      expect(tm.findHistoryTab()).toBe(id);
    });

    it("is a singleton: a second open activates the existing tab", () => {
      const first = tm.openHistoryTab({ focus: true });
      const other = tm.newTab("browser");
      expect(tm.getSnapshot().activeId).toBe(other);
      expect(tm.openHistoryTab({ focus: true })).toBe(first);
      expect(tm.getSnapshot()).toMatchObject({ activeId: first, activeKind: "history" });
      expect(views).toHaveLength(2);
    });

    it("is not a page tab, and is not the Passwords tab", () => {
      tm.newTab("settings");
      views[0].getWebContentsId.mockReturnValue(10);
      tm.openHistoryTab();
      views[1].getWebContentsId.mockReturnValue(11);
      expect(tm.isPageTab(10)).toBe(true);
      expect(tm.isPageTab(11)).toBe(false);
      expect(tm.findPasswordsTab()).toBeNull();
      expect(tm.getSnapshot()).toMatchObject({ activeKind: "history" });
    });

    it("can be reopened after it was closed", () => {
      const first = tm.openHistoryTab();
      tm.closeTab(first);
      expect(tm.findHistoryTab()).toBeNull();
      expect(tm.openHistoryTab()).not.toBe(first);
    });
  });

  describe("settings tab", () => {
    it("loads /settings on the ui origin, starts titled Settings and follows the page title", () => {
      const id = tm.openSettingsTab();
      expect(views[0].loadURL).toHaveBeenCalledWith("app://sideform/settings");
      const snap = tm.getSnapshot();
      expect(snap).toMatchObject({ activeId: id, activeKind: "settings" });
      expect(snap.tabs[0]).toMatchObject({ kind: "settings", title: "Settings" });
      views[0].emitTitle("Settings - Browser");
      expect(tm.getSnapshot().tabs[0].title).toBe("Settings - Browser");
    });

    it("opens at a valid section and ignores an invalid one", () => {
      tm.openSettingsTab("browser");
      expect(views[0].loadURL).toHaveBeenCalledWith("app://sideform/settings?section=browser");
      tm.closeTab(tm.findSettingsTab() as number);
      tm.openSettingsTab("bogus");
      expect(views[1].loadURL).toHaveBeenCalledWith("app://sideform/settings");
      tm.closeTab(tm.findSettingsTab() as number);
      tm.openSettingsTab("account"); // a section of the old frontend: gone
      expect(views[2].loadURL).toHaveBeenCalledWith("app://sideform/settings");
    });

    it("is a singleton: a second open activates the existing tab, a section is sent to it (no reload)", () => {
      const first = tm.openSettingsTab();
      const other = tm.newTab("browser");
      expect(tm.getSnapshot().activeId).toBe(other);
      expect(tm.openSettingsTab()).toBe(first);
      expect(tm.getSnapshot()).toMatchObject({ activeId: first, activeKind: "settings" });
      expect(views).toHaveLength(2);
      expect(views[0].loadURL).toHaveBeenCalledTimes(1);
      expect(views[0].sendSettingsSection).not.toHaveBeenCalled();
      tm.activate(other);
      expect(tm.openSettingsTab("appearance")).toBe(first);
      expect(views).toHaveLength(2);
      expect(views[0].loadURL).toHaveBeenCalledTimes(1);
      expect(views[0].sendSettingsSection).toHaveBeenCalledTimes(1);
      expect(views[0].sendSettingsSection).toHaveBeenCalledWith("appearance");
      expect(tm.getSnapshot().activeId).toBe(first);
      expect(tm.findSettingsTab()).toBe(first);
    });

    it("an invalid section on an existing tab sends nothing", () => {
      tm.openSettingsTab();
      tm.openSettingsTab("bogus");
      expect(views[0].sendSettingsSection).not.toHaveBeenCalled();
      expect(views[0].loadURL).toHaveBeenCalledTimes(1);
    });

    it("isPageTab matches the trace and settings tabs by webContents id", () => {
      tm.newTab("trace", undefined, { traceId: "t1" });
      tm.openSettingsTab();
      tm.newTab("browser");
      expect(tm.isPageTab(views[0].getWebContentsId())).toBe(true);
      expect(tm.isPageTab(views[1].getWebContentsId())).toBe(true);
      expect(tm.isPageTab(views[2].getWebContentsId())).toBe(false);
      expect(tm.isPageTab(99)).toBe(false);
    });

    it("isSettingsViewer needs a settings tab on /settings of the ui origin, by the view URL AND the frame URL", () => {
      tm.openSettingsTab();
      const wc = views[0].getWebContentsId();
      const url = views[0].getURL as unknown as ReturnType<typeof vi.fn>;
      url.mockReturnValue("app://sideform/settings?section=browser");
      expect(tm.isSettingsViewer(wc, "app://sideform/settings?section=browser")).toBe(true);
      expect(tm.isSettingsViewer(wc, "app://sideform/agent")).toBe(false);
      expect(tm.isSettingsViewer(wc, "https://evil.example/settings")).toBe(false);
      expect(tm.isSettingsViewer(wc, undefined)).toBe(false);
      url.mockReturnValue("https://evil.example/settings");
      expect(tm.isSettingsViewer(wc, "app://sideform/settings")).toBe(false);
      expect(tm.isSettingsViewer(99, "app://sideform/settings")).toBe(false);
    });

    it("reopens after the tab is closed", () => {
      const a = tm.openSettingsTab();
      tm.closeTab(a);
      expect(tm.findSettingsTab()).toBeNull();
      expect(tm.openSettingsTab()).not.toBe(a);
    });
  });

  describe("trace tabs", () => {
    it("load /trace/<id>?src=local on the ui origin, start titled Trace and follow the page title", () => {
      const id = tm.newTab("trace", undefined, { traceId: "t_1" });
      expect(views[0].loadURL).toHaveBeenCalledWith("app://sideform/trace/t_1?src=local");
      expect(tm.getSnapshot()).toMatchObject({ activeId: id, activeKind: "trace" });
      expect(tm.getSnapshot().tabs[0]).toMatchObject({ kind: "trace", title: "Trace" });
      views[0].emitTitle("Run: find pricing");
      expect(tm.getSnapshot().tabs[0].title).toBe("Run: find pricing");
    });

    it("fileTargetOf: the live URL id wins, else the opened id; only trace tabs have a file", () => {
      const t = tm.newTab("trace", undefined, { traceId: "a" });
      expect(tm.fileTargetOf(t)).toEqual({ kind: "trace", id: "a" });
      (views[0].getURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue("app://sideform/trace/b?src=local");
      expect(tm.fileTargetOf(t)).toEqual({ kind: "trace", id: "b" });
      const b = tm.newTab("browser");
      const s = tm.openSettingsTab();
      expect(tm.fileTargetOf(b)).toBeNull();
      expect(tm.fileTargetOf(s)).toBeNull();
      expect(tm.fileTargetOf(999)).toBeNull();
    });

    it("without a valid trace id no tab and no view is created", () => {
      for (const bad of [undefined, "", "../x", "a b"]) {
        expect(() => tm.newTab("trace", undefined, { traceId: bad })).toThrow(/trace id/);
      }
      expect(views).toHaveLength(0);
      expect(tm.getSnapshot().tabs).toEqual([]);
    });

    it("listTraceTabs keeps strip order, prefers the live URL id, flags the active tab and skips non-trace tabs", () => {
      const a = tm.newTab("trace", undefined, { traceId: "a" });
      tm.newTab("browser");
      tm.newTab("trace", undefined, { traceId: "b" });
      (views[2].getURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue("app://sideform/trace/z?src=local");
      tm.activate(a);
      expect(tm.listTraceTabs()).toEqual([
        { traceId: "a", title: "Trace", active: true },
        { traceId: "z", title: "Trace", active: false },
      ]);
    });

    it("findTraceTab falls back to the opened id when the live URL has none (redirect)", () => {
      const a = tm.newTab("trace", undefined, { traceId: "a" });
      (views[0].getURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue("about:blank");
      expect(tm.findTraceTab("a")).toBe(a);
    });

    it("findTraceTab matches the opened id, then the live URL; isTraceTab matches the webContents id", () => {
      const a = tm.newTab("trace", undefined, { traceId: "a" });
      tm.newTab("browser");
      expect(tm.findTraceTab("a")).toBe(a);
      expect(tm.findTraceTab("zzz")).toBeNull();
      (views[0].getURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue("app://sideform/trace/c?src=local");
      expect(tm.findTraceTab("a")).toBeNull();
      expect(tm.findTraceTab("c")).toBe(a);
      expect(tm.isTraceTab(views[0].getWebContentsId())).toBe(true);
      expect(tm.isTraceTab(views[1].getWebContentsId())).toBe(false);
      expect(tm.isTraceTab(99)).toBe(false);
    });

    it("isTraceViewer needs a trace tab that still shows /trace/<id>; isActiveTabWebContents follows the active tab", () => {
      const a = tm.newTab("trace", undefined, { traceId: "a" });
      const other = tm.newTab("browser");
      const traceWc = views[0].getWebContentsId();
      (views[0].getURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue("app://sideform/trace/a?src=local");
      (views[1].getURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue("app://sideform/trace/a?src=local");
      expect(tm.isTraceViewer(traceWc)).toBe(true);
      expect(tm.isTraceViewer(views[1].getWebContentsId())).toBe(false);
      (views[0].getURL as unknown as ReturnType<typeof vi.fn>).mockReturnValue("app://sideform/agent");
      expect(tm.isTraceViewer(traceWc)).toBe(false);
      tm.activate(a);
      expect(tm.isActiveTabWebContents(traceWc)).toBe(true);
      tm.activate(other);
      expect(tm.isActiveTabWebContents(traceWc)).toBe(false);
    });
  });

  it("newTab with activate:false opens in the background without activating or emitting an activation", () => {
    const first = tm.newTab("settings");
    const browser = tm.newTab("browser");
    tm.activate(first);
    const before = states.length;
    const bg = tm.newTab("settings", undefined, { activate: false });
    const snap = tm.getSnapshot();
    expect(snap.activeId).toBe(first);
    expect(snap.tabs.map((t) => t.id)).toContain(bg);
    expect(views[2].setVisible).toHaveBeenLastCalledWith(false);
    expect(views[2].loadURL).toHaveBeenCalled();
    expect(states.length).toBe(before + 1);
    expect(states[states.length - 1].activeId).toBe(first);
    // The agent's browser pin was not touched.
    expect(tm.currentBrowserTabId(undefined)).toBe(browser);
  });

  it("second tab hides the first and shows itself", () => {
    tm.newTab("settings");
    tm.newTab("settings");
    expect(views[0].setVisible).toHaveBeenLastCalledWith(false);
    expect(views[1].setVisible).toHaveBeenLastCalledWith(true);
  });

  it("activate switches visibility and focuses", () => {
    const a = tm.newTab("settings");
    tm.newTab("settings");
    tm.activate(a);
    expect(views[0].setVisible).toHaveBeenLastCalledWith(true);
    expect(views[1].setVisible).toHaveBeenLastCalledWith(false);
    expect(tm.getSnapshot().activeId).toBe(a);
  });

  it("activate with focus:false shows the tab without focusing its view", () => {
    const a = tm.newTab("settings");
    tm.newTab("settings");
    const before = vi.mocked(views[0].focus).mock.calls.length;
    tm.activate(a, { focus: false });
    expect(views[0].setVisible).toHaveBeenLastCalledWith(true);
    expect(tm.getSnapshot().activeId).toBe(a);
    expect(vi.mocked(views[0].focus).mock.calls.length).toBe(before);
    tm.activate(a);
    expect(vi.mocked(views[0].focus).mock.calls.length).toBe(before + 1);
  });

  it("newTab with focus:false becomes active but is not focused", () => {
    tm.newTab("settings");
    const d = tm.newTab("trace", undefined, { traceId: "abc", focus: false });
    expect(tm.getSnapshot().activeId).toBe(d);
    expect(views[1].setVisible).toHaveBeenLastCalledWith(true);
    expect(views[1].focus).not.toHaveBeenCalled();
  });

  it("closeTab destroys the view and activates a neighbor", () => {
    const a = tm.newTab("settings");
    const b = tm.newTab("settings");
    tm.closeTab(b);
    expect(views[1].destroy).toHaveBeenCalled();
    expect(tm.getSnapshot().activeId).toBe(a);
    expect(tm.count()).toBe(1);
  });

  it("closeTab does not corrupt state when destroy() throws", () => {
    const a = tm.newTab("settings");
    const b = tm.newTab("settings");
    views[1].destroy.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => tm.closeTab(b)).not.toThrow();
    expect(views[1].destroy).toHaveBeenCalled();
    const snapshot = tm.getSnapshot();
    expect(snapshot.activeId).toBe(a);
    expect(snapshot.activeId).not.toBe(b);
    expect(tm.activeHandle()).toBe(views[0]);
    expect(tm.count()).toBe(1);
    const last = states[states.length - 1];
    expect(last.activeId).toBe(a);
  });

  it("next/prev cycle through tabs", () => {
    const a = tm.newTab("settings");
    const b = tm.newTab("settings");
    const c = tm.newTab("settings");
    expect(tm.getSnapshot().activeId).toBe(c);
    tm.nextTab();
    expect(tm.getSnapshot().activeId).toBe(a);
    tm.prevTab();
    expect(tm.getSnapshot().activeId).toBe(c);
    tm.prevTab();
    expect(tm.getSnapshot().activeId).toBe(b);
  });

  it("document title changes flow into the snapshot and notify", () => {
    tm.newTab("settings");
    views[0].emitTitle("My Design — Pen");
    const last = states[states.length - 1];
    expect(last.tabs[0].title).toBe("My Design — Pen");
  });

  it("layout applies the rect it is given (computed by layout.ts) to every tab view", () => {
    tm.newTab("settings");
    tm.layout({ x: 1, y: 38, width: 1198, height: 761 });
    expect(views[0].setBounds).toHaveBeenLastCalledWith({ x: 1, y: 38, width: 1198, height: 761 });
  });

  it("layoutActive moves only the active tab view, and later tabs get the latest rect", () => {
    const a = tm.newTab("settings");
    tm.newTab("settings");
    tm.activate(a);
    for (const v of views) v.setBounds.mockClear();
    tm.layoutActive({ x: 100, y: 38, width: 500, height: 700 });
    expect(views[0].setBounds).toHaveBeenCalledTimes(1);
    expect(views[0].setBounds).toHaveBeenLastCalledWith({ x: 100, y: 38, width: 500, height: 700 });
    expect(views[1].setBounds).not.toHaveBeenCalled();
    // A tab opened mid-slide is placed at the latest frame.
    tm.newTab("settings");
    expect(views[2].setBounds).toHaveBeenLastCalledWith({ x: 100, y: 38, width: 500, height: 700 });
    // The final full layout reaches the hidden tab views too.
    tm.layout({ x: 8, y: 38, width: 900, height: 700 });
    expect(views[1].setBounds).toHaveBeenLastCalledWith({ x: 8, y: 38, width: 900, height: 700 });
  });

  it("layoutActive with no active tab only records the rect", () => {
    const empty = new TabManager({
      createView: () => makeFakeView(),
      uiOrigin: "app://sideform",
      onStateChanged: () => {},
    });
    expect(() => empty.layoutActive({ x: 1, y: 2, width: 3, height: 4 })).not.toThrow();
  });

  it("layout positions all tab views below the tab bar", () => {
    tm.newTab("settings");
    tm.newTab("settings");
    tm.layout({ x: 380, y: 38, width: 820, height: 762 });
    for (const v of views) {
      expect(v.setBounds).toHaveBeenLastCalledWith({ x: 380, y: 38, width: 820, height: 762 });
    }
  });

  it("every mutation emits a fresh snapshot", () => {
    tm.newTab("settings");
    const before = states.length;
    tm.newTab("settings");
    tm.nextTab();
    expect(states.length).toBeGreaterThan(before + 1);
  });

  it("destroyAll destroys every tab view and does not respawn a fresh tab", () => {
    tm.newTab("settings");
    tm.newTab("settings");
    tm.newTab("settings");
    tm.destroyAll();
    for (const v of views) {
      expect(v.destroy).toHaveBeenCalled();
    }
    expect(tm.count()).toBe(0);
  });

  it("destroyAll tolerates a view whose destroy() throws", () => {
    tm.newTab("settings");
    tm.newTab("settings");
    views[0].destroy.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => tm.destroyAll()).not.toThrow();
    expect(views[1].destroy).toHaveBeenCalled();
    expect(tm.count()).toBe(0);
  });

  describe("browser tabs", () => {
    it("newTab(\"browser\") does not load a url, defaults title to New Tab, and does not wire title/theme callbacks", () => {
      const id = tm.newTab("browser");
      expect(views[0].loadURL).not.toHaveBeenCalled();
      expect(views[0].onDocumentTitleChanged).not.toHaveBeenCalled();
      expect(views[0].onThemeChanged).not.toHaveBeenCalled();
      expect(views[0].onNavigationStateChanged).toHaveBeenCalled();
      const snap = tm.getSnapshot();
      expect(snap.tabs[0].kind).toBe("browser");
      expect(snap.tabs[0].title).toBe("New Tab");
      expect(snap.activeId).toBe(id);
      expect(snap.activeKind).toBe("browser");
    });

    it("navigation state updates flow into the snapshot", () => {
      tm.newTab("browser");
      views[0].emitNavState({ url: "https://example.com/", title: "Example", canGoBack: true, canGoForward: false });
      const last = states[states.length - 1];
      expect(last.tabs[0]).toMatchObject({
        title: "Example",
        url: "https://example.com/",
        canGoBack: true,
        canGoForward: false,
      });
    });

    it("an empty title falls back to New Tab", () => {
      tm.newTab("browser");
      views[0].emitNavState({ url: "https://example.com/", title: "  ", canGoBack: false, canGoForward: false });
      expect(tm.getSnapshot().tabs[0].title).toBe("New Tab");
    });


    it("browserHandle returns null when there is no browser tab", () => {
      tm.newTab("settings");
      expect(tm.browserHandle()).toBeNull();
    });

    it("browserHandle returns the active browser tab when it is active", () => {
      tm.newTab("settings");
      const b = tm.newTab("browser");
      expect(tm.getSnapshot().activeId).toBe(b);
      expect(tm.browserHandle()).toBe(views[1]);
    });

    it("browserHandle falls back to the most recently created browser tab when a different (editor) tab is active", () => {
      tm.newTab("browser"); // views[0]
      tm.newTab("browser"); // views[1]
      const e = tm.newTab("settings"); // views[2], becomes active
      expect(tm.getSnapshot().activeId).toBe(e);
      expect(tm.browserHandle()).toBe(views[1]);
    });

    // Full browser use (design doc `2026-09-23-full-browser-use-design.md`):
    // agentBrowserTabId — fixes upstream jev-ultrafast #61.
    it("browserHandle prefers agentBrowserTabId over the active-tab rule", () => {
      const b1 = tm.newTab("browser"); // views[0]
      tm.newTab("browser"); // views[1], becomes active
      expect(tm.getSnapshot().activeId).not.toBe(b1);
      tm.setAgentBrowserTabId(b1);
      // Without agentBrowserTabId this would fall back to the active tab
      // (views[1]) — the whole point of the override.
      expect(tm.browserHandle()).toBe(views[0]);
    });

    it("browserHandle falls back to the default rule when agentBrowserTabId points at an editor tab or a closed tab", () => {
      const e = tm.newTab("settings");
      const b = tm.newTab("browser");
      tm.setAgentBrowserTabId(e); // not a browser tab at all
      expect(tm.browserHandle()).toBe(views[1]); // falls back to active-if-browser

      tm.setAgentBrowserTabId(999); // never existed
      expect(tm.browserHandle()).toBe(views[1]);

      tm.setAgentBrowserTabId(b);
      tm.closeTab(b);
      // The tab agentBrowserTabId pointed at is gone, and it was the only
      // browser tab — browserHandle must not keep resolving to a
      // stale/destroyed view; it has nothing left to fall back to either.
      expect(tm.browserHandle()).toBeNull();
    });

    it("closing the agent's browser tab clears agentBrowserTabId rather than leaving it dangling", () => {
      tm.newTab("settings"); // views[0]
      const b1 = tm.newTab("browser"); // views[1]
      tm.newTab("browser"); // views[2], becomes active
      tm.setAgentBrowserTabId(b1);
      tm.closeTab(b1);
      // The active tab (views[2], a browser tab) is untouched by the close
      // — browserHandle's default rule (active-if-browser) must be free to
      // pick it, which it couldn't if agentBrowserTabId still pointed at
      // the closed b1's id.
      expect(tm.browserHandle()).toBe(views[2]);
    });

    it("listBrowserTabs reports every browser tab and marks browserHandle()'s pick current", () => {
      tm.newTab("settings");
      const b1 = tm.newTab("browser");
      const b2 = tm.newTab("browser");
      views[1].emitNavState({ url: "https://a.example/", title: "A", canGoBack: false, canGoForward: false });
      views[2].emitNavState({ url: "https://b.example/", title: "B", canGoBack: false, canGoForward: false });
      tm.setAgentBrowserTabId(b1);
      const list = tm.listBrowserTabs();
      expect(list).toEqual([
        { tabId: b1, url: "https://a.example/", title: "A", current: true },
        { tabId: b2, url: "https://b.example/", title: "B", current: false },
      ]);
    });


    it("activeKind tracks the active tab's kind across activation", () => {
      const e = tm.newTab("settings");
      const b = tm.newTab("browser");
      expect(tm.getSnapshot().activeKind).toBe("browser");
      tm.activate(e);
      expect(tm.getSnapshot().activeKind).toBe("settings");
      tm.activate(b);
      expect(tm.getSnapshot().activeKind).toBe("browser");
    });

    // Review finding 4: browserHandle() used to keep preferring a stale
    // agentBrowserTabId even after the user activated a *different* browser
    // tab (a tab-strip click) — the very next browser command would then
    // silently act on the tab the user had left, not the one they were
    // looking at.
    it("activate() on a browser tab repoints agentBrowserTabId — the agent follows the user's focus", () => {
      const b1 = tm.newTab("browser"); // views[0]
      const b2 = tm.newTab("browser"); // views[1], becomes active
      tm.setAgentBrowserTabId(b1);
      expect(tm.browserHandle()).toBe(views[0]);

      tm.activate(b2);
      expect(tm.browserHandle()).toBe(views[1]);
    });

    it("activate() on an editor tab does not touch agentBrowserTabId", () => {
      const b1 = tm.newTab("browser"); // views[0]
      const e = tm.newTab("settings"); // views[1]
      tm.setAgentBrowserTabId(b1);
      tm.activate(e);
      // Falls back to the default rule (no active browser tab, most recent
      // one) rather than losing the explicit agent tab — activating an
      // editor tab is not "the user looked at a different browser tab".
      expect(tm.browserHandle()).toBe(views[0]);
    });

    it("activate() with an unknown id is a no-op (mirrors the existing leniency, doesn't touch agentBrowserTabId)", () => {
      const b1 = tm.newTab("browser");
      tm.setAgentBrowserTabId(b1);
      tm.activate(999);
      expect(tm.browserHandle()).toBe(views[0]);
    });

    // Second-pass review finding 3: a user-driven tab cycle (nextTab/
    // prevTab — Ctrl+Tab/Ctrl+Shift+Tab) landing on a browser tab repoints
    // the agent to it, the same way activate() (a tab-strip click) already
    // does.
    describe("nextTab/prevTab repoint the agent on a browser tab (finding 3)", () => {
      it("nextTab landing on a browser tab repoints agentBrowserTabId", () => {
        const b1 = tm.newTab("browser"); // views[0]
        const e = tm.newTab("settings"); // views[1]
        const b2 = tm.newTab("browser"); // views[2], active
        tm.setAgentBrowserTabId(b1);
        expect(tm.browserHandle()).toBe(views[0]);

        tm.activate(e); // land on the editor tab first, agentBrowserTabId untouched by that
        expect(tm.getSnapshot().activeId).toBe(e);

        tm.nextTab(); // e -> b2 (wraps around the 3-tab order: b1, e, b2)
        expect(tm.getSnapshot().activeId).toBe(b2);
        expect(tm.browserHandle()).toBe(views[2]);
      });

      it("prevTab landing on a browser tab repoints agentBrowserTabId", () => {
        const b1 = tm.newTab("browser"); // views[0]
        const b2 = tm.newTab("browser"); // views[1]
        tm.newTab("settings"); // views[2], active
        // Point the agent at b1 — b2, not b1, is the one prevTab is about
        // to land on (order: b1, b2, editor), so the fallback rule
        // ("active if browser, else most recent") could never independently
        // produce b2 here; only an actual repoint by prevTab can.
        tm.setAgentBrowserTabId(b1);
        expect(tm.browserHandle()).toBe(views[0]);

        tm.prevTab(); // editor -> b2
        expect(tm.getSnapshot().activeId).toBe(b2);
        expect(tm.browserHandle()).toBe(views[1]);
      });

    });

    // Second-pass review finding 2: window.ts's ensurePage/popup callback
    // need the *id* of whichever browser tab browserHandle() would return,
    // to pin agentBrowserTabId even when handing back an existing tab.
    describe("currentBrowserTabId", () => {
      it("returns null when there is no browser tab", () => {
        tm.newTab("settings");
        expect(tm.currentBrowserTabId()).toBeNull();
      });

      it("matches whichever tab browserHandle() resolves to", () => {
        const b1 = tm.newTab("browser");
        tm.newTab("browser");
        tm.setAgentBrowserTabId(b1);
        expect(tm.currentBrowserTabId()).toBe(b1);
        expect(tm.browserHandle()).toBe(views[0]);
      });
    });

    // Third-pass review: the address row must drive the tab it is SHOWING,
    // even when the agent is pinned to a different (hidden) browser tab.
    describe("activeBrowserHandle", () => {
      it("is the visible browser tab, not the agent's pinned one", () => {
        const b1 = tm.newTab("browser");
        tm.newTab("browser"); // becomes active
        tm.setAgentBrowserTabId(b1);
        expect(tm.browserHandle()).toBe(views[0]);
        expect(tm.activeBrowserHandle()).toBe(views[1]);
      });

      it("is null while an editor tab is active", () => {
        tm.newTab("browser");
        tm.newTab("settings");
        expect(tm.activeBrowserHandle()).toBeNull();
      });
    });

    // Review finding 6: dialog draining needs every open browser tab's own
    // handle, not just browserHandle()'s single pick.
    describe("browserTabHandleById", () => {
      it("returns the view for a live browser tab by id", () => {
        const b1 = tm.newTab("browser");
        const b2 = tm.newTab("browser");
        expect(tm.browserTabHandleById(b1)).toBe(views[0]);
        expect(tm.browserTabHandleById(b2)).toBe(views[1]);
      });

      it("returns null for an editor tab id, and for an id that doesn't exist", () => {
        const e = tm.newTab("settings");
        expect(tm.browserTabHandleById(e)).toBeNull();
        expect(tm.browserTabHandleById(999)).toBeNull();
      });

      it("returns null once the tab has been closed", () => {
        const b = tm.newTab("browser");
        tm.newTab("browser"); // keep at least one browser tab open after closing b
        tm.closeTab(b);
        expect(tm.browserTabHandleById(b)).toBeNull();
      });
    });
  });
});

describe("agentTabIds", () => {
  function make() {
    const states: TabsSnapshot[] = [];
    let n = 1;
    const tm = new TabManager({
      createView: () => {
        const v = makeFakeView();
        v.getWebContentsId.mockReturnValue(n++);
        return v;
      },
      uiOrigin: "app://sideform",
      onStateChanged: (s) => states.push(s),
    });
    return { tm, states };
  }

  it("is empty when no tab is marked", () => {
    const { tm } = make();
    tm.newTab("settings");
    tm.newTab("browser");
    expect(tm.getSnapshot().agentTabIds).toEqual([]);
  });

  it("lists every marked browser tab, each cleared on its own", () => {
    const { tm } = make();
    tm.newTab("settings");
    const b1 = tm.newTab("browser");
    const b2 = tm.newTab("browser", "s");
    tm.setAgentTabWorking(b1, true);
    tm.setAgentTabWorking(b2, true);
    expect(tm.getSnapshot().agentTabIds).toEqual([b1, b2]);
    tm.setAgentTabWorking(b1, false);
    expect(tm.getSnapshot().agentTabIds).toEqual([b2]);
  });

  it("drops a tab that closes, without moving the mark to another tab", () => {
    const { tm } = make();
    const b1 = tm.newTab("browser");
    const b2 = tm.newTab("browser");
    tm.setAgentTabWorking(b1, true);
    tm.closeTab(b1);
    expect(tm.getSnapshot().tabs.some((t) => t.id === b2)).toBe(true);
    expect(tm.getSnapshot().agentTabIds).toEqual([]);
  });

  it("does not move when the user activates another browser tab", () => {
    const { tm } = make();
    const b1 = tm.newTab("browser");
    const b2 = tm.newTab("browser");
    tm.setAgentTabWorking(b1, true);
    tm.activate(b2);
    expect(tm.getSnapshot().agentTabIds).toEqual([b1]);
  });

  it("ignores an editor tab", () => {
    const { tm } = make();
    const e = tm.newTab("settings");
    tm.setAgentTabWorking(e, true);
    expect(tm.getSnapshot().agentTabIds).toEqual([]);
  });

  it("emits only on change", () => {
    const { tm, states } = make();
    const b = tm.newTab("browser");
    const before = states.length;
    tm.setAgentTabWorking(b, true);
    tm.setAgentTabWorking(b, true);
    tm.setAgentTabWorking(b, false);
    tm.setAgentTabWorking(b, false);
    expect(states.length).toBe(before + 2);
  });
});

// The new-browser-tab focus fix: File ▸ New Browser Tab used to leave a
// blank content area with an unfocused, empty address bar and no cue where
// to type. shouldFocusAddressBar is the pure predicate window.ts's
// pushState uses to decide, on every snapshot push, whether this is the one
// push that should move focus into #url-input (see tabManager.ts's doc
// comment on the function and window.ts's pushState).
describe("shouldFocusAddressBar", () => {
  const pageSnapshot: TabsSnapshot = {
    tabs: [{ id: 1, title: "Settings", kind: "settings" }],
    activeId: 1,
    activeKind: "settings",
    agentTabIds: [],
  };

  const emptyBrowserSnapshot: TabsSnapshot = {
    tabs: [
      { id: 1, title: "Settings", kind: "settings" },
      { id: 2, title: "New Tab", kind: "browser", url: "", canGoBack: false, canGoForward: false },
    ],
    activeId: 2,
    activeKind: "browser",
    agentTabIds: [],
  };

  it("is true on page tab -> empty-URL browser tab activation", () => {
    expect(shouldFocusAddressBar(pageSnapshot, emptyBrowserSnapshot)).toBe(true);
  });

  it("is true even on the very first push, if it already lands on an empty browser tab", () => {
    expect(shouldFocusAddressBar(null, emptyBrowserSnapshot)).toBe(true);
  });

  it("is false on a repeat of the exact same state", () => {
    expect(shouldFocusAddressBar(emptyBrowserSnapshot, { ...emptyBrowserSnapshot })).toBe(false);
  });

  it("is false when the active browser tab already has a URL", () => {
    const alreadyNavigated: TabsSnapshot = {
      ...emptyBrowserSnapshot,
      tabs: [
        emptyBrowserSnapshot.tabs[0],
        { ...emptyBrowserSnapshot.tabs[1], url: "https://example.com" },
      ],
    };
    expect(shouldFocusAddressBar(pageSnapshot, alreadyNavigated)).toBe(false);
  });

  it("is false when activating a page tab", () => {
    expect(shouldFocusAddressBar(emptyBrowserSnapshot, pageSnapshot)).toBe(false);
  });

  it("is false when only the pinned agent tabs changed (same active tab)", () => {
    const changed: TabsSnapshot = { ...emptyBrowserSnapshot, agentTabIds: [2] };
    expect(shouldFocusAddressBar(emptyBrowserSnapshot, changed)).toBe(false);
  });

  it("is false when only the active tab's title changed (same active tab)", () => {
    const titleChanged: TabsSnapshot = {
      ...emptyBrowserSnapshot,
      tabs: [
        emptyBrowserSnapshot.tabs[0],
        { ...emptyBrowserSnapshot.tabs[1], title: "Loading…" },
      ],
    };
    expect(shouldFocusAddressBar(emptyBrowserSnapshot, titleChanged)).toBe(false);
  });
});

describe("TabManager scopes (isolated browser sessions)", () => {
  let sessionsSeen: (string | undefined)[];
  let tm: TabManager;

  beforeEach(() => {
    sessionsSeen = [];
    let wc = 1;
    tm = new TabManager({
      createView: (_kind: TabKind, session?: string) => {
        sessionsSeen.push(session);
        const v = makeFakeView();
        v.getWebContentsId.mockReturnValue(wc++);
        return v;
      },
      uiOrigin: "app://sideform",
      onStateChanged: () => {},
    });
    tm.newTab("settings");
  });

  it("passes the session to createView for browser tabs only", () => {
    tm.newTab("browser", "a");
    tm.newTab("browser");
    tm.newTab("settings", "a");
    expect(sessionsSeen).toEqual([undefined, "a", undefined, undefined]);
  });

  it("the shared browser never sees a session tab, and a session never sees the shared ones", () => {
    const shared = tm.newTab("browser");
    const a = tm.newTab("browser", "a");
    const b = tm.newTab("browser", "b");
    expect(tm.listBrowserTabs().map((t) => t.tabId)).toEqual([shared]);
    expect(tm.listBrowserTabs("a").map((t) => t.tabId)).toEqual([a]);
    expect(tm.listBrowserTabs("b").map((t) => t.tabId)).toEqual([b]);
    // b is the ACTIVE tab, yet the shared lookup still resolves its own tab.
    expect(tm.currentBrowserTabId()).toBe(shared);
    expect(tm.currentBrowserTabId("a")).toBe(a);
    expect(tm.browserHandle("a")).toBe(tm.browserTabHandleById(a, "a"));
    expect(tm.browserTabHandleById(a)).toBeNull();
    expect(tm.browserTabHandleById(shared, "a")).toBeNull();
  });

  it("a session tab opens in the background: no activation, hidden, active tab unchanged", () => {
    const editorId = tm.getSnapshot().activeId;
    const before = tm.count();
    const a = tm.newTab("browser", "a");
    expect(tm.count()).toBe(before + 1);
    expect(tm.getSnapshot().activeId).toBe(editorId);
    expect(tm.getSnapshot().activeKind).toBe("settings");
    // Clicking it makes it the active tab.
    tm.activate(a);
    expect(tm.getSnapshot().activeId).toBe(a);
  });

  it("closing the active tab never auto-activates a session tab when a normal neighbour exists", () => {
    const editor = tm.getSnapshot().activeId!;
    tm.newTab("browser", "a"); // background, right after the editor
    const shared = tm.newTab("browser"); // active
    tm.newTab("browser", "b");
    tm.closeTab(shared);
    expect(tm.getSnapshot().activeId).toBe(editor);
  });

  it("a shared browser tab still activates", () => {
    const b = tm.newTab("browser");
    expect(tm.getSnapshot().activeId).toBe(b);
  });

  it("an unknown session has no current tab", () => {
    tm.newTab("browser");
    expect(tm.currentBrowserTabId("nope")).toBeNull();
    expect(tm.browserHandle("nope")).toBeNull();
  });

  it("pins the agent tab per scope and ignores a pin that points into another scope", () => {
    const a1 = tm.newTab("browser", "a");
    const a2 = tm.newTab("browser", "a");
    const shared = tm.newTab("browser");
    tm.setAgentBrowserTabId(a1, "a");
    expect(tm.currentBrowserTabId("a")).toBe(a1);
    expect(tm.currentBrowserTabId()).toBe(shared);
    // A session id pinned as the SHARED agent tab does not resolve.
    tm.setAgentBrowserTabId(a2);
    expect(tm.currentBrowserTabId()).toBe(shared);
  });

  describe("revealAgentBrowserTab", () => {
    it("reveals the pinned shared tab and keeps the pin", () => {
      const b1 = tm.newTab("browser");
      const b2 = tm.newTab("browser"); // active
      tm.setAgentBrowserTabId(b1);
      expect(tm.revealAgentBrowserTab()).toBe(true);
      expect(tm.getSnapshot().activeId).toBe(b1);
      expect(tm.currentBrowserTabId()).toBe(b1);
      expect(b2).not.toBe(b1);
    });

    it("falls back to the default rule when nothing is pinned", () => {
      tm.newTab("browser");
      const b2 = tm.newTab("browser");
      tm.activate(tm.getSnapshot().tabs[0].id); // editor active
      expect(tm.revealAgentBrowserTab()).toBe(true);
      expect(tm.getSnapshot().activeId).toBe(b2);
    });

    it("reveals a session tab without repointing the shared pin", () => {
      const shared = tm.newTab("browser");
      const a = tm.newTab("browser", "a"); // background
      tm.setAgentBrowserTabId(shared);
      expect(tm.revealAgentBrowserTab("a")).toBe(true);
      expect(tm.getSnapshot().activeId).toBe(a);
      expect(tm.currentBrowserTabId()).toBe(shared);
      expect(tm.currentBrowserTabId("a")).toBe(a);
    });

    it("returns false and creates nothing when the scope has no browser tab", () => {
      tm.newTab("browser", "a");
      const before = tm.count();
      const active = tm.getSnapshot().activeId;
      expect(tm.revealAgentBrowserTab()).toBe(false);
      expect(tm.revealAgentBrowserTab("nope")).toBe(false);
      expect(tm.count()).toBe(before);
      expect(tm.getSnapshot().activeId).toBe(active);
      expect(sessionsSeen).toEqual([undefined, "a"]);
    });
  });

  it("a user click or cycle on a session tab does not repoint the session's agent tab", () => {
    const a1 = tm.newTab("browser", "a");
    const a2 = tm.newTab("browser", "a");
    const shared = tm.newTab("browser");
    tm.setAgentBrowserTabId(a2, "a");
    tm.setAgentBrowserTabId(shared);
    tm.activate(a1);
    expect(tm.currentBrowserTabId("a")).toBe(a2);
    expect(tm.currentBrowserTabId()).toBe(shared);
    tm.activate(shared);
    tm.nextTab();
    tm.nextTab();
    expect(tm.currentBrowserTabId("a")).toBe(a2);
  });

  it("closeSessionTabs closes only that session's tabs", () => {
    const shared = tm.newTab("browser");
    tm.newTab("browser", "a");
    tm.newTab("browser", "a");
    const b = tm.newTab("browser", "b");
    tm.closeSessionTabs("a");
    expect(tm.listBrowserTabs("a")).toEqual([]);
    expect(tm.listBrowserTabs().map((t) => t.tabId)).toEqual([shared]);
    expect(tm.listBrowserTabs("b").map((t) => t.tabId)).toEqual([b]);
  });

  it("closing a pinned session tab clears the pin", () => {
    const a1 = tm.newTab("browser", "a");
    const a2 = tm.newTab("browser", "a");
    tm.setAgentBrowserTabId(a1, "a");
    tm.closeTab(a1);
    expect(tm.currentBrowserTabId("a")).toBe(a2);
  });
});

describe("TabManager with zero tabs (closing the last tab leaves the window empty)", () => {
  const make = () => {
    const states: TabsSnapshot[] = [];
    let wc = 1;
    const tm = new TabManager({
      createView: () => {
        const v = makeFakeView();
        v.getWebContentsId.mockReturnValue(wc++);
        return v;
      },
      uiOrigin: "app://sideform",
      onStateChanged: (s) => states.push(s),
    });
    return { tm, states };
  };

  it("a fresh manager is safe with no tabs", () => {
    const { tm } = make();
    expect(tm.count()).toBe(0);
    const snap = tm.getSnapshot();
    expect(snap).toMatchObject({ tabs: [], activeId: null, activeKind: null, agentTabIds: [] });
    expect(tm.activeHandle()).toBeNull();
    expect(tm.activeBrowserHandle()).toBeNull();
    expect(() => {
      tm.nextTab();
      tm.prevTab();
      tm.layout({ x: 0, y: 0, width: 10, height: 10 });
      tm.closeTab(99);
      tm.activate(99);
      tm.destroyAll();
    }).not.toThrow();
  });

  it("closing the last tab leaves zero tabs and emits an empty snapshot", () => {
    const { tm, states } = make();
    const a = tm.newTab("settings");
    tm.closeTab(a);
    expect(tm.count()).toBe(0);
    expect(states[states.length - 1]).toMatchObject({ tabs: [], activeId: null, activeKind: null });
    // A tab can still be opened afterwards.
    const b = tm.newTab("settings");
    expect(tm.getSnapshot().activeId).toBe(b);
  });

  it("closing the active tab with only background session tabs left leaves no active tab", () => {
    const { tm } = make();
    const a = tm.newTab("settings");
    const s = tm.newTab("browser", "sess", { activate: false });
    tm.closeTab(a);
    expect(tm.count()).toBe(1);
    expect(tm.getSnapshot().activeId).toBeNull();
    expect(s).toBeGreaterThan(0);
  });

  it("a background-requested tab becomes active from the zero-tab state; later ones stay in the background", () => {
    const { tm } = make();
    const a = tm.newTab("settings", undefined, { activate: false });
    expect(tm.getSnapshot().activeId).toBe(a);
    const b = tm.newTab("settings", undefined, { activate: false });
    expect(tm.getSnapshot().activeId).toBe(a);
    expect(b).not.toBe(a);
  });

  it("a background-requested tab that only became active (zero tabs) does not take keyboard focus", () => {
    const views: ReturnType<typeof makeFakeView>[] = [];
    const tm = new TabManager({
      createView: () => {
        const v = makeFakeView();
        views.push(v);
        return v;
      },
      uiOrigin: "u",
      onStateChanged: () => {},
    });
    const a = tm.newTab("settings", undefined, { activate: false });
    expect(tm.getSnapshot().activeId).toBe(a);
    expect(views[0].setVisible).toHaveBeenLastCalledWith(true);
    expect(views[0].focus).not.toHaveBeenCalled();
    // A default open (or an explicit activation) still focuses.
    tm.newTab("settings");
    expect(views[1].focus).toHaveBeenCalledTimes(1);
    tm.activate(a);
    expect(views[0].focus).toHaveBeenCalledTimes(1);
  });

  it("decideActivationFocus: only an explicit activate:false skips focus", () => {
    expect(decideActivationFocus(false)).toBe(false);
    expect(decideActivationFocus(true)).toBe(true);
    expect(decideActivationFocus(undefined)).toBe(true);
  });

  it("an isolated session tab that is not for the agent (a popup) stays in the background even from zero tabs", () => {
    const { tm } = make();
    tm.newTab("browser", "sess");
    expect(tm.getSnapshot().activeId).toBeNull();
  });

  it("an agent session tab becomes active from the empty start, without keyboard focus or address-bar focus; later ones stay in the background", () => {
    const views: ReturnType<typeof makeFakeView>[] = [];
    const tm = new TabManager({
      createView: () => {
        const v = makeFakeView();
        views.push(v);
        return v;
      },
      uiOrigin: "u",
      onStateChanged: () => {},
    });
    const a = tm.newTab("browser", "sess", { forAgent: true });
    expect(tm.getSnapshot().activeId).toBe(a);
    expect(tm.getSnapshot().activeKind).toBe("browser");
    expect(tm.getSnapshot().activeQuiet).toBe(true);
    expect(shouldFocusAddressBar(null, tm.getSnapshot())).toBe(false);
    expect(views[0].setVisible).toHaveBeenLastCalledWith(true);
    expect(views[0].focus).not.toHaveBeenCalled();
    const b = tm.newTab("browser", "other", { forAgent: true });
    expect(tm.getSnapshot().activeId).toBe(a);
    expect(views[1].setVisible).toHaveBeenLastCalledWith(false);
    const c = tm.newTab("browser", "sess", { forAgent: true });
    expect(tm.getSnapshot().activeId).toBe(a);
    expect([a, b, c]).toHaveLength(3);
  });

  it("the active agent session tab keeps its scope pin and an awake mark does not hide it", () => {
    const { tm } = make();
    const a = tm.newTab("browser", "sess", { forAgent: true });
    tm.setAgentBrowserTabId(a, "sess");
    tm.setAgentTabAwake(a, true);
    expect(tm.currentBrowserTabId("sess")).toBe(a);
    expect(tm.currentBrowserTabId()).toBeNull();
    expect(tm.getSnapshot().activeId).toBe(a);
  });

  it("closing the active agent session tab falls back to the empty start when only session tabs remain", () => {
    const { tm } = make();
    const a = tm.newTab("browser", "sess", { forAgent: true });
    tm.newTab("browser", "other", { forAgent: true });
    tm.closeTab(a);
    expect(tm.getSnapshot().activeId).toBeNull();
  });

  it("closing the active agent session tab falls back to a normal neighbour when one exists", () => {
    const { tm } = make();
    const a = tm.newTab("browser", "sess", { forAgent: true });
    const user = tm.newTab("settings");
    tm.activate(a);
    tm.closeTab(a);
    expect(tm.getSnapshot().activeId).toBe(user);
  });

  it("clicking another tab works: the quiet mark is dropped", () => {
    const { tm } = make();
    const a = tm.newTab("browser", "sess", { forAgent: true });
    const s = tm.newTab("settings");
    expect(tm.getSnapshot().activeId).toBe(s);
    expect(tm.getSnapshot().activeQuiet).toBeUndefined();
    tm.activate(a);
    expect(tm.getSnapshot().activeId).toBe(a);
    expect(tm.getSnapshot().activeQuiet).toBeUndefined();
  });

  it("a shared agent tab activates with focus, from the empty start and with an active tab (unchanged)", () => {
    const views: ReturnType<typeof makeFakeView>[] = [];
    const tm = new TabManager({
      createView: () => {
        const v = makeFakeView();
        views.push(v);
        return v;
      },
      uiOrigin: "u",
      onStateChanged: () => {},
    });
    const a = tm.newTab("browser", undefined, { forAgent: true });
    expect(tm.getSnapshot().activeId).toBe(a);
    expect(views[0].focus).toHaveBeenCalledTimes(1);
    const b = tm.newTab("browser", undefined, { forAgent: true });
    expect(tm.getSnapshot().activeId).toBe(b);
    expect(views[1].focus).toHaveBeenCalledTimes(1);
    expect(tm.getSnapshot().activeQuiet).toBeUndefined();
  });

  it("planNewTab", () => {
    const base = { isSessionTab: false, requestedActivate: undefined, requestedFocus: undefined, forAgent: false, hasActive: true };
    expect(planNewTab(base)).toEqual({ background: false, focus: true, quiet: false });
    expect(planNewTab({ ...base, isSessionTab: true })).toEqual({ background: true, focus: true, quiet: false });
    expect(planNewTab({ ...base, isSessionTab: true, forAgent: true })).toEqual({ background: true, focus: true, quiet: false });
    expect(planNewTab({ ...base, isSessionTab: true, forAgent: true, hasActive: false })).toEqual({ background: false, focus: false, quiet: true });
    expect(planNewTab({ ...base, isSessionTab: true, hasActive: false })).toEqual({ background: true, focus: true, quiet: false });
    // A shared agent tab from the empty start activates with focus, as before.
    expect(planNewTab({ ...base, forAgent: true, hasActive: false })).toEqual({ background: false, focus: true, quiet: false });
    expect(planNewTab({ ...base, requestedActivate: false })).toEqual({ background: true, focus: false, quiet: false });
    // A non-session tab promoted because none was active: no focus, but NOT quiet (address bar auto-focus as before).
    expect(planNewTab({ ...base, requestedActivate: false, hasActive: false })).toEqual({ background: false, focus: false, quiet: false });
  });

  it("only the agent session tab from the empty start is quiet: other focus:false activations auto-focus the address bar", () => {
    const { tm } = make();
    // A non-session browser tab promoted because none was active (activate:false).
    const promoted = tm.newTab("browser", undefined, { activate: false });
    expect(tm.getSnapshot().activeId).toBe(promoted);
    expect(tm.getSnapshot().activeQuiet).toBeUndefined();
    expect(shouldFocusAddressBar(null, tm.getSnapshot())).toBe(true);
    // activate(..., { focus: false }) on a browser tab.
    const other = tm.newTab("browser");
    tm.activate(promoted, { focus: false });
    expect(tm.getSnapshot().activeQuiet).toBeUndefined();
    expect(shouldFocusAddressBar(null, tm.getSnapshot())).toBe(true);
    expect(other).not.toBe(promoted);
  });

  it("a trace or settings tab opened with focus:false is not quiet", () => {
    const { tm } = make();
    const t = tm.newTab("settings", undefined, { focus: false });
    expect(tm.getSnapshot().activeId).toBe(t);
    expect(tm.getSnapshot().activeQuiet).toBeUndefined();
  });
});

describe("closePopupTab (a popup that closed itself)", () => {
  const mk = () => new TabManager({ uiOrigin: "app://x", onStateChanged: () => {}, createView: () => makeFakeView() });

  it("shows the opener again (not the left neighbour) and re-pins the agent on it", () => {
    const tm = mk();
    const opener = tm.newTab("browser");
    const other = tm.newTab("browser");
    tm.activate(opener);
    const popup = tm.newTab("browser");
    tm.setAgentBrowserTabId(popup);
    tm.closePopupTab(popup, opener);
    expect(tm.getSnapshot().activeId).toBe(opener);
    expect(tm.currentBrowserTabId()).toBe(opener);
    expect(other).not.toBe(opener);
  });

  it("leaves the agent pin and the active tab alone when the popup was neither", () => {
    const tm = mk();
    const opener = tm.newTab("browser");
    const popup = tm.newTab("browser", undefined, { activate: false });
    const third = tm.newTab("browser");
    tm.setAgentBrowserTabId(third);
    tm.closePopupTab(popup, opener);
    expect(tm.getSnapshot().activeId).toBe(third);
    expect(tm.currentBrowserTabId()).toBe(third);
  });

  it("never activates a session opener; a gone opener falls back to closeTab", () => {
    const tm = mk();
    const plain = tm.newTab("browser");
    const opener = tm.newTab("browser", "s1");
    const popup = tm.newTab("browser", "s1");
    tm.closePopupTab(popup, opener);
    expect(tm.getSnapshot().activeId).toBe(plain);
    const p2 = tm.newTab("browser");
    tm.closePopupTab(p2, 9999);
    expect(tm.getSnapshot().tabs.some((t) => t.id === p2)).toBe(false);
  });
});
