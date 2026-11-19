import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS_NAV } from "@/components/settings/settingsSections";
import { t, useLanguageStore } from "@/i18n";
import { parseSettingsSection, SETTINGS_SECTIONS } from "@/lib/openSettings";
import { MemorySection } from "../MemorySection";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const state = (over: Record<string, unknown> = {}) => ({
  available: true,
  enabled: true,
  memory: ["Project uses pnpm"],
  user: ["Prefers short answers", "Lives in Berlin"],
  limits: { memory: 2200, user: 1375 },
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls as [string, RequestInit | undefined][];

beforeEach(() => {
  localStorage.setItem("pen.userId", "u1");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  useLanguageStore.setState({ language: "en" });
});

describe("MemorySection", () => {
  it("is in the nav after Model and reachable by ?section=memory", () => {
    expect(SETTINGS_SECTIONS).toContain("memory");
    expect(parseSettingsSection("memory")).toBe("memory");
    const ids = SETTINGS_NAV.map((s) => s.id);
    expect(ids.indexOf("memory")).toBe(ids.indexOf("model") + 1);
    expect(t("settings.nav.memory")).toBe("Memory");
  });

  it("lists the entries per group with a usage gauge, and says it stays on this device", async () => {
    fetchMock.mockResolvedValue(json(state()));
    render(<MemorySection />);
    expect(await screen.findByText("Prefers short answers")).toBeTruthy();
    expect(screen.getByText("Project uses pnpm")).toBeTruthy();
    expect(screen.getByText(/saved on this device only/)).toBeTruthy();
    const used = "Prefers short answers\n§\nLives in Berlin".length;
    expect(screen.getByText(`${used} of 1375 characters used`)).toBeTruthy();
    expect(screen.getByText("17 of 2200 characters used")).toBeTruthy();
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute("aria-valuenow")).toBe(String(used));
    expect(calls()[0][0]).toBe("/api/memory?userId=u1");
  });

  it("shows the empty state without Clear all", async () => {
    fetchMock.mockResolvedValue(json(state({ memory: [], user: [] })));
    render(<MemorySection />);
    expect(await screen.findByText("The agent has not saved anything yet")).toBeTruthy();
    expect(screen.queryByText("Clear all")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a calm unavailable state for available: false and for a 503", async () => {
    fetchMock.mockResolvedValueOnce(json(state({ available: false })));
    const first = render(<MemorySection />);
    expect(await screen.findByText("Memory is not available")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    first.unmount();
    fetchMock.mockResolvedValueOnce(json({ error: "memory_unavailable" }, 503));
    render(<MemorySection />);
    expect(await screen.findByText("Memory is not available")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("shows a load error with Retry", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "x" }, 500)).mockResolvedValueOnce(json(state()));
    render(<MemorySection />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load the memory.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Lives in Berlin")).toBeTruthy();
  });

  it("deletes one entry and sends target and text", async () => {
    fetchMock.mockResolvedValueOnce(json(state())).mockResolvedValueOnce(json({ removed: true }));
    render(<MemorySection />);
    await screen.findByText("Lives in Berlin");
    fireEvent.click(screen.getByRole("button", { name: "Delete: Lives in Berlin" }));
    await waitFor(() => expect(screen.queryByText("Lives in Berlin")).toBeNull());
    const [url, init] = calls()[1];
    expect(url).toBe("/api/memory/entry?userId=u1");
    expect(JSON.parse(String(init?.body))).toEqual({ target: "user", text: "Lives in Berlin" });
  });

  it("brings the entry back and shows an error when the delete fails", async () => {
    fetchMock.mockResolvedValueOnce(json(state())).mockResolvedValueOnce(json({ error: "x" }, 500));
    render(<MemorySection />);
    await screen.findByText("Lives in Berlin");
    fireEvent.click(screen.getByRole("button", { name: "Delete: Lives in Berlin" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not delete that entry.");
    expect(screen.getByText("Lives in Berlin")).toBeTruthy();
  });

  it("keeps the removal when the entry is already gone (404)", async () => {
    fetchMock.mockResolvedValueOnce(json(state())).mockResolvedValueOnce(json({ error: "nf" }, 404));
    render(<MemorySection />);
    await screen.findByText("Lives in Berlin");
    fireEvent.click(screen.getByRole("button", { name: "Delete: Lives in Berlin" }));
    await waitFor(() => expect(screen.queryByText("Lives in Berlin")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears everything only after an in-page confirm, with no window.confirm", async () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    fetchMock.mockResolvedValueOnce(json(state())).mockResolvedValueOnce(json({ cleared: { memory: 1, user: 2 } }));
    render(<MemorySection />);
    await screen.findByText("Lives in Berlin");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const group = screen.getByRole("group", { name: "Confirm clearing memory" });
    expect(screen.getByText(/It cannot be undone/)).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: "Delete all" }));
    expect(await screen.findByText("The agent has not saved anything yet")).toBeTruthy();
    expect(calls()[1][1]?.method).toBe("DELETE");
    expect(calls()[1][0]).toBe("/api/memory?userId=u1");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("cancelling the confirm clears nothing", async () => {
    fetchMock.mockResolvedValueOnce(json(state()));
    render(<MemorySection />);
    await screen.findByText("Lives in Berlin");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Lives in Berlin")).toBeTruthy();
  });

  it("keeps the entries and shows an error when clearing fails", async () => {
    fetchMock.mockResolvedValueOnce(json(state())).mockResolvedValueOnce(json({ error: "x" }, 500));
    render(<MemorySection />);
    await screen.findByText("Lives in Berlin");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not clear the memory.");
    expect(screen.getByText("Lives in Berlin")).toBeTruthy();
  });

  it("toggles 'Agent remembers' with PUT and rolls back on failure", async () => {
    fetchMock
      .mockResolvedValueOnce(json(state()))
      .mockResolvedValueOnce(json({ enabled: false }))
      .mockResolvedValueOnce(json({ error: "x" }, 500));
    render(<MemorySection />);
    const sw = await screen.findByRole("switch", { name: "Agent remembers" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Agent remembers" }).getAttribute("aria-checked")).toBe("false"));
    expect(calls()[1][0]).toBe("/api/memory/settings?userId=u1");
    expect(calls()[1][1]?.method).toBe("PUT");
    expect(JSON.parse(String(calls()[1][1]?.body))).toEqual({ enabled: false });
    fireEvent.click(screen.getByRole("switch", { name: "Agent remembers" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not change this setting.");
    expect(screen.getByRole("switch", { name: "Agent remembers" }).getAttribute("aria-checked")).toBe("false");
  });
});
