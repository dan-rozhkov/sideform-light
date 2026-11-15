import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addByokModel, clearByokConfig, setByokConnection } from "@/lib/byokProvider";
import * as chatModels from "@/lib/chatModels";
import { getDefaultModel } from "@/lib/chatModels";
import { useChatStore } from "../chatStore";

// reconcileModels only runs once the model list has settled; most cases here are about the post-load state.
beforeEach(() => {
  vi.spyOn(chatModels, "areModelsLoaded").mockReturnValue(true);
});

afterEach(() => {
  clearByokConfig();
  vi.restoreAllMocks();
});

describe("chatStore with an own-provider model", () => {
  it("resets a selected byok model to the default when the provider is removed", () => {
    setByokConnection("https://api.example.com/v1", "k");
    addByokModel({ id: "m" });
    useChatStore.getState().setModel("byok/m");
    expect(useChatStore.getState().model).toBe("byok/m");
    clearByokConfig();
    expect(useChatStore.getState().model).toBe(getDefaultModel());
    expect(useChatStore.getState().chats.every((c) => c.model === getDefaultModel())).toBe(true);
  });

  it("resets it when the key is gone but the model stays listed", () => {
    setByokConnection("https://api.example.com/v1", "k");
    addByokModel({ id: "m" });
    useChatStore.getState().setModel("byok/m");
    setByokConnection("https://api.example.com/v1", "");
    expect(useChatStore.getState().model).toBe(getDefaultModel());
  });

  it("does not reset a hosted selection on a BYOK change before the model list has loaded", () => {
    vi.spyOn(chatModels, "areModelsLoaded").mockReturnValue(false);
    // A hosted id missing from the fallback list would be reset by a reconcile against it.
    useChatStore.getState().setModel("hosted/not-in-fallback");
    setByokConnection("https://api.example.com/v1", "k");
    addByokModel({ id: "m" });
    expect(useChatStore.getState().model).toBe("hosted/not-in-fallback");
  });
});
