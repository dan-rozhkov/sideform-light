import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import SettingsPage from "../SettingsPage";
import { UI_THEME_STORAGE_KEY } from "@/lib/uiTheme";
import { useUIThemeStore } from "@/store/uiThemeStore";

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

function renderSettings(url = "/settings") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/settings"
          element={
            <>
              <SettingsPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useUIThemeStore.setState({ uiTheme: "light" });
});
afterEach(() => {
  cleanup();
});

describe("<SettingsPage />", () => {
  it("renders the appearance section by default and sets the document title", () => {
    renderSettings();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Appearance" }).getAttribute("aria-current")).toBe("page");
    expect(document.title).toBe("Settings");
  });

  it("has exactly two sections: appearance and browser", () => {
    renderSettings();
    const names = within(screen.getByRole("navigation", { name: "Settings sections" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Appearance", "Browser"]);
  });

  it("opens the section named by ?section= and falls back to appearance for an unknown one", () => {
    renderSettings("/settings?section=browser");
    expect(screen.getByRole("heading", { level: 2, name: "Browser" })).toBeTruthy();
    cleanup();
    renderSettings("/settings?section=canvas");
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
  });

  it("switches section from the nav and keeps ?section= in step", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Browser" }));
    expect(screen.getByRole("heading", { level: 2, name: "Browser" })).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/settings?section=browser");
  });

  it("follows a section request from the shell", () => {
    let push: ((id: string) => void) | undefined;
    window.penDesktop = { settings: { onSection: (cb) => ((push = cb), () => {}) } };
    renderSettings();
    push?.("browser");
    return waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Browser" })).toBeTruthy());
  });

  it("changes the theme and stores the user's choice", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(useUIThemeStore.getState().uiTheme).toBe("dark");
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe("dark");
  });

  it("toggles ad blocking through window.penDesktop.browserSettings", async () => {
    const get = vi.fn().mockResolvedValue({ adBlock: false });
    const set = vi.fn().mockResolvedValue({ adBlock: true });
    window.penDesktop = { browserSettings: { get, set } };
    renderSettings("/settings?section=browser");
    const toggle = await screen.findByRole("switch", { name: "Block ads and trackers" });
    await waitFor(() => expect(toggle.getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith({ adBlock: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Block ads and trackers" }).getAttribute("aria-checked")).toBe("true"));
  });
});
