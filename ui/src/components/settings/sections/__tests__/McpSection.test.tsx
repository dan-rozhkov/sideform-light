import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { McpSettingsView } from "@/lib/desktopBridge";
import { McpSection } from "../McpSection";
import { SETTINGS_SECTIONS } from "@/lib/openSettings";
import { SETTINGS_NAV } from "@/components/settings/settingsSections";

const TOKEN = "a".repeat(64);
const view = (over: Partial<McpSettingsView> = {}): McpSettingsView => ({
  enabled: true,
  port: 47821,
  url: "http://127.0.0.1:47821/mcp",
  token: TOKEN,
  status: { state: "listening" },
  ...over,
});

const setMcp = (mcp?: unknown) => {
  (window as { penDesktop?: unknown }).penDesktop = mcp ? { mcp } : {};
};

afterEach(() => {
  cleanup();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("McpSection", () => {
  it("registers the mcp section in the nav and the section list", () => {
    expect(SETTINGS_SECTIONS).toContain("mcp");
    expect(SETTINGS_NAV.find((s) => s.id === "mcp")?.labelKey).toBe("settings.nav.mcp");
  });

  it("says it is not available when penDesktop.mcp is absent", () => {
    setMcp();
    render(<McpSection />);
    expect(screen.getByText("Not available in this version")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("renders without penDesktop at all", () => {
    delete (window as { penDesktop?: unknown }).penDesktop;
    render(<McpSection />);
    expect(screen.getByText("Not available in this version")).toBeTruthy();
  });

  it("shows the status, the URL and a hidden token that can be revealed", async () => {
    setMcp({ get: vi.fn().mockResolvedValue(view()), set: vi.fn(), regenerateToken: vi.fn() });
    render(<McpSection />);
    await waitFor(() => expect(screen.getByTestId("mcp-status").textContent).toBe("Listening on http://127.0.0.1:47821/mcp"));
    expect(screen.getByTestId("mcp-url").textContent).toBe("http://127.0.0.1:47821/mcp");
    expect(screen.getByTestId("mcp-token").textContent).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: "Show token" }));
    expect(screen.getByTestId("mcp-token").textContent).toBe(TOKEN);
    expect(document.body.textContent).toContain(`Authorization: "Bearer ${TOKEN}"`);
    expect(document.body.textContent).toContain(`claude mcp add --transport http sideform http://127.0.0.1:47821/mcp --header "Authorization: Bearer ${TOKEN}"`);
    expect(document.body.textContent).toContain("including saved logins");
  });

  it("copies the real snippet even while the token is hidden", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setMcp({ get: vi.fn().mockResolvedValue(view()), set: vi.fn(), regenerateToken: vi.fn() });
    render(<McpSection />);
    await waitFor(() => expect(screen.getByTestId("mcp-url")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Copy Claude Code snippet" }));
    expect(writeText).toHaveBeenCalledWith(
      `claude mcp add --transport http sideform http://127.0.0.1:47821/mcp --header "Authorization: Bearer ${TOKEN}"`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy Hermes Agent (~/.hermes/config.yaml) snippet" }));
    expect(writeText).toHaveBeenLastCalledWith(
      `mcp_servers:\n  sideform:\n    url: "http://127.0.0.1:47821/mcp"\n    headers:\n      Authorization: "Bearer ${TOKEN}"`,
    );
  });

  it("toggles through set and shows an error status text", async () => {
    const set = vi.fn().mockResolvedValue(view({ enabled: false, status: { state: "off" } }));
    setMcp({ get: vi.fn().mockResolvedValue(view({ status: { state: "error", error: "Port 47821 is busy" } })), set, regenerateToken: vi.fn() });
    render(<McpSection />);
    await waitFor(() => expect(screen.getByTestId("mcp-status").textContent).toBe("Could not start: Port 47821 is busy"));
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(screen.getByRole("switch"));
    expect(set).toHaveBeenCalledWith({ enabled: false });
    await waitFor(() => expect(screen.getByTestId("mcp-status").textContent).toBe("Off"));
  });

  it("regenerates the token and shows an error reply", async () => {
    const regenerateToken = vi.fn().mockResolvedValueOnce(view({ token: "b".repeat(64) })).mockResolvedValueOnce({ error: "disk full" });
    setMcp({ get: vi.fn().mockResolvedValue(view()), set: vi.fn(), regenerateToken });
    render(<McpSection />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Regenerate token" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Regenerate token" }));
    await waitFor(() => expect(regenerateToken).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Show token" }));
    await waitFor(() => expect(screen.getByTestId("mcp-token").textContent).toBe("b".repeat(64)));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate token" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("disk full"));
  });

  it("shows an { error } reply of get instead of crashing", async () => {
    setMcp({ get: vi.fn().mockResolvedValue({ error: "bridge down" }), set: vi.fn(), regenerateToken: vi.fn() });
    render(<McpSection />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("bridge down"));
    expect(screen.getByTestId("mcp-status").textContent).toBe("Unknown");
  });

  it("shows an { error } reply of set and keeps the page", async () => {
    const set = vi.fn().mockResolvedValue({ error: "cannot save" });
    setMcp({ get: vi.fn().mockResolvedValue(view()), set, regenerateToken: vi.fn() });
    render(<McpSection />);
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("cannot save"));
    expect(screen.getByTestId("mcp-status").textContent).toBe("Listening on http://127.0.0.1:47821/mcp");
  });
});

describe("McpSection status refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-reads the status every 2 s while visible, not while hidden, and stops on unmount", async () => {
    vi.useFakeTimers();
    const get = vi
      .fn()
      .mockResolvedValueOnce(view({ status: { state: "starting" } }))
      .mockResolvedValue(view({ status: { state: "error", error: "Port 47821 is busy" } }));
    setMcp({ get, set: vi.fn(), regenerateToken: vi.fn() });
    const { unmount } = render(<McpSection />);
    await act(async () => {});
    expect(screen.getByTestId("mcp-status").textContent).toBe("Starting…");
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("mcp-status").textContent).toBe("Could not start: Port 47821 is busy");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite the result of an in-flight toggle with a stale poll", async () => {
    vi.useFakeTimers();
    let finishSet!: (v: McpSettingsView) => void;
    const set = vi.fn(() => new Promise<McpSettingsView>((r) => (finishSet = r)));
    const get = vi.fn().mockResolvedValue(view());
    setMcp({ get, set, regenerateToken: vi.fn() });
    render(<McpSection />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("switch"));
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishSet(view({ enabled: false, status: { state: "off" } }));
    });
    expect(screen.getByTestId("mcp-status").textContent).toBe("Off");
  });

  it("a poll does not wipe an action error", async () => {
    vi.useFakeTimers();
    const set = vi.fn().mockResolvedValue({ error: "cannot save" });
    const get = vi.fn().mockResolvedValue(view());
    setMcp({ get, set, regenerateToken: vi.fn() });
    render(<McpSection />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("switch"));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toBe("cannot save");
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toBe("cannot save");
  });

  it("polls every 2 s only while starting, otherwise every 15 s", async () => {
    vi.useFakeTimers();
    const get = vi
      .fn()
      .mockResolvedValueOnce(view({ status: { state: "starting" } }))
      .mockResolvedValue(view());
    setMcp({ get, set: vi.fn(), regenerateToken: vi.fn() });
    render(<McpSection />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(get).toHaveBeenCalledTimes(3);
  });
});
