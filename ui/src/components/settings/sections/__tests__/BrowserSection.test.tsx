import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserSection } from "../BrowserSection";

const ADS = "Block ads and trackers";
const TRACES = "Record traces for all runs";

const setBridge = (browserSettings?: unknown) => {
  (window as { penDesktop?: unknown }).penDesktop = browserSettings ? { browserSettings } : {};
};

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
});

describe("BrowserSection", () => {
  it("shows only the trace switch without the browserSettings bridge", () => {
    setBridge();
    render(<BrowserSection />);
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: TRACES }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("switch", { name: ADS })).toBeNull();
  });

  it("toggling the trace switch stores 'all' in localStorage and removes it again", () => {
    setBridge();
    render(<BrowserSection />);
    fireEvent.click(screen.getByRole("switch", { name: TRACES }));
    expect(localStorage.getItem("pen.browseTraces")).toBe("all");
    expect(screen.getByRole("switch", { name: TRACES }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: TRACES }));
    expect(localStorage.getItem("pen.browseTraces")).toBeNull();
    expect(screen.getByRole("switch", { name: TRACES }).getAttribute("aria-checked")).toBe("false");
  });

  it("offers the trace and ad-blocking switches with the bridge: no MCP or app-access switches", async () => {
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true }), set: vi.fn() });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getAllByRole("switch")[0].getAttribute("aria-label")).toBe(TRACES);
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
