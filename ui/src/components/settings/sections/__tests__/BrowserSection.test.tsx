import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserSection } from "../BrowserSection";

const ADS = "Block ads and trackers";

const setBridge = (browserSettings?: unknown) => {
  (window as { penDesktop?: unknown }).penDesktop = browserSettings ? { browserSettings } : {};
};

afterEach(() => {
  cleanup();
});

describe("BrowserSection", () => {
  it("shows no switch without the browserSettings bridge", () => {
    setBridge();
    render(<BrowserSection />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("offers the ad-blocking switch only: no MCP, app-access or trace switches", async () => {
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true }), set: vi.fn() });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("keeps the switch disabled until the value has loaded", async () => {
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: false }), set: vi.fn() });
    render(<BrowserSection />);
    const toggle = screen.getByRole("switch", { name: ADS });
    expect(toggle.hasAttribute("disabled") || toggle.getAttribute("aria-disabled") === "true").toBe(true);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-disabled")).not.toBe("true"));
  });

  it("calls set with { adBlock } on toggle", async () => {
    const set = vi.fn().mockResolvedValue({ adBlock: false });
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true }), set });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(screen.getByRole("switch", { name: ADS }));
    expect(set).toHaveBeenCalledWith({ adBlock: false });
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("false"));
  });

  it("reverts when set fails", async () => {
    const set = vi.fn().mockResolvedValue({ error: "nope" });
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true }), set });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("switch", { name: ADS }));
    await waitFor(() => expect(set).toHaveBeenCalledWith({ adBlock: false }));
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
  });
});
