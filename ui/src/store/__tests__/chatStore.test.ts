import { describe, it, expect, beforeEach } from "vitest"; 
import { reconcileModels, useChatStore, type ChatSummary } from "@/store/chatStore";
import { getDefaultModel, getModelOptions } from "@/lib/chatModels";
import { resetBrowseCheckpoints, useBrowseCheckpointStore } from "@/store/browseCheckpointStore";

function makeChat(overrides: Partial<ChatSummary> & { id: string }): ChatSummary {
  return {
    title: "Chat",
    model: "deepseek/deepseek-v4.1-flash",
    parallelCount: 1,
    titleIsAuto: true,
    unread: false,
    needsAnswer: false,
    isBusy: false,
    updatedAt: 0,
    ...overrides,
  };
}

describe("chatStore — chat lifecycle", () => {
  beforeEach(() => {
    useChatStore.setState({
      launchQueue: {},
      attachedImages: {},
    });
  });

  describe("closeChat cleanup", () => {
    it("drops the chat's browser checkpoints", () => {
      useChatStore.setState({
        chats: [makeChat({ id: "tab-A" }), makeChat({ id: "tab-B" })],
        activeChatId: "tab-A",
      });
      const cp = { fixture: { version: 1, url: "https://a.test" } as never, complete: true, summary: "s" };
      useBrowseCheckpointStore.getState().add("tab-A", cp);
      useBrowseCheckpointStore.getState().add("tab-B", cp);

      useChatStore.getState().closeChat("tab-A");

      expect(useBrowseCheckpointStore.getState().byChat["tab-A"]).toBeUndefined();
      expect(useBrowseCheckpointStore.getState().byChat["tab-B"]).toHaveLength(1);
      resetBrowseCheckpoints();
    });

    it("clears the launch payload when closing one of several chats", () => {
      useChatStore.setState({
        chats: [makeChat({ id: "tab-A" }), makeChat({ id: "tab-B" })],
        activeChatId: "tab-A",
      });
      useChatStore.getState().queueLaunchPayload("tab-A", { text: "queued" });

      useChatStore.getState().closeChat("tab-A");

      expect(useChatStore.getState().launchQueue["tab-A"]).toBeUndefined();
    });

    it("clears the launch payload when closing the last remaining chat", () => {
      useChatStore.setState({
        chats: [makeChat({ id: "tab-only" })],
        activeChatId: "tab-only",
      });
      useChatStore.getState().queueLaunchPayload("tab-only", { text: "queued" });

      useChatStore.getState().closeChat("tab-only");

      expect(useChatStore.getState().launchQueue["tab-only"]).toBeUndefined();
      // A fresh replacement chat was created with no leftover payload.
      const newChatId = useChatStore.getState().activeChatId!;
      expect(useChatStore.getState().launchQueue[newChatId]).toBeUndefined();
    });

    it("clears contextTokens when closing one of several chats", () => {
      useChatStore.setState({
        chats: [makeChat({ id: "tab-A" }), makeChat({ id: "tab-B" })],
        activeChatId: "tab-A",
      });
      useChatStore.getState().setContextTokens("tab-A", 12345);

      useChatStore.getState().closeChat("tab-A");

      expect(useChatStore.getState().contextTokens["tab-A"]).toBeUndefined();
    });

    it("clears contextTokens when closing the last remaining chat", () => {
      useChatStore.setState({
        chats: [makeChat({ id: "tab-only" })],
        activeChatId: "tab-only",
      });
      useChatStore.getState().setContextTokens("tab-only", 12345);

      useChatStore.getState().closeChat("tab-only");

      expect(useChatStore.getState().contextTokens["tab-only"]).toBeUndefined();
      const newChatId = useChatStore.getState().activeChatId!;
      expect(useChatStore.getState().contextTokens[newChatId]).toBeUndefined();
    });
  });
});

describe("chatStore — contextTokens", () => {
  beforeEach(() => {
    useChatStore.setState({ contextTokens: {} });
  });

  it("setContextTokens writes per chat, not globally", () => {
    const { setContextTokens } = useChatStore.getState();
    setContextTokens("tab-A", 1000);
    setContextTokens("tab-B", 2000);

    expect(useChatStore.getState().contextTokens).toEqual({
      "tab-A": 1000,
      "tab-B": 2000,
    });
  });

  it("setContextTokens overwrites a chat's previous reading", () => {
    const { setContextTokens } = useChatStore.getState();
    setContextTokens("tab-A", 1000);
    setContextTokens("tab-A", 5000);

    expect(useChatStore.getState().contextTokens["tab-A"]).toBe(5000);
  });

  it("clearContextTokens drops only the targeted chat", () => {
    const { setContextTokens, clearContextTokens } = useChatStore.getState();
    setContextTokens("tab-A", 1000);
    setContextTokens("tab-B", 2000);

    clearContextTokens("tab-A");

    expect(useChatStore.getState().contextTokens).toEqual({ "tab-B": 2000 });
  });
});

