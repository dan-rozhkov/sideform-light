import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiFetchUrl, resolveApiUrl } from "../apiBase";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveApiUrl", () => {
  it("defaults to the SAME ORIGIN (a relative /api/... URL) when no env var is set", () => {
    vi.stubEnv("VITE_AI_API_URL", "");
    vi.stubEnv("VITE_DESIGN_AGENT_BACKEND_URL", "");
    expect(resolveApiUrl("/api/chat")).toBe("/api/chat");
    expect(resolveApiUrl("/api/models")).toBe("/api/models");
  });

  it("uses VITE_DESIGN_AGENT_BACKEND_URL without a trailing slash", () => {
    vi.stubEnv("VITE_AI_API_URL", "");
    vi.stubEnv("VITE_DESIGN_AGENT_BACKEND_URL", "https://agent.test/");
    expect(resolveApiUrl("/api/models")).toBe("https://agent.test/api/models");
  });

  it("derives the base from VITE_AI_API_URL by stripping /api/chat, and prefers it", () => {
    vi.stubEnv("VITE_AI_API_URL", "https://chat.test/api/chat");
    vi.stubEnv("VITE_DESIGN_AGENT_BACKEND_URL", "https://other.test");
    expect(resolveApiUrl("/api/browse/step")).toBe("https://chat.test/api/browse/step");
  });
});

describe("apiFetch", () => {
  it("always sends credentials: omit", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/models");
    await apiFetchUrl("http://x.test/y", { credentials: "include", method: "POST" });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][1].credentials).toBe("omit");
    expect(calls[1][1]).toMatchObject({ credentials: "omit", method: "POST" });
  });
});
