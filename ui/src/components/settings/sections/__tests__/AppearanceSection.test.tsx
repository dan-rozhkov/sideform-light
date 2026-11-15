import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useLanguageStore } from "@/i18n";

import { AppearanceSection } from "../AppearanceSection";

afterEach(() => {
  cleanup();
  useLanguageStore.setState({ language: "en" });
  localStorage.clear();
});

describe("AppearanceSection language picker", () => {
  it("lists every language by its own name and shows the current one", () => {
    render(<AppearanceSection />);
    expect(screen.getByRole("combobox", { name: "Language" }).textContent).toContain("English");
  });

  it("picking Russian switches the visible texts and stores the choice", async () => {
    render(<AppearanceSection />);
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Language" }));
    const option = await screen.findByRole("option", { name: "Русский" });
    // base-ui selects on the pointer-up of a press, so a bare click does not choose.
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);

    expect(await screen.findByRole("heading", { name: "Оформление" })).toBeTruthy();
    expect(screen.getByText("Тема")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Язык" }).textContent).toContain("Русский");
    expect(localStorage.getItem("ui-language")).toBe("ru");
  });
});