describe("chatStore — chat list state", () => {
  beforeEach(() => {
    useChatStore.setState({
      chats: [
        makeChat({ id: "tab-A", title: "A" }),
        makeChat({ id: "tab-B", title: "B" }),
      ],
      activeChatId: "tab-A",
      launchQueue: {},
      abortControllers: {},
      attachedImages: {},
      sessionActions: {},
    });
  });

  it("openChat resets unread for the opened chat", () => {
    useChatStore.setState((s) => ({
      chats: s.chats.map((c) => (c.id === "tab-B" ? { ...c, unread: true } : c)),
    }));

    useChatStore.getState().openChat("tab-B");

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe("tab-B");
    expect(state.chats.find((c) => c.id === "tab-B")?.unread).toBe(false);
  });

  it("markChatUnread does not mark the active chat", () => {
    useChatStore.getState().markChatUnread("tab-A");
    expect(useChatStore.getState().chats.find((c) => c.id === "tab-A")?.unread).toBe(false);
  });

  it("markChatUnread marks a background chat", () => {
    useChatStore.getState().markChatUnread("tab-B");
    expect(useChatStore.getState().chats.find((c) => c.id === "tab-B")?.unread).toBe(true);
  });

  it("closeChat on the open chat returns activeChatId to null", () => {
    useChatStore.getState().closeChat("tab-A");
    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(useChatStore.getState().chats.map((c) => c.id)).toEqual(["tab-B"]);
  });

  it("closing the last chat replaces it with a new active empty chat", () => {
    useChatStore.setState({ chats: [makeChat({ id: "tab-only" })], activeChatId: "tab-only" });

    useChatStore.getState().closeChat("tab-only");

    const state = useChatStore.getState();
    expect(state.chats).toHaveLength(1);
    expect(state.activeChatId).toBe(state.chats[0].id);
    expect(state.activeChatId).not.toBe("tab-only");
  });

  // Regression: this branch used to unconditionally set activeChatId to the
  // new replacement chat, even when the user had been on the chat list
  // (activeChatId === null) and deleted the sole chat from there — jumping
  // them into a new empty chat instead of leaving the list showing.
  it("closing the last chat from the list view (no chat open) leaves activeChatId null", () => {
    useChatStore.setState({ chats: [makeChat({ id: "tab-only" })], activeChatId: null });

    useChatStore.getState().closeChat("tab-only");

    const state = useChatStore.getState();
    expect(state.chats).toHaveLength(1);
    expect(state.chats[0].id).not.toBe("tab-only");
    expect(state.activeChatId).toBeNull();
  });

  it("applyAutoTitle sets the title once and ignores a second call", () => {
    useChatStore.getState().applyAutoTitle("tab-A", "make a login screen please");

    let chat = useChatStore.getState().chats.find((c) => c.id === "tab-A");
    expect(chat?.title).toBe("make a login screen please");
    expect(chat?.titleIsAuto).toBe(false);

    useChatStore.getState().applyAutoTitle("tab-A", "a completely different message");

    chat = useChatStore.getState().chats.find((c) => c.id === "tab-A");
    expect(chat?.title).toBe("make a login screen please");
  });

  it("setChatTitle clears titleIsAuto", () => {
    useChatStore.getState().setChatTitle("tab-A", "Renamed");

    const chat = useChatStore.getState().chats.find((c) => c.id === "tab-A");
    expect(chat?.title).toBe("Renamed");
    expect(chat?.titleIsAuto).toBe(false);

    // A later auto-title attempt is now a no-op.
    useChatStore.getState().applyAutoTitle("tab-A", "some user message");
    expect(useChatStore.getState().chats.find((c) => c.id === "tab-A")?.title).toBe("Renamed");
  });

  it("setChatActivity does not change the state reference for an identical patch", () => {
    useChatStore.getState().setChatActivity("tab-A", { isBusy: true });
    const afterFirst = useChatStore.getState();

    useChatStore.getState().setChatActivity("tab-A", { isBusy: true });
    const afterSecond = useChatStore.getState();

    expect(afterSecond).toBe(afterFirst);
  });

  it("createChat defaults to activating the new chat with localStorage's parallelCount", () => {
    localStorage.setItem("chat-parallel-count", "2");

    const newId = useChatStore.getState().createChat();

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe(newId);
    expect(state.parallelCount).toBe(2);
    expect(state.chats.find((c) => c.id === newId)?.parallelCount).toBe(2);

    localStorage.removeItem("chat-parallel-count");
  });

  it("createChat({ activate: false, parallelCount: 1 }) adds the chat without touching activeChatId", () => {
    useChatStore.setState({ parallelCount: 3 });

    const newId = useChatStore.getState().createChat({ activate: false, parallelCount: 1 });

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe("tab-A");
    expect(state.parallelCount).toBe(3); // untouched — still the pre-call global value
    expect(state.chats.find((c) => c.id === newId)?.parallelCount).toBe(1);
  });

  it("createChat numbers titles with the smallest free N, even next to restored 'Chat N' titles", () => {
    const base = useChatStore.getState().chats[0];
    useChatStore.setState({
      chats: [
        { ...base, id: "r1", title: "Chat 2" },
        { ...base, id: "r2", title: "Chat 3" },
        { ...base, id: "r3", title: "My chat 1" },
      ],
    });
    const a = useChatStore.getState().createChat({ activate: false });
    expect(useChatStore.getState().chats.find((c) => c.id === a)?.title).toBe("Chat 1");
    const b = useChatStore.getState().createChat({ activate: false });
    expect(useChatStore.getState().chats.find((c) => c.id === b)?.title).toBe("Chat 4");
  });

  it("setChatActivity merges flags that did change", () => {
    useChatStore.getState().setChatActivity("tab-A", { isBusy: true });
    useChatStore.getState().setChatActivity("tab-A", { needsAnswer: true });

    const chat = useChatStore.getState().chats.find((c) => c.id === "tab-A");
    expect(chat?.isBusy).toBe(true);
    expect(chat?.needsAnswer).toBe(true);
  });
});

