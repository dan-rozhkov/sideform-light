import { describe, it, expect, vi } from "vitest";
import {
  decideNavigation,
  decidePanelNavigation,
  attachPanelNavigationPolicy,
  attachNavigationPolicy,
  attachBrowserTabPolicy,
  decideBrowserPopup,
  attachLocalOnlyPolicy,
  shouldForwardNavigationEvent,
} from "../src/main/navigation";

const ORIGIN = "app://sideform";

describe("decideNavigation", () => {
  it("allows same-origin", () => {
    expect(decideNavigation(`${ORIGIN}/some/path?x=1`, ORIGIN)).toBe("allow");
  });
  it("sends other http(s) origins external", () => {
    expect(decideNavigation("https://example.com/docs", ORIGIN)).toBe("external");
    expect(decideNavigation("http://localhost:9999/", ORIGIN)).toBe("external");
  });
  it("denies non-http schemes and garbage", () => {
    expect(decideNavigation("file:///etc/passwd", ORIGIN)).toBe("deny");
    expect(decideNavigation("javascript:alert(1)", ORIGIN)).toBe("deny");
    expect(decideNavigation("%%%", ORIGIN)).toBe("deny");
  });
});

type Handler = (...args: unknown[]) => void;

function fakeContents() {
  const handlers = new Map<string, Handler>();
  let openHandler: ((details: { url: string }) => { action: string }) | undefined;
  return {
    on: vi.fn((event: string, cb: Handler) => handlers.set(event, cb)),
    setWindowOpenHandler: vi.fn((cb: (details: { url: string }) => { action: string }) => {
      openHandler = cb;
    }),
    loadFile: vi.fn(),
    getURL: vi.fn(() => `${ORIGIN}/`),
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.(...args);
    },
    open(url: string) {
      return openHandler!({ url });
    },
  };
}

