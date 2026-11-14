import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canSendImages,
  canUseModel,
  getDefaultModel,
  getModelContextWindow,
  getModelOptions,
  modelSupportsVision,
} from "@/lib/chatModels";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("chatModels fallback", () => {
  it("offers the shipped models before any /api/models response, with no own-key models", () => {
    expect(getModelOptions().map((option) => option.value)).toEqual([
      "meta/muse-spark-1.3-contributor",
      "qwen/qwen3.8-flash",
      "z-ai/glm-5.3-flash",
      "deepseek/deepseek-v4.1-flash",
      "google/gemini-3.8-flash",
      "tencent/hy4-preview",
      "z-ai/glm-5.3",
      "openai/gpt-6-luna",
      "z-ai/glm-5.2",
      "minimax/minimax-m3",
      "xiaomi/mimo-v2.6-pro",
      "xiaomi/mimo-v2.6-flash",
    ]);
    expect(getDefaultModel()).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("reports native vision per model, and assumes an unknown id can see", () => {
    expect(modelSupportsVision("deepseek/deepseek-v4.1-flash")).toBe(true);
    expect(modelSupportsVision("tencent/hy4-preview")).toBe(false);
    expect(modelSupportsVision("not/listed")).toBe(true);
  });

  it("allows images for a vision-less model only through the backend's vision fallback", () => {
    expect(canSendImages("deepseek/deepseek-v4.1-flash")).toBe(true);
    expect(canSendImages("tencent/hy4-preview")).toBe(false);
  });

  it("canUseModel accepts listed ids only", () => {
    expect(canUseModel("z-ai/glm-5.3")).toBe(true);
    expect(canUseModel("opencode-go/glm-5.3")).toBe(false);
    expect(canUseModel("unknown")).toBe(false);
  });

  it("knows a context window for a listed model", () => {
    expect(getModelContextWindow("deepseek/deepseek-v4.1-flash")).toBe(1048576);
    expect(getModelContextWindow("unknown")).toBeUndefined();
  });
});

describe("loadModels", () => {
  const stubModels = (body: unknown, ok = true) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));

  it("fetches /api/models from the local backend without cookies", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ models: [], default: "" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/api/models");
    expect(init.credentials).toBe("omit");
  });

  it("takes the backend list and default, and drops models that need the user's own key", async () => {
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
    expect(fresh.getDefaultModel()).toBe("a/one");
    expect(fresh.getModelContextWindow("a/one")).toBe(1000);
    // visionFallback: a model without native vision still accepts images.
    expect(fresh.canSendImages("b/three")).toBe(true);
    expect(fresh.areModelsLoaded()).toBe(true);
  });

  it("keeps the fallback list when the request fails", async () => {
    vi.resetModules();
    stubModels({}, false);
    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();
    expect(fresh.getModelOptions()).toHaveLength(12);
    expect(fresh.areModelsLoaded()).toBe(true);
  });
});
