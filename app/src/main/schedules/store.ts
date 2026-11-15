// `<userData>/schedules.json` `{ version: 1, schedules: Schedule[] }`: file mode 0600, atomic write (tmp + rename), at most
// 50 schedules. A missing or broken file gives an empty list (logged); an entry that does not validate is dropped on load.
// Ids are generated here (never taken from the caller on create). Synchronous, like the MCP settings store.

import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { isObject, writeFileAtomicSync } from "../storeUtils";
import { TASK_ID_RE } from "../mcp/types";
import { parseCron } from "./cron";

export const SCHEDULES_FILE = "schedules.json";
export const MAX_SCHEDULES = 50;
export const MAX_NAME = 100;
export const MAX_PROMPT = 20_000;

export type LastRunStatus = "started" | "skipped" | "failed";

export interface LastRun {
  at: number;
  status: LastRunStatus;
  chatId?: string;
  error?: string;
}

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRun?: LastRun;
}

export interface ScheduleView extends Schedule {
  nextRunAt: number | null;
}

export interface ScheduleInput {
  id?: string;
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
}

export interface SchedulesFs {
  readText(filePath: string): string | null;
  /** Atomic replace, mode 0600. Throws on failure. */
  writeText(filePath: string, text: string): void;
}

export const nodeSchedulesFs: SchedulesFs = {
  readText(filePath) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  },
  writeText(filePath, text) {
    writeFileAtomicSync(filePath, text, { chmod: true });
  },
};

const INPUT_KEYS = new Set(["id", "name", "prompt", "cron", "enabled"]);

/** `schedules:save` payload: a plain object with exactly the ScheduleInput keys (id optional), every limit checked. */
export function parseScheduleInput(raw: unknown): { input: ScheduleInput } | { error: string } {
  if (!isObject(raw)) return { error: "Invalid schedule." };
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return { error: "Invalid schedule." };
  for (const k of Object.keys(raw)) if (!INPUT_KEYS.has(k)) return { error: "Invalid schedule." };
  const { id, name, prompt, cron, enabled } = raw;
  if (id !== undefined && (typeof id !== "string" || !TASK_ID_RE.test(id))) return { error: "Invalid schedule id." };
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > MAX_NAME) return { error: `The name must be 1 to ${MAX_NAME} characters.` };
  if (typeof prompt !== "string" || prompt.trim().length < 1 || prompt.trim().length > MAX_PROMPT) {
    return { error: `The task must be 1 to ${MAX_PROMPT} characters.` };
  }
  if (typeof cron !== "string") return { error: "The schedule must be text." };
  const parsed = parseCron(cron);
  if ("error" in parsed) return { error: parsed.error };
  if (typeof enabled !== "boolean") return { error: "Invalid schedule." };
  return { input: { ...(id !== undefined ? { id } : {}), name: name.trim(), prompt: prompt.trim(), cron: cron.trim(), enabled } };
}

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function parseLastRun(raw: unknown): LastRun | undefined {
  if (!isObject(raw) || !isTime(raw.at)) return undefined;
  if (raw.status !== "started" && raw.status !== "skipped" && raw.status !== "failed") return undefined;
  const run: LastRun = { at: raw.at, status: raw.status };
  if (typeof raw.chatId === "string" && TASK_ID_RE.test(raw.chatId)) run.chatId = raw.chatId;
  if (typeof raw.error === "string") run.error = raw.error.slice(0, 2000);
  return run;
}

/** A stored entry, or null when it is not a valid schedule. */
function parseStored(raw: unknown): Schedule | null {
  if (!isObject(raw)) return null;
  const { id, name, prompt, cron, enabled, createdAt, updatedAt } = raw;
  if (typeof id !== "string" || !TASK_ID_RE.test(id)) return null;
  if (typeof name !== "string" || name.trim().length < 1 || name.length > MAX_NAME) return null;
  if (typeof prompt !== "string" || prompt.trim().length < 1 || prompt.length > MAX_PROMPT) return null;
  if (typeof cron !== "string" || "error" in parseCron(cron)) return null;
  if (typeof enabled !== "boolean" || !isTime(createdAt) || !isTime(updatedAt)) return null;
  const lastRun = parseLastRun(raw.lastRun);
  return { id, name, prompt, cron, enabled, createdAt, updatedAt, ...(lastRun ? { lastRun } : {}) };
}

