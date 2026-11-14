import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_CAPABILITIES } from "../chatTransport";

describe("CLIENT_CAPABILITIES (CONTRACT.md)", () => {
  it("equals the contract exactly, with no canvas, doc, workflow or app keys", () => {
    expect(CLIENT_CAPABILITIES).toEqual({
      desktopBrowser: expect.any(Boolean),
      browser: "desktop",
      browseQa: true,
      browseIsolation: expect.any(Boolean),
      browseAssert: expect.any(Boolean),
      traceTabs: expect.any(Boolean),
    });
    for (const key of ["canvasTabs", "docTabs", "workflowTabs", "browseApps", "browseNativeApps"]) {
      expect(CLIENT_CAPABILITIES).not.toHaveProperty(key);
    }
  });
});

describe("CLIENT_CAPABILITIES with the full shell", () => {
  afterEach(() => {
    delete window.penAgentPanel;
    vi.resetModules();
  });

  it("is exactly the contract object", async () => {
    window.penAgentPanel = {
      version: 3,
      browser: { isolated: () => ({}) as never, assert: async () => ({}) } as never,
      traces: { save: vi.fn(), open: vi.fn(), listTabs: vi.fn(), read: vi.fn() },
    };
    vi.resetModules();
    const fresh = await import("../chatTransport");
    expect(fresh.CLIENT_CAPABILITIES).toEqual({
      desktopBrowser: true,
      browser: "desktop",
      browseQa: true,
      browseIsolation: true,
      browseAssert: true,
      traceTabs: true,
    });
  });
});
