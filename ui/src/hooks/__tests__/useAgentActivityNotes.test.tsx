import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/store/chatStore";
import { ACTIVITY_PAGE_LIMIT, checkAgentActivity, cursorKey, FIRST_CHECK_DELAY_MS, SECOND_CHECK_DELAY_MS, useAgentActivityNotes } from "../useAgentActivityNotes";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const event = (over: Record<string, unknown> = {}) => ({
  id: 5,
  subsystem: "memory",
  action: "add",
  origin: "background_review",
  created_at: "2026-01-01",
  chatId: "c1",
  messageId: "m1",
  detail: { kind: "memory", target: "user", operations: [{ action: "add", content: "tea" }] },
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => (fetchMock.mock.calls as [string][]).map((c) => c[0]);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  useChatStore.setState({ activityNotes: {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function chatId(): string {
  return useChatStore.getState().chats[0].id;
}

describe("checkAgentActivity", () => {
  it("first check is a baseline: records the cursor (0 when empty) and adds no note", async () => {
    fetchMock.mockResolvedValue(json({ events: [event()], latestId: null }));
    await checkAgentActivity("u1", chatId(), "m1");
    expect(urls()[0]).toBe("/api/memory/activity?userId=u1");
    expect(localStorage.getItem(cursorKey("u1"))).toBe("0");
    expect(useChatStore.getState().activityNotes).toEqual({});
  });

  it("with a cursor sends sinceId, adds one note per turn for background memory events and advances the cursor", async () => {
    const id = chatId();
    localStorage.setItem(cursorKey("u1"), "4");
    fetchMock.mockResolvedValue(
      json({
        events: [
          event({ chatId: id }),
          event({ id: 6, chatId: id, detail: { kind: "memory", target: "memory", operations: [{ action: "remove", oldText: "x" }] } }),
          event({ id: 7, origin: "foreground" }),
          event({ id: 8, subsystem: "skill" }),
        ],
        latestId: 8,
      }),
    );
    await checkAgentActivity("u1", id, "m1");
    expect(urls()[0]).toBe("/api/memory/activity?userId=u1&sinceId=4");
    const notes = useChatStore.getState().activityNotes[id];
    expect(notes).toHaveLength(1);
    expect(notes[0].turnMessageId).toBe("m1");
    expect(Object.keys(notes[0].changesByEvent ?? {})).toEqual(["5", "6"]);
    expect(localStorage.getItem(cursorKey("u1"))).toBe("8");
  });

  it("treats a latestId below the cursor, or null, as a reset: new baseline, no notes", async () => {
    const id = chatId();
    localStorage.setItem(cursorKey("u1"), "10");
    fetchMock.mockResolvedValueOnce(json({ events: [event({ id: 1, chatId: id })], latestId: 1 }));
    await checkAgentActivity("u1", id, "m1");
    expect(localStorage.getItem(cursorKey("u1"))).toBe("1");
    expect(useChatStore.getState().activityNotes).toEqual({});
    fetchMock.mockResolvedValueOnce(json({ events: [], latestId: null }));
    await checkAgentActivity("u1", id, "m1");
    expect(localStorage.getItem(cursorKey("u1"))).toBe("0");
    expect(useChatStore.getState().activityNotes).toEqual({});
  });

  it("on a full page advances the cursor only to the max returned id", async () => {
    const id = chatId();
    localStorage.setItem(cursorKey("u1"), "4");
    const events = Array.from({ length: ACTIVITY_PAGE_LIMIT }, (_, i) => event({ id: 5 + i, chatId: id }));
    fetchMock.mockResolvedValue(json({ events, latestId: 500 }));
    await checkAgentActivity("u1", id, "m1");
    expect(localStorage.getItem(cursorKey("u1"))).toBe(String(4 + ACTIVITY_PAGE_LIMIT));
  });

  it("merges a later check of the same turn into the same note", async () => {
    const id = chatId();
    localStorage.setItem(cursorKey("u1"), "4");
    fetchMock.mockResolvedValueOnce(json({ events: [event({ chatId: id })], latestId: 5 }));
    await checkAgentActivity("u1", id, "m1");
    fetchMock.mockResolvedValueOnce(json({ events: [event({ id: 6, chatId: id })], latestId: 6 }));
    await checkAgentActivity("u1", id, "m1");
    const notes = useChatStore.getState().activityNotes[id];
    expect(notes).toHaveLength(1);
    expect(Object.keys(notes[0].changesByEvent ?? {})).toEqual(["5", "6"]);
  });

  it("skips a chat that does not exist, and anchors id-less events after the turn's last message", async () => {
    const id = chatId();
    localStorage.setItem(cursorKey("u1"), "1");
    fetchMock.mockResolvedValue(json({ events: [event({ chatId: "gone" }), event({ id: 6, chatId: undefined, messageId: undefined })], latestId: 6 }));
    await checkAgentActivity("u1", id, "last");
    const all = useChatStore.getState().activityNotes;
    expect(Object.keys(all)).toEqual([id]);
    expect(all[id][0].afterMessageId).toBe("last");
  });

  it("stays silent on a failed request or a bad body and does not move the cursor", async () => {
    localStorage.setItem(cursorKey("u1"), "4");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await checkAgentActivity("u1", chatId(), "m1");
    fetchMock.mockResolvedValueOnce(json({ nope: 1 }));
    await checkAgentActivity("u1", chatId(), "m1");
    expect(localStorage.getItem(cursorKey("u1"))).toBe("4");
    expect(useChatStore.getState().activityNotes).toEqual({});
  });
});

describe("useAgentActivityNotes", () => {
  const setup = (userId = "u1") =>
    renderHook((p: { busy: boolean }) => useAgentActivityNotes({ userId, busy: p.busy, sessionId: "s", getLastMessageId: () => "m9" }), {
      initialProps: { busy: false },
    });

  it("checks twice (20s and 60s) after a turn finishes, not before and not on mount", async () => {
    fetchMock.mockResolvedValue(json({ events: [], latestId: null }));
    const { rerender } = setup();
    rerender({ busy: true });
    await act(async () => { vi.advanceTimersByTime(SECOND_CHECK_DELAY_MS * 2); });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ busy: false });
    await act(async () => { vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS - 1); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(SECOND_CHECK_DELAY_MS - FIRST_CHECK_DELAY_MS); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(SECOND_CHECK_DELAY_MS * 3); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a new turn cancels the pending checks", async () => {
    fetchMock.mockResolvedValue(json({ events: [], latestId: null }));
    const { rerender } = setup();
    rerender({ busy: true });
    rerender({ busy: false });
    rerender({ busy: true });
    await act(async () => { vi.advanceTimersByTime(SECOND_CHECK_DELAY_MS * 2); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing without a userId and clears timers on unmount", async () => {
    const none = setup("");
    none.rerender({ busy: true });
    none.rerender({ busy: false });
    const live = setup();
    live.rerender({ busy: true });
    live.rerender({ busy: false });
    live.unmount();
    await act(async () => { vi.advanceTimersByTime(SECOND_CHECK_DELAY_MS * 2); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
