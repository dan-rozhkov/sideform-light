import { describe, expect, it } from "vitest";
import { isBrowserOwner, isOrphaningEvent } from "../src/main/orphanRelease";

describe("isOrphaningEvent", () => {
  it("renderer death always orphans", () => {
    expect(isOrphaningEvent({ type: "render-process-gone" })).toBe(true);
  });
  it("a committed main-frame navigation orphans", () => {
    expect(isOrphaningEvent({ type: "did-navigate", isMainFrame: true, isSameDocument: false })).toBe(true);
  });
  it("a subframe or same-document navigation does not", () => {
    expect(isOrphaningEvent({ type: "did-navigate", isMainFrame: false, isSameDocument: false })).toBe(false);
    expect(isOrphaningEvent({ type: "did-navigate", isMainFrame: true, isSameDocument: true })).toBe(false);
  });
});

describe("isBrowserOwner", () => {
  it("only the live panel owns; a null panel never matches", () => {
    expect(isBrowserOwner(7, 7)).toBe(true);
    expect(isBrowserOwner(5, 7)).toBe(false);
    expect(isBrowserOwner(7, null)).toBe(false);
  });
});
