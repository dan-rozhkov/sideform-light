import { describe, expect, it } from "vitest";
import { decideEmptyFocus, decideQuietFocus, isTabCreationSender, planEmptyViewUpdate } from "../src/main/emptyView";

describe("emptyView decisions", () => {
  it("applies visibility, theme and session count only on change", () => {
    const hidden = { visible: false, theme: "light" as const, sessionTabs: 0 };
    expect(planEmptyViewUpdate(hidden, hidden, false)).toEqual({ focus: "none" });
    expect(planEmptyViewUpdate(hidden, { ...hidden, visible: true }, false)).toEqual({ focus: "panel", visible: true });
    expect(planEmptyViewUpdate({ ...hidden, visible: true }, { visible: true, theme: "dark", sessionTabs: 0 }, true)).toEqual({
      focus: "none",
      theme: "dark",
    });
    expect(planEmptyViewUpdate({ ...hidden, visible: true }, { ...hidden, visible: false }, false)).toEqual({
      focus: "none",
      visible: false,
    });
    expect(planEmptyViewUpdate({ ...hidden, visible: true }, { ...hidden, visible: true, sessionTabs: 2 }, false)).toEqual({
      focus: "none",
      sessionTabs: 2,
    });
  });

  it("focuses the placeholder only when the user closed the last tab", () => {
    expect(decideEmptyFocus(true, true)).toBe("empty");
    // Agent closes, fixture resets and the window's startup push go to the panel.
    expect(decideEmptyFocus(true, false)).toBe("panel");
    expect(decideEmptyFocus(false, true)).toBe("none");
    expect(decideEmptyFocus(false, false)).toBe("none");
  });

  it("accepts tab creation from the tab bar or the empty view only", () => {
    expect(isTabCreationSender(1, 1, 2)).toBe(true);
    expect(isTabCreationSender(2, 1, 2)).toBe(true);
    expect(isTabCreationSender(3, 1, 2)).toBe(false);
    expect(isTabCreationSender(3, 1, undefined)).toBe(false);
  });
});

import { focusAfterCollapse, resolveFocusTarget } from "../src/main/emptyView";

describe("focus with a collapsed agent panel", () => {
  it("never focuses the hidden panel", () => {
    expect(resolveFocusTarget("panel", true, true)).toBe("empty");
    expect(resolveFocusTarget("panel", true, false)).toBe("tab");
    expect(resolveFocusTarget("panel", false, true)).toBe("panel");
  });
  it("leaves other targets alone", () => {
    expect(resolveFocusTarget("empty", true, true)).toBe("empty");
    expect(resolveFocusTarget("none", true, true)).toBe("none");
  });
  it("collapsing while the panel has focus moves it to the placeholder or the active tab", () => {
    expect(focusAfterCollapse(true)).toBe("empty");
    expect(focusAfterCollapse(false)).toBe("tab");
  });
});

describe("quiet activation hides the empty view", () => {
  const shown = { visible: true, theme: "light" as const, sessionTabs: 0 };
  const hidden = { ...shown, visible: false };
  const ctx = { quiet: true, emptyHadFocus: false, panelCollapsed: false };

  it("keeps focus where it is when the panel is visible and the empty view had none", () => {
    expect(decideQuietFocus(ctx)).toBe("none");
    expect(planEmptyViewUpdate(shown, hidden, false, ctx)).toEqual({ focus: "none", visible: false });
  });
  it("the empty view had focus: the visible agent panel takes it", () => {
    expect(planEmptyViewUpdate(shown, hidden, false, { ...ctx, emptyHadFocus: true })).toEqual({ focus: "panel", visible: false });
  });
  it("the panel is collapsed: the new active tab takes it", () => {
    expect(decideQuietFocus({ ...ctx, panelCollapsed: true })).toBe("tab");
    expect(decideQuietFocus({ ...ctx, panelCollapsed: true, emptyHadFocus: true })).toBe("tab");
  });
  it("a normal (focused) activation or no context never moves focus here", () => {
    expect(decideQuietFocus({ ...ctx, quiet: false, emptyHadFocus: true, panelCollapsed: true })).toBe("none");
    expect(planEmptyViewUpdate(shown, hidden, false)).toEqual({ focus: "none", visible: false });
  });
  it("only the moment the view hides: no move when it stays hidden or stays visible", () => {
    expect(planEmptyViewUpdate(hidden, hidden, false, { ...ctx, emptyHadFocus: true })).toEqual({ focus: "none" });
    expect(planEmptyViewUpdate(shown, shown, false, { ...ctx, emptyHadFocus: true })).toEqual({ focus: "none" });
  });
  it("resolveFocusTarget passes the tab target through", () => {
    expect(resolveFocusTarget("tab", true, false)).toBe("tab");
  });
});
