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

  it.each(["mcp", "schedule"] as const)("a %s background chat does not report schedules; the rest is unchanged", (source) => {
    useChatStore.setState({
      chats: [{ id: "bgtask", title: "t", model: "m", parallelCount: 1, createdAt: 0, updatedAt: 0, unread: false, needsAnswer: false, isBusy: false, source } as never],
    });
    const caps = (buildChatBody("bgtask") as { clientCapabilities: Record<string, unknown> }).clientCapabilities;
    expect("schedules" in caps).toBe(false);
    const { schedules: _omit, ...rest } = CLIENT_CAPABILITIES as Record<string, unknown>;
    expect(caps).toEqual(rest);
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

describe("answering ask_user after a Stop", () => {
  afterEach(() => vi.unstubAllGlobals());

  const pending = (): UIMessage[] => [
    { id: "u", role: "user", parts: [{ type: "text", text: "go" }] },
    {
      id: "a",
      role: "assistant",
      parts: [{ type: "tool-ask_user", toolCallId: "q1", state: "input-available", input: { questions: [] } }],
    } as UIMessage,
  ];

  it("re-arms auto-continuation: the answer resumes the agent", async () => {
    const fetchMock = vi.fn(async () => textTurn("continuing"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDesignChat({ sessionId: "stopped-answer" }));
    act(() => result.current.setMessages(pending()));
    expect(result.current.isTurnStopped()).toBe(false);
    await act(async () => {
      result.current.stop();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.isTurnStopped()).toBe(true);
    await act(async () => {
      await result.current.addToolOutput({ tool: "ask_user", toolCallId: "q1", output: "answered" });
    });
    expect(result.current.isTurnStopped()).toBe(false);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("answering a pending schedule_create card after a stream error re-arms and continues", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockImplementation(async () => textTurn("continuing"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDesignChat({ sessionId: "error-schedule" }));
    await act(async () => {
      result.current.submitLaunchPayload({ text: "schedule it" });
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(result.current.isTurnStopped()).toBe(true));
    const calls = fetchMock.mock.calls.length;
    act(() =>
      result.current.setMessages([
        { id: "u", role: "user", parts: [{ type: "text", text: "go" }] },
        {
          id: "a",
          role: "assistant",
          parts: [
            {
              type: "tool-schedule_create",
              toolCallId: "s1",
              state: "input-available",
              input: { name: "Digest", prompt: "Summarize", cron: "0 9 * * *" },
            },
          ],
        } as UIMessage,
      ]),
    );
    await act(async () => {
      await result.current.addToolOutput({ tool: "schedule_create", toolCallId: "s1", output: '{"status":"declined"}' });
    });
    expect(result.current.isTurnStopped()).toBe(false);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(calls));
  });

  it("an ask_user output with an unknown id keeps the Stop gate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textTurn("x")));
    const { result } = renderHook(() => useDesignChat({ sessionId: "stopped-foreign" }));
    act(() => result.current.setMessages(pending()));
    await act(async () => {
      result.current.stop();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      await result.current.addToolOutput({ tool: "ask_user", toolCallId: "nope", output: "x" });
    });
    expect(result.current.isTurnStopped()).toBe(true);
  });

  it("restores the Stop gate when addToolOutput rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textTurn("x")));
    const { result } = renderHook(() => useDesignChat({ sessionId: "stopped-reject" }));
    act(() => result.current.setMessages(pending()));
    await act(async () => {
      result.current.stop();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.isTurnStopped()).toBe(true);
    // An `output` getter that throws makes the SDK's addToolOutput reject (its parameters are destructured inside the async fn).
    const bad = { tool: "ask_user", toolCallId: "q1" };
    Object.defineProperty(bad, "output", {
      get() {
        throw new Error("boom");
      },
    });
    await act(async () => {
      await expect(result.current.addToolOutput(bad as never)).rejects.toThrow("boom");
    });
    expect(result.current.isTurnStopped()).toBe(true);
  });

  it("other tool outputs keep the Stop gate", async () => {
    const fetchMock = vi.fn(async () => textTurn("x"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDesignChat({ sessionId: "stopped-other" }));
    act(() => result.current.setMessages(pending()));
    await act(async () => {
      result.current.stop();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      await result.current.addToolOutput({ tool: "browse_act", toolCallId: "q1", output: "{}" } as never);
    });
    expect(result.current.isTurnStopped()).toBe(true);
  });
});
