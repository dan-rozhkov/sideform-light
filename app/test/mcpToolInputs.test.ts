import { describe, expect, it } from "vitest";
import {
  parseAnswerQuestion,
  parseAnswers,
  parseGetTask,
  parseListTasks,
  parseSendMessage,
  parseStartTask,
  parseStopTask,
} from "../src/main/mcp/toolInputs";

const err = (r: { ok: boolean }) => (r.ok ? null : (r as unknown as { error: string }).error);

describe("start_task input", () => {
  it("accepts a prompt and an optional title, drops other keys", () => {
    expect(parseStartTask({ prompt: "Open a.test", extra: 1 })).toEqual({ ok: true, value: { op: "start", prompt: "Open a.test" } });
    expect(parseStartTask({ prompt: "x", title: "T" })).toEqual({ ok: true, value: { op: "start", prompt: "x", title: "T" } });
    expect(parseStartTask({ prompt: "x", title: "   " })).toEqual({ ok: true, value: { op: "start", prompt: "x" } });
  });
  it("enforces 1..20000 for the prompt and <=200 for the title", () => {
    expect(parseStartTask({ prompt: "a".repeat(20000) }).ok).toBe(true);
    for (const prompt of ["", "   ", "a".repeat(20001), 5, null, undefined, ["x"]]) expect(parseStartTask({ prompt }).ok, String(prompt)).toBe(false);
    expect(parseStartTask({ prompt: "x", title: "t".repeat(200) }).ok).toBe(true);
    expect(parseStartTask({ prompt: "x", title: "t".repeat(201) }).ok).toBe(false);
    expect(parseStartTask({ prompt: "x", title: 3 }).ok).toBe(false);
  });
});

describe("taskId", () => {
  it("must match ^[A-Za-z0-9_-]{1,128}$ in every tool that takes it", () => {
    const good = "tab-1761400000000-3";
    expect(parseGetTask({ taskId: good }).ok).toBe(true);
    expect(parseStopTask({ taskId: "a".repeat(128) }).ok).toBe(true);
    for (const taskId of ["", "a".repeat(129), "../x", "a b", "a/b", 7, undefined, null]) {
      expect(parseGetTask({ taskId }).ok, String(taskId)).toBe(false);
      expect(parseStopTask({ taskId }).ok).toBe(false);
      expect(parseSendMessage({ taskId, text: "hi" }).ok).toBe(false);
      expect(parseAnswerQuestion({ taskId, answers: [{ id: "q", value: "a" }] }).ok).toBe(false);
    }
  });
});

describe("get_task waitSeconds", () => {
  it("defaults to 0 and accepts 0..55", () => {
    expect(parseGetTask({ taskId: "t" })).toEqual({ ok: true, value: { taskId: "t", waitSeconds: 0 } });
    expect(parseGetTask({ taskId: "t", waitSeconds: 55 })).toEqual({ ok: true, value: { taskId: "t", waitSeconds: 55 } });
    expect(parseGetTask({ taskId: "t", waitSeconds: 0.5 }).ok).toBe(true);
  });
  it("rejects out of range and non-numbers", () => {
    for (const waitSeconds of [-1, 56, NaN, Infinity, "5", null]) expect(parseGetTask({ taskId: "t", waitSeconds }).ok, String(waitSeconds)).toBe(false);
  });
});

describe("send_message / stop_task", () => {
  it("text is 1..20000 characters", () => {
    expect(parseSendMessage({ taskId: "t", text: "go on" })).toEqual({ ok: true, value: { op: "message", taskId: "t", text: "go on" } });
    for (const text of ["", " ", "a".repeat(20001), 1, undefined]) expect(parseSendMessage({ taskId: "t", text }).ok).toBe(false);
    expect(parseStopTask({ taskId: "t" })).toEqual({ ok: true, value: { op: "stop", taskId: "t" } });
  });
});

describe("list_tasks limit", () => {
  it("defaults to 20 and accepts whole numbers 1..100", () => {
    expect(parseListTasks({})).toEqual({ ok: true, value: { op: "list", limit: 20 } });
    expect(parseListTasks({ limit: 100 })).toEqual({ ok: true, value: { op: "list", limit: 100 } });
    for (const limit of [0, 101, 1.5, "3", NaN, null]) expect(parseListTasks({ limit }).ok, String(limit)).toBe(false);
  });
});

describe("answers", () => {
  it("accepts strings and string arrays with an optional note, drops unknown keys", () => {
    const r = parseAnswers([{ id: "q1", value: "a", note: "n", junk: 1 }, { id: "q2", value: ["x", "y"] }]);
    expect(r).toEqual({ ok: true, value: [{ id: "q1", value: "a", note: "n" }, { id: "q2", value: ["x", "y"] }] });
  });
  it("at most 50 entries, not empty, not an array", () => {
    const one = { id: "q", value: "a" };
    expect(parseAnswers(Array.from({ length: 50 }, (_, i) => ({ id: `q${i}`, value: "a" }))).ok).toBe(true);
    expect(parseAnswers(Array.from({ length: 51 }, (_, i) => ({ id: `q${i}`, value: "a" }))).ok).toBe(false);
    expect(parseAnswers([]).ok).toBe(false);
    expect(parseAnswers("x").ok).toBe(false);
    expect(parseAnswers({ 0: one }).ok).toBe(false);
  });
  it("rejects a bad id, value, note and a duplicated id", () => {
    for (const bad of [
      [{ value: "a" }],
      [{ id: "", value: "a" }],
      [{ id: "q", value: 5 }],
      [{ id: "q", value: [1] }],
      [{ id: "q", value: "a", note: 3 }],
      [{ id: "q", value: "a" }, { id: "q", value: "b" }],
      ["str"],
      [null],
    ]) expect(err(parseAnswers(bad)), JSON.stringify(bad)).toBeTruthy();
  });
});
