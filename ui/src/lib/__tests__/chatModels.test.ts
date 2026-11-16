import { afterEach, describe, expect, it, vi } from "vitest";
import { addByokModel, clearByokConfig, setByokConnection } from "@/lib/byokProvider";
import {
  canSendImages,
  canUseModel,
  getDefaultModel,
  getModelContextWindow,
  getModelOptions,
  hasUsableModel,
  modelSupportsVision,
} from "@/lib/chatModels";

afterEach(() => {
  clearByokConfig();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("chatModels without a provider", () => {
  it("offers no model and preselects none before any /api/models response", () => {
    expect(getModelOptions()).toEqual([]);
    expect(getDefaultModel()).toBe("");
    expect(hasUsableModel()).toBe(false);
  });

  it("canUseModel rejects the empty selection and unknown ids", () => {
    expect(canUseModel("")).toBe(false);
    expect(canUseModel("deepseek/deepseek-v4.1-flash")).toBe(false);
    expect(canUseModel("byok/not-added")).toBe(false);
  });

  it("assumes an unknown id can see, and has no context window or image fallback for it", () => {
    expect(modelSupportsVision("not/listed")).toBe(true);
    expect(getModelContextWindow("unknown")).toBeUndefined();
    expect(canSendImages("byok/m")).toBe(false);
  });

  it("defaults to the first own-provider model once a provider has models", () => {
    setByokConnection("https://api.example.com/v1", "k");
    addByokModel({ id: "first" });
    addByokModel({ id: "second" });
    expect(getDefaultModel()).toBe("byok/first");
    expect(hasUsableModel()).toBe(true);
  });

  it("has no usable model while the provider has a URL but no key, or no models", () => {
    setByokConnection("https://api.example.com/v1", "k");
    expect(hasUsableModel()).toBe(false);
    addByokModel({ id: "m" });
    setByokConnection("https://api.example.com/v1", "");
    expect(hasUsableModel()).toBe(false);
    expect(getDefaultModel()).toBe("");
  });
});

describe("loadModels", () => {
  const stubModels = (body: unknown, ok = true) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));

  it("fetches /api/models from the same origin without cookies", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ models: [], default: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/models");
    expect(init.credentials).toBe("omit");
  });

  it("parses the local backend answer (empty list, default null) into no models and no default", async () => {
    vi.resetModules();
    stubModels({ models: [], default: null, visionFallback: false, imageOps: { removeBackground: false, vectorize: false } });
    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();
    expect(fresh.getModelOptions()).toEqual([]);
    expect(fresh.getDefaultModel()).toBe("");
    expect(fresh.hasUsableModel()).toBe(false);
    expect(fresh.canSendImages("byok/m")).toBe(false);
    expect(fresh.areModelsLoaded()).toBe(true);
  });

  it("takes a server list when one is served and drops models that need the user's own key, ignoring its default", async () => {
    vi.resetModules();
    stubModels({
      models: [
        { id: "a/one", label: "One", supportsVision: true, contextWindow: 1000 },
        { id: "opencode/two", label: "Two", supportsVision: false, requiresUserKey: true },
        { id: "b/three", label: "Three", supportsVision: false },
      ],
      default: "a/one",
      visionFallback: true,
    });
    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();
    expect(fresh.getModelOptions().map((o) => o.value)).toEqual(["a/one", "b/three"]);
    // The server's own `default` is ignored: the default is the first usable option, same rule as hasUsableModel.
    expect(fresh.getDefaultModel()).toBe("a/one");
    expect(fresh.hasUsableModel()).toBe(true);
    expect(fresh.getModelContextWindow("a/one")).toBe(1000);
    expect(fresh.canSendImages("b/three")).toBe(true);
    expect(fresh.areModelsLoaded()).toBe(true);
  });

  it("prefers an own-provider model over a server-listed one, and both views agree", async () => {
    vi.resetModules();
    stubModels({ models: [{ id: "a/one", label: "One", supportsVision: true }] });
    const fresh = await import("@/lib/chatModels");
    const byok = await import("@/lib/byokProvider");
    await fresh.loadModels();
    expect(fresh.getDefaultModel()).toBe("a/one");
    byok.setByokConnection("https://api.example.com/v1", "k");
    byok.addByokModel({ id: "mine" });
    expect(fresh.getDefaultModel()).toBe("byok/mine");
    expect(fresh.hasUsableModel()).toBe(true);
    // A locked own-provider model is not usable, so the server model is the default and the notice stays hidden.
    byok.setByokConnection("https://api.example.com/v1", "");
    expect(fresh.canUseModel("byok/mine")).toBe(false);
    expect(fresh.getDefaultModel()).toBe("a/one");
    expect(fresh.hasUsableModel()).toBe(true);
    byok.clearByokConfig();
  });

  it("keeps the list empty when the request fails or answers garbage", async () => {
    vi.resetModules();
    stubModels({}, false);
    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();
    expect(fresh.getModelOptions()).toEqual([]);
    expect(fresh.areModelsLoaded()).toBe(true);

    vi.resetModules();
    stubModels(null);
    const fresh2 = await import("@/lib/chatModels");
    await fresh2.loadModels();
    expect(fresh2.getModelOptions()).toEqual([]);
  });
});
