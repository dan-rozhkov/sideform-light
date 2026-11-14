import { afterEach, describe, expect, it, vi } from "vitest";
import { browseAssertAvailable, isolatedBrowseAvailable } from "@/lib/tools/browser/isolation";
import { closeBrowserSession, getBrowserBridge, isDesktopBrowserAvailable, resetBrowserBridgeCacheForTests } from "@/lib/tools/browser/bridge";
import { setPenDesktop, stubBrowser } from "./helpers";

afterEach(() => {
  delete window.penAgentPanel;
  resetBrowserBridgeCacheForTests();
});

describe("getBrowserBridge", () => {
  it("returns the panel's browser untouched", () => {
    const browser = setPenDesktop(stubBrowser());
    expect(getBrowserBridge()).toBe(browser);
    expect(getBrowserBridge("chat-1")).toBe(browser);
    expect(isDesktopBrowserAvailable()).toBe(true);
  });

  it("is undefined without the shell (there is no cloud browser)", () => {
    expect(getBrowserBridge()).toBeUndefined();
    expect(getBrowserBridge("chat-1", "qa-1")).toBeUndefined();
    expect(isDesktopBrowserAvailable()).toBe(false);
  });

  it("returns one isolated bridge per run session and reuses it", () => {
    const isolated = vi.fn((_id: string) => stubBrowser());
    const browser = setPenDesktop(stubBrowser({ isolated }));
    const a = getBrowserBridge("chat", "qa-a");
    expect(a).not.toBe(browser);
    expect(getBrowserBridge("chat", "qa-a")).toBe(a);
    expect(getBrowserBridge("chat", "qa-b")).not.toBe(a);
    expect(isolated.mock.calls.map((c) => c[0])).toEqual(["qa-a", "qa-b"]);
  });

  it("answers a closed session with an error bridge and never revives it", async () => {
    const isolated = vi.fn((_id: string) => stubBrowser());
    const closeSession = vi.fn(async () => ({ ok: true as const }));
    setPenDesktop(stubBrowser({ isolated, closeSession }));
    getBrowserBridge("chat", "qa-a");
    await closeBrowserSession("qa-a");
    expect(closeSession).toHaveBeenCalledWith("qa-a");
    const closed = getBrowserBridge("chat", "qa-a");
    expect(await closed?.snapshot?.()).toEqual({ error: "browser session closed" });
    expect(isolated).toHaveBeenCalledTimes(1);
  });
});

describe("capabilities derived from the bridge", () => {
  it("browseAssertAvailable is true only with browser.assert", () => {
    expect(browseAssertAvailable()).toBe(false);
    setPenDesktop(stubBrowser());
    expect(browseAssertAvailable()).toBe(false);
    setPenDesktop(stubBrowser({ assert: async () => ({}) }));
    expect(browseAssertAvailable()).toBe(true);
  });

  it("isolatedBrowseAvailable is true only with browser.isolated", () => {
    setPenDesktop(stubBrowser());
    expect(isolatedBrowseAvailable()).toBe(false);
    setPenDesktop(stubBrowser({ isolated: () => stubBrowser() }));
    expect(isolatedBrowseAvailable()).toBe(true);
  });
});
