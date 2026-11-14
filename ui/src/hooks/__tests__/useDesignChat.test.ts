import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { textTurn } from "@/test/sseStream";
import { buildChatBody, executeToolCall, useDesignChat, extractContextTokens, getToolCallTimeoutMs, hasUnresolvedToolCalls } from "../useDesignChat";
import { CLIENT_CAPABILITIES } from "@/lib/chatTransport";
import { toolHandlers } from "@/lib/toolRegistry";
import { useChatStore } from "@/store/chatStore";
import { getUserId } from "@/lib/userId";
import type { UIMessage } from "ai";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("buildChatBody (main chat request body)", () => {
  it('sends agentMode "browser", the model, the anonymous user id and the client capabilities', () => {
    const body = buildChatBody() as Record<string, unknown>;
    expect(body.agentMode).toBe("browser");
    expect(body.model).toBe(useChatStore.getState().model);
    expect(body.userId).toBe(getUserId());
    expect(body.clientCapabilities).toBe(CLIENT_CAPABILITIES);
  });

  it("sends no canvas context, liked references or other scene data", () => {
    const body = buildChatBody() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["agentMode", "clientCapabilities", "model", "userId"]);
  });

  it("uses the model of the session's own chat, not the active one", () => {
    useChatStore.setState({
      model: "active/model",
      chats: [{ id: "bg", title: "t", model: "background/model", parallelCount: 1, createdAt: 0, updatedAt: 0, unread: false, needsAnswer: false, isBusy: false } as never],
    });
    expect((buildChatBody("bg") as { model: string }).model).toBe("background/model");
  });
});

describe("tool timeouts", () => {
  it("gives the long browse tools their own budget and everything else the default", () => {
    expect(getToolCallTimeoutMs("browse_open")).toBe(70_000);
    expect(getToolCallTimeoutMs("browse_act")).toBe(120_000);
    expect(getToolCallTimeoutMs("browse_agent")).toBeGreaterThan(getToolCallTimeoutMs("browse_act"));
    expect(getToolCallTimeoutMs("trace_read")).toBe(30_000);
  });
});

describe("executeToolCall", () => {
  it("runs a registered handler and returns its string result", async () => {
    const original = toolHandlers.trace_list;
    toolHandlers.trace_list = vi.fn(async () => '{"tabs":[]}');
    try {
      expect(await executeToolCall("trace_list", {})).toBe('{"tabs":[]}');
    } finally {
      toolHandlers.trace_list = original;
    }
  });

  it("answers an unknown tool with an error JSON instead of throwing", async () => {
    const out = JSON.parse(await executeToolCall("batch_design", {}));
    expect(out.error).toBeDefined();
  });

  it("answers a cancelled call without running the handler", async () => {
    const handler = vi.fn(async () => "{}");
    const original = toolHandlers.trace_list;
    toolHandlers.trace_list = handler;
    try {
      const controller = new AbortController();
      controller.abort();
      expect(JSON.parse(await executeToolCall("trace_list", {}, { signal: controller.signal }))).toEqual({ error: "Tool call cancelled" });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      toolHandlers.trace_list = original;
    }
  });
});

describe("helpers", () => {
  it("extractContextTokens reads a positive count only", () => {
    expect(extractContextTokens({ contextTokens: 1200 })).toBe(1200);
    expect(extractContextTokens({ contextTokens: 0 })).toBeUndefined();
    expect(extractContextTokens(null)).toBeUndefined();
  });

  it("hasUnresolvedToolCalls flags a tool part waiting for its output", () => {
    const part = (state: string) => ({ id: "a", role: "assistant", parts: [{ type: "tool-browse_open", toolCallId: "1", state }] }) as unknown as UIMessage;
    expect(hasUnresolvedToolCalls([part("input-available")])).toBe(true);
    expect(hasUnresolvedToolCalls([part("output-available")])).toBe(false);
  });
});

describe("the request the main chat sends", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to the local backend with credentials omitted, agentMode browser and no canvasContext", async () => {
    const fetchMock = vi.fn(async () => textTurn("hello"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDesignChat({ sessionId: "body-session" }));
    act(() => result.current.setInput("open example.com"));
    await act(async () => {
      result.current.sendMessage();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/api/chat");
    expect(init.credentials).toBe("omit");
    const body = JSON.parse(String(init.body));
    expect(body.agentMode).toBe("browser");
    expect(body.userId).toBe(getUserId());
    expect(body.clientCapabilities).toMatchObject({ browser: "desktop", browseQa: true });
    expect(body).not.toHaveProperty("canvasContext");
    expect(body.messages.at(-1).parts[0].text).toBe("open example.com");
  });
});
