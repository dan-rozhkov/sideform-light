import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textTurn } from "@/test/sseStream";
import { useChatStore } from "@/store/chatStore";
import { setPenDesktop, stubBrowser } from "./helpers";
import { browseAgent } from "../browseAgent";

// An MCP task (a chat with `source: "mcp"`) keeps a trace of every browse_agent run, QA or not: the external agent
// reads its id from get_task `traces`. An ordinary chat keeps one only for QA runs (or with the "all runs" setting).

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/browse/traces") || String(input).includes("/api/browser/")) {
        return new Response("{}", { status: 503 });
      }
      return textTurn("found it");
    }),
  );
}

async function run(chatId: string) {
  const save = vi.fn(async () => ({ id: "local-1" }));
  setPenDesktop(stubBrowser({}));
  window.penAgentPanel!.traces = { save, open: async () => ({ ok: true }), read: async () => ({ error: "n/a" }) };
  stubFetch();
  const out = await browseAgent({ goal: "find the price", url: "https://shop.test" }, { sessionId: chatId, toolCallId: "tc-1" });
  return { save, result: JSON.parse(String(out)) };
}

describe("browse_agent trace in an MCP task", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
    delete window.penAgentPanel;
    vi.unstubAllGlobals();
  });

  it("a plain run in an MCP task chat saves a trace and returns its id", async () => {
    const id = useChatStore.getState().createChat({ activate: false, source: "mcp" });
    const { save, result } = await run(id);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.trace).toMatchObject({ id: "local-1" });
  });

  it("a plain run in an ordinary chat keeps no trace", async () => {
    const id = useChatStore.getState().createChat({ activate: false });
    const { save, result } = await run(id);
    expect(save).not.toHaveBeenCalled();
    expect(result.trace).toBeUndefined();
  });
});
