import { describe, expect, it } from "vitest";
import { resolveWindowTheme } from "../src/main/windowTheme";

describe("resolveWindowTheme", () => {
  it("uses the fallback before the panel reported", () => {
    expect(resolveWindowTheme(null, "light")).toBe("light");
  });

  it("the panel's theme always wins over the fallback", () => {
    expect(resolveWindowTheme("dark", "light")).toBe("dark");
    expect(resolveWindowTheme("light", "dark")).toBe("light");
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { contentBackground, FALLBACK_THEME, glassTint, isPanelDocument, ISLAND_BG, GLASS_ALPHA_DIFFERENT, GLASS_ALPHA_SAME } from "../src/main/windowTheme";

describe("window colours", () => {
  it("content background = the island colour (ui panel surface)", () => {
    expect(contentBackground("dark")).toBe("#2a2a2a");
    expect(contentBackground("light")).toBe("#ffffff");
  });
  it("falls back to light regardless of the OS", () => {
    expect(FALLBACK_THEME).toBe("light");
  });
  it("tokens.css --island-bg equals the TS constants", () => {
    const css = readFileSync(path.join(__dirname, "../src/tabbar/tokens.css"), "utf8");
    expect(css).toContain(`--island-bg: light-dark(${ISLAND_BG.light}, ${ISLAND_BG.dark});`);
  });
  it("passwords.css (no tokens.css) copies the light --icon of tokens.css", () => {
    const tokens = readFileSync(path.join(__dirname, "../src/tabbar/tokens.css"), "utf8");
    const passwords = readFileSync(path.join(__dirname, "../src/passwords/passwords.css"), "utf8");
    const light = /--icon: light-dark\(([^,]+),/.exec(tokens)?.[1];
    expect(light).toBeTruthy();
    expect(passwords).toContain(`--icon: ${light};`);
  });
});

describe("isPanelDocument", () => {
  const panel = "app://sideform/agent";
  it("accepts the panel page and subpaths, rejects others", () => {
    expect(isPanelDocument("app://sideform/agent", panel)).toBe(true);
    expect(isPanelDocument("app://sideform/agent/chat/1?q=1", panel)).toBe(true);
    expect(isPanelDocument("app://sideform/settings", panel)).toBe(false);
    expect(isPanelDocument("app://sideform/agentx", panel)).toBe(false);
    expect(isPanelDocument("app://evil/agent", panel)).toBe(false);
    expect(isPanelDocument("https://sideform/agent", panel)).toBe(false);
    expect(isPanelDocument("file:///app/index.html", panel)).toBe(false);
    expect(isPanelDocument("not a url", panel)).toBe(false);
  });
  it("works against a dev server origin", () => {
    expect(isPanelDocument("http://localhost:5174/agent/x", "http://localhost:5174/agent")).toBe(true);
    expect(isPanelDocument("http://localhost:5175/agent", "http://localhost:5174/agent")).toBe(false);
  });
});

describe("glassTint", () => {
  it("is light-handed when the theme matches the OS, stronger when it differs", () => {
    expect(glassTint("light", false).alpha).toBe(GLASS_ALPHA_SAME);
    expect(glassTint("dark", true).alpha).toBe(GLASS_ALPHA_SAME);
    expect(glassTint("light", true).alpha).toBe(GLASS_ALPHA_DIFFERENT);
    expect(glassTint("dark", false).alpha).toBe(GLASS_ALPHA_DIFFERENT);
  });
  it("uses the theme's colour", () => {
    expect(glassTint("light", true).color).toMatch(/^rgba\(244, 245, 248, /);
    expect(glassTint("dark", false).color).toMatch(/^rgba\(28, 28, 30, /);
  });
});
