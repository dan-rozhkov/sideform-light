/**
 * The tab strip's loading fill follows the MAIN-FRAME document, not every resource of the page.
 * `webContents.isLoading()` stays true while any subresource hangs (an anti-bot challenge, a dead
 * tracker) although the page is rendered and usable, and `did-start-loading` also fires for
 * iframe navigations. So the fill is driven by these events only, and it is OWNED by the
 * navigation that started it (its url, followed through redirects):
 *
 * - starts: a main-frame cross-document navigation begins (a reload is one too). The hidden
 *   about:blank placeholder (`placeholder: true`, decided by the commit gate) never starts it.
 *   Subframe and same-document navigations never do. A newer start takes the ownership.
 * - ends at the first of:
 *   - main-frame `dom-ready`, but only AFTER the owning navigation committed (main-frame
 *     `did-navigate`): the old document's or the placeholder's dom-ready is not the owner's.
 *   - `did-stop-loading` with the view idle (covers a 204 / download that never commits).
 *   - main-frame `did-fail-load` of the OWNING navigation (`validatedURL` matches), whatever the
 *     code. ERR_ABORTED included: a download, a 204 or a cancelled redirect leaves no newer
 *     navigation, and a previous document's hanging subresource keeps the view "loading", so no
 *     idle stop would come. A failure of another (older, superseded) navigation is ignored.
 *     An error page commits without `did-navigate`, but its `did-fail-load` already ended the fill.
 *   - the renderer crashing.
 * Limit: an ERR_ABORTED of a superseded navigation with the SAME url as the newer one (two quick
 * reloads) is told apart by counting the starts of that url.
 */
export type TabLoadingEvent =
  | { type: "navigation-start"; url: string; isMainFrame: boolean; isSameDocument: boolean; placeholder: boolean }
  | { type: "redirect"; url: string; isMainFrame: boolean }
  | { type: "navigated" }
  | { type: "dom-ready" }
  | { type: "stop"; idle: boolean }
  | { type: "fail-load"; isMainFrame: boolean; errorCode: number; url: string }
  | { type: "render-process-gone" };

/** Chromium's ERR_ABORTED. */
export const ERR_ABORTED = -3;

export interface TabLoadingState {
  loading: boolean;
  /** Url of the navigation that owns the fill (after redirects); null while idle. */
  owner: string | null;
  /** Starts of the owner's url not yet reported failed/superseded (two quick reloads of one url). */
  ownerStarts: number;
  /** The owning navigation committed its document. */
  committed: boolean;
}

export const IDLE_TAB_LOADING: TabLoadingState = { loading: false, owner: null, ownerStarts: 0, committed: false };

const sameUrl = (a: string, b: string) => a.split("#")[0] === b.split("#")[0];

/** Next state after one event. Pure. */
export function nextTabLoading(state: TabLoadingState, event: TabLoadingEvent): TabLoadingState {
  switch (event.type) {
    case "navigation-start":
      if (!event.isMainFrame || event.isSameDocument || event.placeholder) return state;
      if (state.loading && state.owner !== null && sameUrl(state.owner, event.url)) return { ...state, ownerStarts: state.ownerStarts + 1, committed: false };
      return { loading: true, owner: event.url, ownerStarts: 1, committed: false };
    case "redirect":
      if (!state.loading || !event.isMainFrame) return state;
      return { ...state, owner: event.url };
    case "navigated":
      return state.loading ? { ...state, committed: true } : state;
    case "dom-ready":
      return state.loading && state.committed ? IDLE_TAB_LOADING : state;
    case "stop":
      return event.idle ? IDLE_TAB_LOADING : state;
    case "fail-load": {
      if (!state.loading || !event.isMainFrame || state.owner === null || !sameUrl(state.owner, event.url)) return state;
      if (event.errorCode === ERR_ABORTED && state.ownerStarts > 1) return { ...state, ownerStarts: state.ownerStarts - 1 };
      return IDLE_TAB_LOADING;
    }
    case "render-process-gone":
      return IDLE_TAB_LOADING;
  }
}

/**
 * Feeds events into `nextTabLoading`. THE place that owns "pushed on change only": `onChange`
 * runs when the flag flips, never for an unchanged value (TabManager relies on this).
 */
export function createTabLoading(onChange: (loading: boolean) => void): (event: TabLoadingEvent) => void {
  let state = IDLE_TAB_LOADING;
  return (event) => {
    const next = nextTabLoading(state, event);
    const changed = next.loading !== state.loading;
    state = next;
    if (changed) onChange(state.loading);
  };
}
