import { mkdtempSync, rmSync, statSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SCHEDULES, createScheduleStore, parseScheduleInput, type SchedulesFs } from "../src/main/schedules/store";

function memFs(initial: string | null = null) {
  const f = { text: initial, writes: 0, fail: false };
  const fs: SchedulesFs = {
    readText: () => f.text,
    writeText: (_p, t) => {
      if (f.fail) throw new Error("EIO");
      f.text = t;
      f.writes++;
    },
  };
  return { f, fs };
}
let n = 0;
const newId = () => `id${++n}`;
const INPUT = { name: "Prices", prompt: "Check the prices", cron: "0 9 * * 1-5", enabled: true };
const stored = (over: Record<string, unknown> = {}) => ({ id: "a1", name: "N", prompt: "P", cron: "* * * * *", enabled: true, createdAt: 1, updatedAt: 2, ...over });
const file = (schedules: unknown[]) => JSON.stringify({ version: 1, schedules });

describe("parseScheduleInput", () => {
  it("trims and accepts a valid input, with or without id", () => {
    expect(parseScheduleInput({ ...INPUT, name: "  Prices  ", prompt: "\n do it \n", cron: " 0 9 * * * " })).toEqual({
      input: { name: "Prices", prompt: "do it", cron: "0 9 * * *", enabled: true },
    });
    expect(parseScheduleInput({ ...INPUT, id: "abc_DEF-1" })).toEqual({ input: { ...INPUT, id: "abc_DEF-1" } });
  });
  it("enforces the limits", () => {
    const bad = (o: Record<string, unknown>) => expect("error" in parseScheduleInput({ ...INPUT, ...o }), JSON.stringify(o).slice(0, 60)).toBe(true);
    bad({ name: "" });
    bad({ name: "   " });
    bad({ name: "x".repeat(101) });
    bad({ prompt: "" });
    bad({ prompt: " \n " });
    bad({ prompt: "x".repeat(20_001) });
    bad({ cron: "nope" });
    bad({ cron: 5 });
    bad({ enabled: "yes" });
    bad({ enabled: undefined });
    bad({ id: "bad id" });
    bad({ id: "" });
    bad({ id: "x".repeat(129) });
    bad({ id: 5 });
    bad({ extra: 1 });
    expect("input" in parseScheduleInput({ ...INPUT, name: "x".repeat(100), prompt: "y".repeat(20_000) })).toBe(true);
  });
  it("rejects non-objects", () => {
    for (const v of [null, undefined, 5, "x", [], [INPUT]]) expect("error" in parseScheduleInput(v)).toBe(true);
    class Evil {
      name = "a";
    }
    expect("error" in parseScheduleInput(new Evil())).toBe(true);
  });
});

