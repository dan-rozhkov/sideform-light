import { beforeEach, describe, expect, it, vi } from "vitest";

import { BROWSE_TRACES_KEY, getTraceMode, setTraceMode, shouldRecordTrace, subscribeTraceMode, type TraceMode } from "../browseTracePref";

beforeEach(() => localStorage.clear());

describe("browseTracePref", () => {
  it("defaults to QA tests and MCP tasks", () => {
    expect(getTraceMode()).toBe("mcp");
  });

  it("round-trips each value; 'mcp' removes the key", () => {
    setTraceMode("all");
    expect(localStorage.getItem(BROWSE_TRACES_KEY)).toBe("all");
    expect(getTraceMode()).toBe("all");
    setTraceMode("qa");
    expect(localStorage.getItem(BROWSE_TRACES_KEY)).toBe("qa");
    expect(getTraceMode()).toBe("qa");
    setTraceMode("mcp");
    expect(localStorage.getItem(BROWSE_TRACES_KEY)).toBeNull();
    expect(getTraceMode()).toBe("mcp");
  });

  it("reads an unknown raw value as the default", () => {
    localStorage.setItem(BROWSE_TRACES_KEY, "bogus");
    expect(getTraceMode()).toBe("mcp");
  });

  it("notifies subscribers on a local set and on a storage event from another document", () => {
    const cb = vi.fn();
    const off = subscribeTraceMode(cb);
    setTraceMode("all");
    expect(cb).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: BROWSE_TRACES_KEY, newValue: null, storageArea: localStorage }));
    expect(cb).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "x", storageArea: localStorage }));
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setTraceMode("mcp");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("shouldRecordTrace truth table", () => {
    const modes: TraceMode[] = ["qa", "mcp", "all"];
    for (const mode of modes) {
      expect(shouldRecordTrace({ qa: true, mcpTask: false, mode })).toBe(true);
      expect(shouldRecordTrace({ qa: true, mcpTask: true, mode })).toBe(true);
    }
    expect(shouldRecordTrace({ qa: false, mcpTask: false, mode: "all" })).toBe(true);
    expect(shouldRecordTrace({ qa: false, mcpTask: true, mode: "all" })).toBe(true);
    expect(shouldRecordTrace({ qa: false, mcpTask: true, mode: "mcp" })).toBe(true);
    expect(shouldRecordTrace({ qa: false, mcpTask: false, mode: "mcp" })).toBe(false);
    expect(shouldRecordTrace({ qa: false, mcpTask: true, mode: "qa" })).toBe(false);
    expect(shouldRecordTrace({ qa: false, mcpTask: false, mode: "qa" })).toBe(false);
  });
});

import { isBackgroundTaskChat } from "@/store/chatStore";
import { useChatStore } from "@/store/chatStore";

describe("isBackgroundTaskChat", () => {
  it("is true for mcp and schedule chats, false for plain ones", () => {
    useChatStore.setState(useChatStore.getInitialState());
    const s = useChatStore.getState();
    const mcp = s.createChat({ activate: false, source: "mcp" });
    const sched = s.createChat({ activate: false, source: "schedule" });
    expect(isBackgroundTaskChat(mcp)).toBe(true);
    expect(isBackgroundTaskChat(sched)).toBe(true);
    expect(isBackgroundTaskChat(useChatStore.getState().chats[0].id)).toBe(false);
    expect(isBackgroundTaskChat(undefined)).toBe(false);
  });
});
