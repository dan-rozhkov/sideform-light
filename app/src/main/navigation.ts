import { decideBrowserNavigation } from "@sideform/browser-agent/controller";
import type { BrowserWindowConstructorOptions, WebContents } from "electron";
import { originOf } from "./config";
import { secureWebPreferences } from "./webPreferences";

export type NavigationDecision = "allow" | "external" | "deny";

/** Pure policy: same-origin as the ui → allow; other http(s) → external; else deny. */
export function decideNavigation(targetUrl: string, uiOrigin: string): NavigationDecision {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return "deny";
  }
  if (originOf(targetUrl) === uiOrigin) return "allow";
  if (url.protocol === "http:" || url.protocol === "https:") return "external";
  return "deny";
}

/** Wires will-navigate + setWindowOpenHandler on a WebContents per the policy. */
export function attachNavigationPolicy(
  contents: WebContents,
  uiOrigin: string,
  openExternal: (url: string) => void,
): void {
  contents.on("will-navigate", (event, url) => {
    const decision = decideNavigation(url, uiOrigin);
    if (decision === "allow") return;
    event.preventDefault();
    if (decision === "external") openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, uiOrigin) === "external") openExternal(url);
    // Same-origin popups are also denied: tabs
    // are created only via the shell UI/menu.
    return { action: "deny" };
  });
}

export type PanelNavigationDecision = "allow" | "external" | "deny";

/**
 * Pure policy for the agent panel: it may only stay on its own page. Same
 * origin AND the panel path (`panelUrl`'s pathname) or a subpath -> allow;
 * any other URL on the ui origin -> deny (the ui has no other page a panel
 * link should reach); other http(s) origins -> system browser; everything
 * else deny.
 */
export function decidePanelNavigation(targetUrl: string, panelUrl: string): PanelNavigationDecision {
  let url: URL;
  let panel: URL;
  try {
    url = new URL(targetUrl);
    panel = new URL(panelUrl);
  } catch {
    return "deny";
  }
  if (originOf(targetUrl) === originOf(panelUrl)) {
    const base = panel.pathname.replace(/\/+$/, "");
    return url.pathname === base || url.pathname.startsWith(`${base}/`) ? "allow" : "deny";
  }
  if (url.protocol === "http:" || url.protocol === "https:") return "external";
  return "deny";
}

/** Wires will-navigate + setWindowOpenHandler on the agent panel per `decidePanelNavigation`. */
export function attachPanelNavigationPolicy(
  contents: WebContents,
  panelUrl: string,
  openExternal: (url: string) => void,
): void {
  const route = (decision: PanelNavigationDecision, url: string) => {
    if (decision === "external") openExternal(url);
  };
  contents.on("will-navigate", (event, url) => {
    const decision = decidePanelNavigation(url, panelUrl);
    if (decision === "allow") return;
    event.preventDefault();
    route(decision, url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    route(decidePanelNavigation(url, panelUrl), url);
    return { action: "deny" };
  });
}

/**
 * Pure policy for a popup (`target="_blank"`, `window.open`) of a browser tab:
 * http(s) is allowed like any in-place navigation, plus the exact `about:blank`
 * that `window.open()` / `window.open("")` reports before the page script
 * navigates the new window itself (that later navigation still goes through
 * the popup's own `will-navigate` policy). Every other scheme is denied.
 */
export function decideBrowserPopup(targetUrl: string): "allow" | "deny" {
  return targetUrl === "about:blank" || decideBrowserNavigation(targetUrl) === "allow" ? "allow" : "deny";
}

/** What a browser tab needs from the window to host its popups as tabs (`window.ts`). */
export interface BrowserPopupHost {
  /** False when the popup must be dropped (e.g. its isolated session is closing). */
  canOpen(): boolean;
  /**
   * Adopts the WebContents Electron created for the popup (`options.webContents`) as a browser tab and returns
   * it. The new contents is a real child of the opener (`window.opener`, `postMessage`, `closed`, `window.close()`).
   */
  open(options: BrowserWindowConstructorOptions, url: string): WebContents;
}

/**
 * Wires a browser tab's WebContents per `decideBrowserNavigation`: in-place
 * http(s) navigation is left alone, everything else is blocked. Popups
 * (`target="_blank"`, `window.open`) open as a new browser tab instead of
 * escaping to the system browser — the whole point of the built-in browser is
 * to keep the user's session inside the app. They are ALLOWED with
 * `createWindow`, so the popup keeps its opener (OAuth / "Sign in with
 * Google" report back through `window.opener.postMessage`) and `window.open`
 * returns a window, not `null`. The popup's webPreferences are forced to the
 * browser-tab hardening (no preload, sandbox, context isolation, no Node); it
 * inherits the opener's session. Like in Chrome a popup outlives its opener.
 */
export function attachBrowserTabPolicy(contents: WebContents, host: BrowserPopupHost): void {
  contents.on("will-navigate", (event, url) => {
    if (decideBrowserNavigation(url) === "deny") event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (decideBrowserPopup(url) === "deny" || !host.canOpen()) return { action: "deny" };
    return {
      action: "allow",
      outlivesOpener: true,
      overrideBrowserWindowOptions: { webPreferences: secureWebPreferences() },
      createWindow: (options) => host.open(options, url),
    };
  });
}

/**
 * Locks a WebContents down to whatever it was constructed with — used for the
 * tabbar view, which only ever loads local tabbar.html but has the penTabbar
 * IPC API attached. Any navigation attempt (e.g. a URL dragged onto the tab
 * strip) is blocked outright, and popups are always denied.
 */
export function attachLocalOnlyPolicy(contents: WebContents): void {
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

/**
 * Whether a `did-start-navigation`/`did-navigate-in-page` event should be
 * forwarded to `@sideform/browser-agent/controller`'s navigation-watch settle (`window.ts`'s
 * `onNavigationEvent`, feeding `armNavigationWatcher`). Both events fire for
 * ANY frame, not just the main one, and carry an `isMainFrame` flag — without
 * this filter, a subframe navigation (an ad/embed iframe reloading itself,
 * say) firing during the short post-click grace window made an ordinary,
 * non-navigating click look like it had started a real navigation, forcing
 * the caller to pay the full multi-second "wait for load" settle
 * (`CLICK_LOAD_SETTLE_TIMEOUT_MS`, 8s) for nothing — `isLoading()` reflects
 * the whole tab including subframes, so it looked exactly like a genuine
 * main-frame navigation. `did-navigate` needs no equivalent filter — per
 * Electron's own doc it "is emitted when a main frame navigation is done"
 * and never fires for a subframe. `did-start-loading` carries no frame
 * information at all (it reflects the whole tab's loading state, which
 * *does* flip for a subframe load) — with nothing to filter on, it is not
 * forwarded at all rather than risk the same false positive.
 */
export function shouldForwardNavigationEvent(details: { isMainFrame: boolean }): boolean {
  return details.isMainFrame;
}