export interface ScheduleStore {
  list(): Schedule[];
  get(id: string): Schedule | undefined;
  /** Creates (no `input.id`) or updates (keeps createdAt and lastRun). Input must already be parsed by `parseScheduleInput`. */
  save(input: ScheduleInput): { schedule: Schedule } | { error: string };
  remove(id: string): { ok: true } | { error: string };
  /** Records the outcome of a run. A vanished schedule is ignored (returns null). */
  setLastRun(id: string, lastRun: LastRun): Schedule | null;
}

export interface ScheduleStoreOptions {
  filePath: string;
  fs?: SchedulesFs;
  now?: () => number;
  newId?: () => string;
}

export function createScheduleStore(opts: ScheduleStoreOptions): ScheduleStore {
  const io = opts.fs ?? nodeSchedulesFs;
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? randomUUID;

  let items: Schedule[] = [];
  const text = io.readText(opts.filePath);
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isObject(parsed) && parsed.version === 1 && Array.isArray(parsed.schedules)) {
        const seen = new Set<string>();
        for (const entry of parsed.schedules) {
          const s = parseStored(entry);
          if (s === null || seen.has(s.id)) {
            console.error("[schedules] dropped an invalid entry");
            continue;
          }
          seen.add(s.id);
          items.push(s);
          if (items.length >= MAX_SCHEDULES) break;
        }
      } else {
        console.error("[schedules] unexpected file shape, starting empty");
      }
    } catch {
      console.error("[schedules] could not read the schedules file, starting empty");
    }
  }

  /** Persists `next`; on success it becomes current. */
  const commit = (next: Schedule[]): boolean => {
    try {
      io.writeText(opts.filePath, JSON.stringify({ version: 1, schedules: next }, null, 2) + "\n");
    } catch (err) {
      console.error("[schedules] write failed", err);
      return false;
    }
    items = next;
    return true;
  };
  const WRITE_ERROR = { error: "Could not save the schedules." } as const;

  return {
    list: () => items.map((s) => ({ ...s })),
    get: (id) => {
      const s = items.find((x) => x.id === id);
      return s ? { ...s } : undefined;
    },
    save(input) {
      const t = now();
      if (input.id === undefined) {
        if (items.length >= MAX_SCHEDULES) return { error: `At most ${MAX_SCHEDULES} schedules.` };
        let id = newId();
        while (items.some((s) => s.id === id)) id = newId();
        const schedule: Schedule = { id, name: input.name, prompt: input.prompt, cron: input.cron, enabled: input.enabled, createdAt: t, updatedAt: t };
        return commit([...items, schedule]) ? { schedule: { ...schedule } } : WRITE_ERROR;
      }
      const prev = items.find((s) => s.id === input.id);
      if (!prev) return { error: "That schedule no longer exists." };
      const schedule: Schedule = { ...prev, name: input.name, prompt: input.prompt, cron: input.cron, enabled: input.enabled, updatedAt: t };
      return commit(items.map((s) => (s.id === prev.id ? schedule : s))) ? { schedule: { ...schedule } } : WRITE_ERROR;
    },
    remove(id) {
      if (!items.some((s) => s.id === id)) return { error: "That schedule no longer exists." };
      return commit(items.filter((s) => s.id !== id)) ? { ok: true } : WRITE_ERROR;
    },
    setLastRun(id, lastRun) {
      const prev = items.find((s) => s.id === id);
      if (!prev) return null;
      const schedule: Schedule = { ...prev, lastRun };
      // A failed write keeps the run in memory for this session (the file is the only thing behind).
      const next = items.map((s) => (s.id === id ? schedule : s));
      if (!commit(next)) items = next;
      return { ...schedule };
    },
  };
}
