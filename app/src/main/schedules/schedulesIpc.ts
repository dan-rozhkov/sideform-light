import { NOT_ALLOWED, type BrowserSettingsEvent } from "../browserSettingsIpc";
import { TASK_ID_RE, type McpPanelPort } from "../mcp/types";
import { parseScheduleInput } from "./store";
import { parseCron } from "./cron";
import type { Scheduler } from "./scheduler";

export interface SchedulesIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: BrowserSettingsEvent, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
  };
  scheduler: Pick<Scheduler, "list" | "save" | "remove" | "runNow" | "onChanged">;
  panel: Pick<McpPanelPort, "request">;
  /** Same rule as `mcp-settings:*`: the top frame of a Settings tab on the settings page. */
  isSettingsSender(event: BrowserSettingsEvent): boolean;
  /** The agent panel's own webContents and page (the `chats:*` rule, with a live frame). */
  isPanelSender(event: BrowserSettingsEvent): boolean;
  /** Sends `schedules:changed` to every open Settings tab. */
  pushChanged(): void;
  /** Brings the agent panel into view (a collapsed panel is expanded). */
  showPanel(): void;
}

const PANEL_KEYS = ["name", "prompt", "cron"];
const CRON_HINT = " Use 5 fields: minute hour day-of-month month day-of-week, for example \"0 9 * * 1-5\".";

const FAILED = { error: "Could not complete the request." } as const;

/**
 * `schedules:list|save|remove|run-now|open-chat` (invoke). `ipcMain.handle` is process-global: created once (index.ts).
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
  deps.ipcMain.handle("schedules:open-chat", (e, chatId) =>
    guard(e, async () => {
      if (typeof chatId !== "string" || !TASK_ID_RE.test(chatId)) return { error: "Invalid chat id." };
      const reply = await deps.panel.request({ op: "open", taskId: chatId });
      if ("error" in reply) return { error: reply.error };
      if (!("ok" in reply)) return { error: "Sideform Light answered in an unexpected way." };
      deps.showPanel();
      return { ok: true };
    }),
  );

  return () => {
    offChanged();
    deps.ipcMain.removeHandler("schedules:list");
    deps.ipcMain.removeHandler("schedules:panel-list");
    deps.ipcMain.removeHandler("schedules:panel-create");
    deps.ipcMain.removeHandler("schedules:save");
    deps.ipcMain.removeHandler("schedules:remove");
    deps.ipcMain.removeHandler("schedules:run-now");
    deps.ipcMain.removeHandler("schedules:open-chat");
  };
}