describe("attachNavigationPolicy", () => {
  it("prevents will-navigate to foreign origins and opens externally", () => {
    const contents = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(contents as never, ORIGIN, openExternal);
    const ev = { preventDefault: vi.fn() };
    contents.emit("will-navigate", ev, "https://example.com/x");
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/x");
  });

  it("a different host on the app: scheme is not the ui origin", () => {
    expect(decideNavigation("app://other/x", ORIGIN)).toBe("deny");
  });

  it("lets same-origin will-navigate through", () => {
    const contents = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(contents as never, ORIGIN, openExternal);
    const ev = { preventDefault: vi.fn() };
    contents.emit("will-navigate", ev, `${ORIGIN}/inner`);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("window.open goes external for http(s), denied otherwise, same-origin denied in-window", () => {
    const contents = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(contents as never, ORIGIN, openExternal);
    expect(contents.open("https://example.com/x")).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/x");
    openExternal.mockClear();
    expect(contents.open("javascript:alert(1)")).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("decideBrowserPopup", () => {
  it("allows http(s) and the exact about:blank, denies every other scheme", () => {
    expect(decideBrowserPopup("https://accounts.google.com/o/oauth2/auth")).toBe("allow");
    expect(decideBrowserPopup("http://localhost:3000/cb")).toBe("allow");
    expect(decideBrowserPopup("about:blank")).toBe("allow");
    for (const bad of ["about:blank#x", "about:srcdoc", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "chrome://gpu", "app://sideform/", "%%%", ""]) {
      expect(decideBrowserPopup(bad), bad).toBe("deny");
    }
  });
});

describe("attachBrowserTabPolicy", () => {
  const host = (canOpen = true) => ({ canOpen: vi.fn(() => canOpen), open: vi.fn((o: unknown) => o as never) });
  type Allow = { action: string; outlivesOpener?: boolean; createWindow?: (o: unknown) => unknown; overrideBrowserWindowOptions?: { webPreferences?: Record<string, unknown> } };

  it("lets in-place http(s) navigation through", () => {
    const contents = fakeContents();
    attachBrowserTabPolicy(contents as never, host());
    const ev = { preventDefault: vi.fn() };
    contents.emit("will-navigate", ev, "https://example.com/x");
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("denies in-place navigation to non-http(s) schemes", () => {
    const contents = fakeContents();
    attachBrowserTabPolicy(contents as never, host());
    const ev = { preventDefault: vi.fn() };
    contents.emit("will-navigate", ev, "file:///etc/passwd");
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it("popups are ALLOWED as real child windows (createWindow hosts them as tabs), outliving the opener, with hardened webPreferences", () => {
    const contents = fakeContents();
    const h = host();
    attachBrowserTabPolicy(contents as never, h);
    for (const url of ["https://example.com/x", "about:blank"]) {
      const r = contents.open(url) as Allow;
      expect(r.action).toBe("allow");
      expect(r.outlivesOpener).toBe(true);
      expect(r.overrideBrowserWindowOptions?.webPreferences).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
      expect(h.open).not.toHaveBeenCalled(); // only when Electron calls createWindow
    }
    const options = { webContents: {} };
    const r = contents.open("https://example.com/x") as Allow;
    expect(r.createWindow?.(options)).toBe(options);
    expect(h.open).toHaveBeenCalledWith(options, "https://example.com/x");
  });

  it("popups to other schemes, and popups the host refuses, are denied", () => {
    const contents = fakeContents();
    const h = host();
    attachBrowserTabPolicy(contents as never, h);
    expect(contents.open("javascript:alert(1)")).toEqual({ action: "deny" });
    expect(contents.open("file:///etc/passwd")).toEqual({ action: "deny" });
    const closing = fakeContents();
    attachBrowserTabPolicy(closing as never, host(false));
    expect(closing.open("https://example.com/x")).toEqual({ action: "deny" });
  });
});

describe("attachLocalOnlyPolicy", () => {
  it("prevents will-navigate to any URL, local or remote", () => {
    const contents = fakeContents();
    attachLocalOnlyPolicy(contents as never);
    const ev = { preventDefault: vi.fn() };
    contents.emit("will-navigate", ev, "https://example.com/x");
    expect(ev.preventDefault).toHaveBeenCalled();
    ev.preventDefault.mockClear();
    contents.emit("will-navigate", ev, "file:///app/dist/tabbar/tabbar.html");
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it("always denies window.open", () => {
    const contents = fakeContents();
    attachLocalOnlyPolicy(contents as never);
    expect(contents.open("https://example.com/x")).toEqual({ action: "deny" });
    expect(contents.open("javascript:alert(1)")).toEqual({ action: "deny" });
  });
});

describe("shouldForwardNavigationEvent", () => {
  it("forwards main-frame navigation events", () => {
    expect(shouldForwardNavigationEvent({ isMainFrame: true })).toBe(true);
  });

  it("does NOT forward subframe navigation events (finding 1: ad/embed iframe navigating during the click-settle grace window)", () => {
    expect(shouldForwardNavigationEvent({ isMainFrame: false })).toBe(false);
  });
});

describe("decidePanelNavigation", () => {
  const PANEL = `${ORIGIN}/agent`;
  it("allows the panel path and its subpaths, with query/hash", () => {
    expect(decidePanelNavigation(`${ORIGIN}/agent`, PANEL)).toBe("allow");
    expect(decidePanelNavigation(`${ORIGIN}/agent/`, PANEL)).toBe("allow");
    expect(decidePanelNavigation(`${ORIGIN}/agent/chat/1?x=1#h`, PANEL)).toBe("allow");
  });
  it("denies other pages of the ui origin (the ui is not a browser)", () => {
    expect(decidePanelNavigation(`${ORIGIN}/settings`, PANEL)).toBe("deny");
    expect(decidePanelNavigation(`${ORIGIN}/`, PANEL)).toBe("deny");
    expect(decidePanelNavigation(`${ORIGIN}/agentx`, PANEL)).toBe("deny");
  });
  it("another host on the same scheme is not the ui origin", () => {
    expect(decidePanelNavigation("app://other/agent", PANEL)).toBe("deny");
    expect(decidePanelNavigation("https://sideform/agent", PANEL)).toBe("external");
  });
  it("compares against a dev server origin the same way", () => {
    const dev = "http://localhost:5174/agent";
    expect(decidePanelNavigation("http://localhost:5174/agent/x", dev)).toBe("allow");
    expect(decidePanelNavigation("http://localhost:5174/settings", dev)).toBe("deny");
    expect(decidePanelNavigation("http://localhost:5175/agent", dev)).toBe("external");
  });
  it("sends foreign http(s) external and denies the rest", () => {
    expect(decidePanelNavigation("https://example.com/agent", PANEL)).toBe("external");
    expect(decidePanelNavigation("file:///etc/passwd", PANEL)).toBe("deny");
    expect(decidePanelNavigation("%%%", PANEL)).toBe("deny");
  });
});

describe("attachPanelNavigationPolicy", () => {
  it("blocks will-navigate away from the panel and routes it", () => {
    const contents = fakeContents();
    const openExternal = vi.fn();
    attachPanelNavigationPolicy(contents as never, `${ORIGIN}/agent`, openExternal);
    const ok = { preventDefault: vi.fn() };
    contents.emit("will-navigate", ok, `${ORIGIN}/agent/x`);
    expect(ok.preventDefault).not.toHaveBeenCalled();
    const other = { preventDefault: vi.fn() };
    contents.emit("will-navigate", other, `${ORIGIN}/settings`);
    expect(other.preventDefault).toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    const ext = { preventDefault: vi.fn() };
    contents.emit("will-navigate", ext, "https://example.com/");
    expect(ext.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/");
  });
  it("denies popups and routes them the same way", () => {
    const contents = fakeContents();
    const openExternal = vi.fn();
    attachPanelNavigationPolicy(contents as never, `${ORIGIN}/agent`, openExternal);
    expect(contents.open(`${ORIGIN}/agent/x`)).toEqual({ action: "deny" });
    expect(contents.open(`${ORIGIN}/`)).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
    expect(contents.open("https://example.com/")).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/");
  });
});
