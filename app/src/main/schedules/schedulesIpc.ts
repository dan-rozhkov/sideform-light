import { NOT_ALLOWED, type BrowserSettingsEvent } from "../browserSettingsIpc";
import { TASK_ID_RE } from "../mcp/types";
import { parseScheduleInput } from "./store";
import { parseCron } from "./cron";
import type { Scheduler } from "./scheduler";

export interface SchedulesIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: BrowserSettingsEvent, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
  };
  scheduler: Pick<Scheduler, "list" | "save" | "remove" | "runNow" | "onChanged">;
  /** Same rule as `mcp-settings:*`: the top frame of a Settings tab on the settings page. */
  isSettingsSender(event: BrowserSettingsEvent): boolean;
  /** The agent panel's own webContents and page (the `chats:*` rule, with a live frame). */
  isPanelSender(event: BrowserSettingsEvent): boolean;
  /** Sends `schedules:changed` to every open Settings tab. */
  pushChanged(): void;
}

const PANEL_KEYS = ["name", "prompt", "cron"];
const CRON_HINT = " Use 5 fields: minute hour day-of-month month day-of-week, for example \"0 9 * * 1-5\".";

const UNKNOWN = { error: "Unknown schedule." } as const;
const FAILED = { error: "Could not complete the request." } as const;

/**
 * `schedules:list|save|remove|run-now` (invoke). `ipcMain.handle` is process-global: created once (index.ts).
 * Answered only to the Settings page; everything else gets `{ error: "Not allowed." }`. Never throws. Every change or
 * run the scheduler reports is pushed to the Settings tabs as `schedules:changed`.
 */
export function registerSchedulesIpc(deps: SchedulesIpcDeps): () => void {
  const guard = async (event: BrowserSettingsEvent, run: () => unknown | Promise<unknown>): Promise<unknown> => {
    if (!deps.isSettingsSender(event)) return NOT_ALLOWED;
    try {
      return await run();
    } catch {
      return FAILED;
    }
  };
  const panelGuard = async (event: BrowserSettingsEvent, run: () => unknown): Promise<unknown> => {
    if (!deps.isPanelSender(event)) return NOT_ALLOWED;
    try {
      return await run();
    } catch {
      return FAILED;
    }
  };
  const idOf = (raw: unknown): string | null => (typeof raw === "string" && TASK_ID_RE.test(raw) ? raw : null);

  const offChanged = deps.scheduler.onChanged(() => {
    try {
      deps.pushChanged();
    } catch (err) {
      console.error("[schedules] push failed", err);
    }
  });

  deps.ipcMain.handle("schedules:list", (e) => guard(e, () => ({ schedules: deps.scheduler.list() })));
  deps.ipcMain.handle("schedules:panel-list", (e) => panelGuard(e, () => ({ schedules: deps.scheduler.list() })));
  deps.ipcMain.handle("schedules:panel-create", (e, payload) =>
    panelGuard(e, () => {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { error: "Invalid schedule." };
      const proto = Object.getPrototypeOf(payload);
      if (proto !== Object.prototype && proto !== null) return { error: "Invalid schedule." };
      const raw = payload as Record<string, unknown>;
      const keys = Object.keys(raw);
      if (keys.length !== PANEL_KEYS.length || !PANEL_KEYS.every((k) => keys.includes(k) && typeof raw[k] === "string")) {
        return { error: "Invalid schedule." };
      }
      const cron = parseCron(raw.cron as string);
      if ("error" in cron) return { error: `${cron.error}${CRON_HINT}` };
      const parsed = parseScheduleInput({ name: raw.name, prompt: raw.prompt, cron: raw.cron, enabled: true });
      return "error" in parsed ? parsed : deps.scheduler.save(parsed.input);
    }),
  );
  deps.ipcMain.handle("schedules:panel-set-enabled", (e, payload) =>
    panelGuard(e, () => {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { error: "Invalid request." };
      const proto = Object.getPrototypeOf(payload);
      if (proto !== Object.prototype && proto !== null) return { error: "Invalid request." };
      const raw = payload as Record<string, unknown>;
      const keys = Object.keys(raw);
      const id = idOf(raw.id);
      if (keys.length !== 2 || !keys.includes("id") || !keys.includes("enabled") || id === null || typeof raw.enabled !== "boolean") {
        return { error: "Invalid request." };
      }
      const current = deps.scheduler.list().find((s) => s.id === id);
      if (!current) return UNKNOWN;
      return deps.scheduler.save({ id, name: current.name, prompt: current.prompt, cron: current.cron, enabled: raw.enabled });
    }),
  );
  deps.ipcMain.handle("schedules:panel-remove", (e, id) =>
    panelGuard(e, () => {
      const valid = idOf(id);
      if (valid === null) return { error: "Invalid schedule id." };
      if (!deps.scheduler.list().some((s) => s.id === valid)) return UNKNOWN;
      return deps.scheduler.remove(valid);
    }),
  );
  deps.ipcMain.handle("schedules:save", (e, payload) =>
    guard(e, () => {
      const parsed = parseScheduleInput(payload);
      return "error" in parsed ? parsed : deps.scheduler.save(parsed.input);
    }),
  );
  deps.ipcMain.handle("schedules:remove", (e, id) =>
    guard(e, () => {
      const valid = idOf(id);
      return valid === null ? { error: "Invalid schedule id." } : deps.scheduler.remove(valid);
    }),
  );
  deps.ipcMain.handle("schedules:run-now", (e, id) =>
    guard(e, () => {
      const valid = idOf(id);
      return valid === null ? { error: "Invalid schedule id." } : deps.scheduler.runNow(valid);
    }),
  );
  return () => {
    offChanged();
    deps.ipcMain.removeHandler("schedules:list");
    deps.ipcMain.removeHandler("schedules:panel-list");
    deps.ipcMain.removeHandler("schedules:panel-create");
    deps.ipcMain.removeHandler("schedules:panel-set-enabled");
    deps.ipcMain.removeHandler("schedules:panel-remove");
    deps.ipcMain.removeHandler("schedules:save");
    deps.ipcMain.removeHandler("schedules:remove");
    deps.ipcMain.removeHandler("schedules:run-now");
  };
}
