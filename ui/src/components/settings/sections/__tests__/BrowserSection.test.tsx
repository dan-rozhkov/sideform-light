import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserSection } from "../BrowserSection";

const ADS = "Block ads and trackers";
const TRACES = "Record traces";

const setBridge = (browserSettings?: unknown) => {
  (window as { penDesktop?: unknown }).penDesktop = browserSettings ? { browserSettings } : {};
};

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
});

describe("BrowserSection", () => {
  it("shows the trace select, default 'QA tests and MCP tasks', without the browserSettings bridge", () => {
    setBridge();
    render(<BrowserSection />);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByRole("combobox", { name: TRACES }).textContent).toContain("QA tests and MCP tasks");
  });

  it.each([
    ["All runs", "all"],
    ["QA tests only", "qa"],
  ])("choosing '%s' stores '%s' in localStorage", async (label, stored) => {
    setBridge();
    render(<BrowserSection />);
    fireEvent.click(screen.getByRole("combobox", { name: TRACES }));
    const option = await screen.findByRole("option", { name: label });
    // base-ui selects on the pointer-up of a press, so a bare click does not choose.
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    await waitFor(() => expect(localStorage.getItem("pen.browseTraces")).toBe(stored));
    await waitFor(() => expect(screen.getByRole("combobox", { name: TRACES }).textContent).toContain(label));
  });

  it("offers the trace select and the ad-blocking switch with the bridge: no MCP or app-access switches", async () => {
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true }), set: vi.fn() });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: TRACES })).toBeTruthy();
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
