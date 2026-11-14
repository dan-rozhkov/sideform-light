import { describe, expect, it, vi } from "vitest";
import { pickScriptRoute, withScriptTimeout, type StuckInput } from "../src/main/scriptRoute";

const base: StuckInput = { isBrowserTab: true, placeholderShown: false, navigationPending: false, chromiumLoading: false };

describe("pickScriptRoute", () => {
  it("uses the default Electron route on a settled page", () => {
    expect(pickScriptRoute(base)).toBe("electron");
  });
  it("goes through the frame only when committed + dom-ready but Chromium still loads", () => {
    expect(pickScriptRoute({ ...base, chromiumLoading: true })).toBe("frame");
  });
  it("keeps the default while a main-frame navigation is pending (no script on the outgoing document)", () => {
    expect(pickScriptRoute({ ...base, navigationPending: true, chromiumLoading: true })).toBe("electron");
  });
  it("keeps the default for the placeholder and for non-browser tabs", () => {
    expect(pickScriptRoute({ ...base, placeholderShown: true, chromiumLoading: true })).toBe("electron");
    expect(pickScriptRoute({ ...base, isBrowserTab: false, chromiumLoading: true })).toBe("electron");
  });
});

describe("withScriptTimeout", () => {
  it("resolves and rejects like the promise", async () => {
    await expect(withScriptTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(withScriptTimeout(Promise.reject(new Error("x")), 50)).rejects.toThrow("x");
  });
  it("rejects when it never settles", async () => {
    vi.useFakeTimers();
    const p = withScriptTimeout(new Promise(() => {}), 100);
    const assertion = expect(p).rejects.toThrow("Frame script timed out after 100ms.");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    vi.useRealTimers();
  });
});
