import { describe, expect, it } from "vitest";
import { createTabLoading, IDLE_TAB_LOADING, nextTabLoading, type TabLoadingEvent } from "../src/main/tabLoading";

const A = "https://a.test/";
const B = "https://b.test/";
const start = (url: string, over: Partial<Extract<TabLoadingEvent, { type: "navigation-start" }>> = {}): TabLoadingEvent => ({
  type: "navigation-start",
  url,
  isMainFrame: true,
  isSameDocument: false,
  placeholder: false,
  ...over,
});
const navigated: TabLoadingEvent = { type: "navigated" };
const domReady: TabLoadingEvent = { type: "dom-ready" };
const stop = (idle: boolean): TabLoadingEvent => ({ type: "stop", idle });
const fail = (url: string, errorCode: number, isMainFrame = true): TabLoadingEvent => ({ type: "fail-load", isMainFrame, errorCode, url });

function run(events: TabLoadingEvent[]): boolean[] {
  const seen: boolean[] = [];
  const feed = createTabLoading((l) => seen.push(l));
  for (const e of events) feed(e);
  return seen;
}

describe("tab loading fill", () => {
  it("normal load: starts on the navigation, ends at dom-ready after the commit, later stop changes nothing", () => {
    expect(run([start(A), navigated, domReady, stop(true)])).toEqual([true, false]);
  });

  it("dom-ready long before did-stop-loading", () => {
    expect(run([start(A), navigated, domReady, stop(false), stop(true)])).toEqual([true, false]);
  });

  it("a hanging subresource (no stop ever) does not keep the fill", () => {
    expect(run([start(A), navigated, domReady])).toEqual([true, false]);
  });

  it("ends at stop when the view is idle even without dom-ready", () => {
    expect(run([start(A), stop(true)])).toEqual([true, false]);
  });

  it("a stop while the view is still loading (superseded load) keeps the fill", () => {
    expect(run([start(A), stop(false)])).toEqual([true]);
  });

  it("subframe and same-document navigations never start the fill", () => {
    const sub = start(A, { isMainFrame: false });
    const sameDoc = start(A, { isSameDocument: true });
    expect(run([start(A), navigated, domReady, sub, sameDoc])).toEqual([true, false]);
    expect(run([sub, sameDoc])).toEqual([]);
  });

  it("the hidden placeholder never shows the fill, nor does its commit and dom-ready", () => {
    expect(run([start("about:blank", { placeholder: true }), navigated, domReady, stop(true)])).toEqual([]);
  });

  it("a reload is a main-frame navigation: starts again", () => {
    expect(run([start(A), navigated, domReady, start(A), navigated, domReady])).toEqual([true, false, true, false]);
  });

  it("a crash ends the fill", () => {
    expect(run([start(A), { type: "render-process-gone" }])).toEqual([true, false]);
  });
});

describe("the fill is owned by the navigation that started it (finding 1)", () => {
  it("the old document's dom-ready (no commit of the new navigation yet) does not end the fill", () => {
    expect(run([start(A), navigated, domReady, start(B), domReady])).toEqual([true, false, true]);
    // ... and the new navigation's own commit + dom-ready does.
    expect(run([start(A), navigated, domReady, start(B), domReady, navigated, domReady])).toEqual([true, false, true, false]);
  });

  it("the placeholder's late dom-ready cannot end a real navigation that has not committed", () => {
    expect(run([start("about:blank", { placeholder: true }), navigated, start(A), domReady])).toEqual([true]);
    expect(run([start("about:blank", { placeholder: true }), navigated, start(A), domReady, navigated, domReady])).toEqual([true, false]);
  });

  it("a superseded navigation's commit is replaced: a start resets the committed mark", () => {
    expect(run([start(A), navigated, start(B), domReady])).toEqual([true]);
  });

  it("an error page: its did-fail-load ends the fill although it commits without did-navigate", () => {
    expect(run([start(A), fail(A, -102), domReady])).toEqual([true, false]);
  });
});

describe("did-fail-load ends only the owning navigation (finding 2)", () => {
  it("an aborted (-3) navigation with no newer one ends the fill, even while the old page keeps loading", () => {
    // Download / 204 / cancelled redirect: isLoading stays true (no idle stop), no dom-ready.
    expect(run([start(A), navigated, domReady, start(B), fail(B, -3), stop(false)])).toEqual([true, false, true, false]);
  });

  it("any code of the owning navigation ends it; a subframe failure does not", () => {
    expect(run([start(A), fail(A, -105)])).toEqual([true, false]);
    expect(run([start(A), fail(A, -105, false)])).toEqual([true]);
  });

  it("a late failure of an OLDER navigation is ignored, aborted or not", () => {
    expect(run([start(A), start(B), fail(A, -3)])).toEqual([true]);
    expect(run([start(A), start(B), fail(A, -105)])).toEqual([true]);
    expect(run([start(A), start(B), fail(A, -105), navigated, domReady])).toEqual([true, false]);
  });

  it("a redirect moves the ownership to the redirected url", () => {
    const redirect: TabLoadingEvent = { type: "redirect", url: B, isMainFrame: true };
    expect(run([start(A), redirect, fail(B, -3)])).toEqual([true, false]);
    expect(run([start(A), redirect, fail(A, -3)])).toEqual([true]);
    expect(run([start(A), { type: "redirect", url: B, isMainFrame: false }, fail(B, -3)])).toEqual([true]);
  });

  it("a fragment difference does not break the match", () => {
    expect(run([start(A + "#x"), fail(A, -3)])).toEqual([true, false]);
  });

  it("two quick reloads of one url: the aborted first one does not end the second", () => {
    expect(run([start(A), start(A), fail(A, -3)])).toEqual([true]);
    expect(run([start(A), start(A), fail(A, -3), navigated, domReady])).toEqual([true, false]);
    expect(run([start(A), start(A), fail(A, -3), fail(A, -3)])).toEqual([true, false]);
  });

  it("failures and events while idle change nothing", () => {
    expect(nextTabLoading(IDLE_TAB_LOADING, fail(A, -3))).toBe(IDLE_TAB_LOADING);
    expect(nextTabLoading(IDLE_TAB_LOADING, domReady)).toBe(IDLE_TAB_LOADING);
    expect(nextTabLoading(IDLE_TAB_LOADING, navigated)).toBe(IDLE_TAB_LOADING);
  });
});

describe("pushed on change only", () => {
  it("never reports an unchanged value", () => {
    expect(run([start(A), start(B), start(B), stop(true), stop(true), domReady])).toEqual([true, false]);
  });
});