describe("schedule store (in memory)", () => {
  beforeEach(() => void (n = 0));

  it("a missing file gives an empty list and writes nothing", () => {
    const m = memFs(null);
    expect(createScheduleStore({ filePath: "/x", fs: m.fs }).list()).toEqual([]);
    expect(m.f.writes).toBe(0);
  });

  it("a broken file or a wrong shape gives an empty list", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const text of ["{not json", "[]", "null", JSON.stringify({ version: 2, schedules: [stored()] }), JSON.stringify({ version: 1 }), JSON.stringify({ version: 1, schedules: "x" })]) {
      expect(createScheduleStore({ filePath: "/x", fs: memFs(text).fs }).list(), text).toEqual([]);
    }
  });

  it("drops bad entries on load and keeps the good ones", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = memFs(
      file([
        stored({ id: "ok1" }),
        stored({ id: "bad id" }),
        stored({ id: "c1", cron: "99 * * * *" }),
        stored({ id: "n1", name: "" }),
        stored({ id: "p1", prompt: "x".repeat(20_001) }),
        stored({ id: "e1", enabled: "yes" }),
        stored({ id: "t1", createdAt: "x" }),
        "junk",
        null,
        stored({ id: "ok1" }),
        stored({ id: "ok2", lastRun: { at: 5, status: "started", chatId: "chat-1" } }),
        stored({ id: "ok3", lastRun: { at: 5, status: "weird" } }),
      ]),
    );
    const list = createScheduleStore({ filePath: "/x", fs: m.fs }).list();
    expect(list.map((s) => s.id)).toEqual(["ok1", "ok2", "ok3"]);
    expect(list[1].lastRun).toEqual({ at: 5, status: "started", chatId: "chat-1" });
    expect(list[2].lastRun).toBeUndefined();
  });

  it("creates with a generated id and times, persists, and ignores an id the caller made up on create", () => {
    const m = memFs();
    const store = createScheduleStore({ filePath: "/x", fs: m.fs, now: () => 1000, newId });
    const r = store.save(INPUT);
    expect(r).toEqual({ schedule: { id: "id1", ...INPUT, createdAt: 1000, updatedAt: 1000 } });
    expect(JSON.parse(m.f.text!)).toEqual({ version: 1, schedules: [{ id: "id1", ...INPUT, createdAt: 1000, updatedAt: 1000 }] });
    expect(createScheduleStore({ filePath: "/x", fs: m.fs }).list()).toHaveLength(1);
  });

  it("updates in place: keeps createdAt and lastRun, bumps updatedAt; an unknown id is an error", () => {
    const m = memFs();
    let t = 1000;
    const store = createScheduleStore({ filePath: "/x", fs: m.fs, now: () => t, newId });
    const id = (store.save(INPUT) as { schedule: { id: string } }).schedule.id;
    store.setLastRun(id, { at: 5, status: "started", chatId: "c1" });
    t = 2000;
    const r = store.save({ ...INPUT, id, name: "New", enabled: false });
    expect(r).toEqual({ schedule: { id, ...INPUT, name: "New", enabled: false, createdAt: 1000, updatedAt: 2000, lastRun: { at: 5, status: "started", chatId: "c1" } } });
    expect(store.list()).toHaveLength(1);
    expect(store.save({ ...INPUT, id: "ghost" })).toEqual({ error: expect.any(String) });
  });

  it("limits to 50 schedules", () => {
    const store = createScheduleStore({ filePath: "/x", fs: memFs().fs, newId });
    for (let i = 0; i < MAX_SCHEDULES; i++) expect("schedule" in store.save(INPUT)).toBe(true);
    expect(store.save(INPUT)).toEqual({ error: expect.stringContaining("50") });
    expect(store.list()).toHaveLength(MAX_SCHEDULES);
  });

  it("remove deletes; an unknown id is an error", () => {
    const store = createScheduleStore({ filePath: "/x", fs: memFs().fs, newId });
    const id = (store.save(INPUT) as { schedule: { id: string } }).schedule.id;
    expect(store.remove(id)).toEqual({ ok: true });
    expect(store.list()).toEqual([]);
    expect(store.remove(id)).toEqual({ error: expect.any(String) });
  });

  it("a failed write changes nothing and reports an error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = memFs();
    const store = createScheduleStore({ filePath: "/x", fs: m.fs, newId });
    const id = (store.save(INPUT) as { schedule: { id: string } }).schedule.id;
    m.f.fail = true;
    expect(store.save(INPUT)).toEqual({ error: expect.any(String) });
    expect(store.save({ ...INPUT, id, name: "Other" })).toEqual({ error: expect.any(String) });
    expect(store.remove(id)).toEqual({ error: expect.any(String) });
    expect(store.list().map((s) => s.name)).toEqual(["Prices"]);
  });

  it("setLastRun on a vanished schedule is ignored", () => {
    const store = createScheduleStore({ filePath: "/x", fs: memFs().fs });
    expect(store.setLastRun("nope", { at: 1, status: "failed" })).toBeNull();
  });

  it("list and get return copies", () => {
    const store = createScheduleStore({ filePath: "/x", fs: memFs().fs, newId });
    const id = (store.save(INPUT) as { schedule: { id: string } }).schedule.id;
    store.list()[0].name = "hacked";
    store.get(id)!.name = "hacked";
    expect(store.get(id)!.name).toBe("Prices");
  });
});

describe("schedule store (real disk)", () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "sched-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes schedules.json with mode 0600 atomically (no tmp left) and reloads it", () => {
    const filePath = join(dir, "sub", "schedules.json");
    const store = createScheduleStore({ filePath });
    store.save(INPUT);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dir, "sub"))).toEqual(["schedules.json"]);
    expect(JSON.parse(readFileSync(filePath, "utf8")).schedules).toHaveLength(1);
    expect(createScheduleStore({ filePath }).list()).toHaveLength(1);
  });

  it("a corrupt file on disk is an empty list, never a crash", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const filePath = join(dir, "schedules.json");
    writeFileSync(filePath, "{{{");
    expect(createScheduleStore({ filePath }).list()).toEqual([]);
  });
});
