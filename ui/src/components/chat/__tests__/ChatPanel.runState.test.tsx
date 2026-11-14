import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { UIMessage } from "ai";

import { ChatPanelContent } from "../ChatPanel";
import { useChatStore, type ChatSummary } from "@/store/chatStore";

const ASK: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "go" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_user",
        toolCallId: "q1",
        state: "input-available",
        input: { questions: [{ id: "k", label: "K", type: "text" }] },
      },
    ],
  } as UIMessage,
];
const DONE: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "go" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
];

vi.mock("@/lib/chats/desktopChatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chats/desktopChatPersistence")>();
  return { ...actual, takeInitialMessages: (id: string) => (id === "ask" ? ASK : id === "done" ? DONE : undefined) };
});

const summary = (id: string): ChatSummary => ({
  id,
  title: id,
  model: "deepseek/deepseek-v4.1-flash",
  parallelCount: 1,
  titleIsAuto: false,
  unread: false,
  needsAnswer: false,
  isBusy: false,
  updatedAt: 1000,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatPanel run state for the MCP bridge", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    useChatStore.setState({
      chats: [summary("fresh"), summary("ask"), summary("done")],
      activeChatId: "fresh",
      abortControllers: {},
      launchQueue: {},
      sessionActions: {},
    });
  });

  it("a restored chat has not run since mount and is idle", async () => {
    await act(async () => {
      render(<ChatPanelContent />);
    });
    expect(useChatStore.getState().sessionActions.done.getRunState()).toMatchObject({ busy: false, ranSinceMount: false });
  });

  it("reads busy right after answerAskUser, before any render", async () => {
    await act(async () => {
      render(<ChatPanelContent />);
    });
    const actions = useChatStore.getState().sessionActions.ask;
    expect(actions.getRunState().busy).toBe(false);
    let result: unknown;
    act(() => {
      result = actions.answerAskUser([{ id: "k", value: "v" }]);
    });
    expect(result).toEqual({ ok: true });
    expect(actions.getRunState()).toMatchObject({ busy: true, ranSinceMount: true });
  });

  it("reads busy right after sendText", async () => {
    await act(async () => {
      render(<ChatPanelContent />);
    });
    const actions = useChatStore.getState().sessionActions.done;
    let result: unknown;
    act(() => {
      result = actions.sendText("more");
    });
    expect(result).toEqual({ ok: true });
    expect(actions.getRunState()).toMatchObject({ busy: true, ranSinceMount: true });
  });
});
