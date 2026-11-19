import { afterEach, describe, expect, it } from "vitest";

import { useLanguageStore } from "@/i18n";
import {
  changesFromEventDetail,
  eventKey,
  formatChange,
  isMemoryWriteSuccessful,
  memoryChangesFromInput,
  mergeChangesByEvent,
  noteChangeList,
} from "../memoryActivity";

afterEach(() => useLanguageStore.setState({ language: "en" }));

describe("memoryActivity", () => {
  it("reads changes from a memory tool input (old_text) and drops unknown shapes", () => {
    expect(
      memoryChangesFromInput({
        target: "user",
        operations: [{ action: "add", content: "tea" }, { action: "replace", content: "b", old_text: "a" }, { action: "nope" }, 3],
      }),
    ).toEqual([
      { kind: "memory", target: "user", action: "add", content: "tea", oldText: undefined },
      { kind: "memory", target: "user", action: "replace", content: "b", oldText: "a" },
    ]);
    expect(memoryChangesFromInput(null)).toEqual([]);
    expect(memoryChangesFromInput({ operations: "x" })).toEqual([]);
  });

  it("reads an activity event detail, including the cut-off count, and ignores other kinds", () => {
    const out = changesFromEventDetail({ kind: "memory", target: "memory", operations: [{ action: "remove", oldText: "old" }], moreOperations: 3 });
    expect(out).toEqual([
      { kind: "memory", target: "memory", action: "remove", content: undefined, oldText: "old" },
      { kind: "more", count: 3 },
    ]);
    expect(changesFromEventDetail({ kind: "skill", action: "create", name: "x" })).toEqual([]);
    expect(changesFromEventDetail(undefined)).toEqual([]);
  });

  it("formats each change in the current language", () => {
    const add = { kind: "memory", target: "user", action: "add", content: "tea" } as const;
    expect(formatChange(add)).toBe("Remembered about you: tea");
    expect(formatChange({ kind: "memory", target: "memory", action: "replace", content: "b", oldText: "a" })).toBe("Updated: a → b");
    expect(formatChange({ kind: "memory", target: "memory", action: "remove", oldText: "a" })).toBe("Forgot: a");
    expect(formatChange({ kind: "more", count: 1 })).toBe("…and 1 more change");
    expect(formatChange({ kind: "more", count: 4 })).toBe("…and 4 more changes");
    useLanguageStore.setState({ language: "ru" });
    expect(formatChange(add)).toBe("Запомнил о вас: tea");
  });

  it("merges per-event maps without replacing known events", () => {
    const a = { "1": [{ kind: "more", count: 1 } as const] };
    expect(mergeChangesByEvent(a, { "1": [] })).toBe(a);
    expect(Object.keys(mergeChangesByEvent(a, { "2": [] }) ?? {})).toEqual(["1", "2"]);
    expect(noteChangeList({ "1": [{ kind: "more", count: 1 }], "2": [{ kind: "more", count: 2 }] })).toHaveLength(2);
    expect(eventKey(5, [])).toBe("5");
    expect(eventKey(undefined, [])).toBe("noid:[]");
  });

  it("treats only { ok: true } (object or JSON string) as a successful write", () => {
    expect(isMemoryWriteSuccessful({ ok: true })).toBe(true);
    expect(isMemoryWriteSuccessful('{"ok":true}')).toBe(true);
    expect(isMemoryWriteSuccessful({ ok: false, error: "over_capacity" })).toBe(false);
    expect(isMemoryWriteSuccessful('{"error":"Unknown tool: memory"}')).toBe(false);
    expect(isMemoryWriteSuccessful("not json")).toBe(false);
    expect(isMemoryWriteSuccessful(undefined)).toBe(false);
  });
});
