import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/routes/AgentPage", () => ({ default: () => <p>agent page</p> }));
vi.mock("@/routes/TracePage", () => ({ default: () => <p>trace page</p> }));
vi.mock("@/routes/SettingsPage", () => ({ default: () => <p>settings page</p> }));

import { AppRouter } from "@/AppRouter";

afterEach(() => cleanup());

const at = async (path: string) => {
  window.history.replaceState(null, "", path);
  render(<AppRouter />);
};

describe("AppRouter", () => {
  it.each([
    ["/agent", "agent page"],
    ["/trace/abc?src=local", "trace page"],
    ["/settings?section=browser", "settings page"],
  ])("serves %s", async (path, text) => {
    await at(path);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it.each(["/", "/app", "/doc", "/workflow", "/sign-in", "/trace", "/c/abc", "/anything/else"])("redirects %s to /agent", async (path) => {
    await at(path);
    expect(await screen.findByText("agent page")).toBeTruthy();
    expect(window.location.pathname).toBe("/agent");
  });
});