describe("chatStore — model selection", () => {
  beforeEach(() => {
    localStorage.removeItem("chat-model");
    useChatStore.setState({
      chats: [
        makeChat({ id: "tab-A", title: "A" }),
        makeChat({ id: "tab-B", title: "B" }),
      ],
      activeChatId: "tab-A",
      model: "deepseek/deepseek-v4.1-flash",
    });
  });

  it("setModel writes the active chat's model, not every chat's", () => {
    useChatStore.getState().setModel("qwen/qwen3.8-flash");

    const state = useChatStore.getState();
    expect(state.model).toBe("qwen/qwen3.8-flash");
    expect(state.chats.find((c) => c.id === "tab-A")?.model).toBe("qwen/qwen3.8-flash");
    // A background chat keeps its own model — it may be mid-stream, and its
    // auto-continuations must not switch models under it.
    expect(state.chats.find((c) => c.id === "tab-B")?.model).toBe(
      "deepseek/deepseek-v4.1-flash",
    );
    expect(localStorage.getItem("chat-model")).toBe("qwen/qwen3.8-flash");
  });

  it("openChat restores that chat's model as the active one", () => {
    useChatStore.setState((s) => ({
      chats: s.chats.map((c) =>
        c.id === "tab-B" ? { ...c, model: "z-ai/glm-5.3-flash" } : c,
      ),
    }));

    useChatStore.getState().openChat("tab-B");

    expect(useChatStore.getState().model).toBe("z-ai/glm-5.3-flash");
  });

  it("reconcileModels resets a selection the backend does not offer", () => {
    useChatStore.setState((s) => ({
      model: "gone/retired-model",
      chats: s.chats.map((c) =>
        c.id === "tab-B" ? { ...c, model: "gone/retired-model" } : c,
      ),
    }));

    reconcileModels();

    const state = useChatStore.getState();
    expect(state.model).toBe(getDefaultModel());
    expect(state.chats.every((c) => c.model === getDefaultModel() ||
      getModelOptions().some((o) => o.value === c.model))).toBe(true);
  });

  it("reconcileModels leaves a valid selection alone", () => {
    const valid = getModelOptions()[0].value;
    useChatStore.setState((s) => ({
      model: valid,
      chats: s.chats.map((c) => ({ ...c, model: valid })),
    }));

    reconcileModels();

    expect(useChatStore.getState().model).toBe(valid);
  });
});

