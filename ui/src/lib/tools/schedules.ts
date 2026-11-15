import type { ScheduleView } from "@/lib/desktopBridge";
import { describeCron } from "@/lib/scheduleCron";
import { isBackgroundTaskChat } from "@/store/chatStore";
import type { ToolHandler } from "@/lib/toolRegistry";
import { pendingScheduleActions } from "./pendingScheduleActions";

// schedule_list / schedule_create (CONTRACT.md "Scheduled chats > Agent tools"). schedule_create waits for the
// person, like ask_user: useDesignChat.onToolCall leaves the part pending and MessageList renders
// ScheduleConfirmCard, which calls `createScheduleViaBridge` and then chat.addToolOutput.
// schedule_set_enabled / schedule_delete: the precheck decides; it records the schedule's details in
// pendingScheduleActions when a card is needed, and the card only confirms or cancels.

export interface ScheduleSummary {
  id: string;
  name: string;
  cron: string;
  description: string;
  enabled: boolean;
  nextRun?: string;
  lastRun?: { status: string; at: string };
}

export interface ScheduleCreateInput {
  name: string;
  prompt: string;
  cron: string;
}

export const BACKGROUND_CREATE_ERROR = "Schedules can be created only in a chat with the person.";
export const BACKGROUND_ACTION_ERROR = "Schedules can be changed only in a chat with the person.";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local time in a fixed format, not the system locale: "Mon 16 Nov 2026, 09:00". */
export function formatScheduleTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toScheduleSummary(s: ScheduleView): ScheduleSummary {
  const out: ScheduleSummary = {
    id: s.id,
    name: s.name,
    cron: s.cron,
    // English whatever the interface language: this text is for the model.
    description: describeCron(s.cron, "en"),
    enabled: s.enabled,
  };
  if (typeof s.nextRunAt === "number") out.nextRun = formatScheduleTime(s.nextRunAt);
  if (s.lastRun) out.lastRun = { status: s.lastRun.status, at: formatScheduleTime(s.lastRun.at) };
  return out;
}

function schedulesBridge() {
  const b = window.penAgentPanel?.schedules;
  return b && typeof b.list === "function" && typeof b.create === "function" ? b : undefined;
}

/**
 * `fromShell`: the text is main's own reply (or a failed bridge call) rather than an instruction for the model;
 * the in-chat card shows such a reason to the person.
 */
export const errorOut = (error: string, fromShell = false) =>
  JSON.stringify(fromShell ? { status: "error", error, fromShell: true } : { status: "error", error });

export const scheduleList: ToolHandler = async () => {
  const bridge = schedulesBridge();
  if (!bridge) return errorOut("Schedules are not available here.");
  try {
    const res = await bridge.list();
    if ("error" in res) return errorOut(res.error);
    return JSON.stringify({ schedules: res.schedules.map(toScheduleSummary) });
  } catch (e) {
    return errorOut(e instanceof Error ? e.message : String(e));
  }
};

/** Returns the input when it matches the schedule_create schema, else null. */
export function parseScheduleCreateInput(input: unknown): ScheduleCreateInput | null {
  if (!input || typeof input !== "object") return null;
  const { name, prompt, cron } = input as Record<string, unknown>;
  if (typeof name !== "string" || name.length < 1 || name.length > 100) return null;
  if (typeof prompt !== "string" || prompt.length < 1 || prompt.length > 20000) return null;
  if (typeof cron !== "string" || cron.length < 1 || cron.length > 100) return null;
  return { name, prompt, cron };
}

/**
 * Decides schedule_create before the card: an output string (an error) when the call is answered at once, or
 * null when it stays pending for the person's confirmation.
 */
export function precheckScheduleCreate(input: unknown, sessionId: string | undefined): string | null {
  if (!parseScheduleCreateInput(input)) {
    return errorOut("Invalid input: name (1-100 characters), prompt (1-20000) and cron (1-100) are required strings.");
  }
  if (isBackgroundTaskChat(sessionId)) return errorOut(BACKGROUND_CREATE_ERROR);
  if (!schedulesBridge()) return errorOut("Schedules are not available here.");
  return null;
}

/** Registry fallback: the in-chat card normally owns the pending call. */
export const scheduleCreate: ToolHandler = async (args, context) =>
  precheckScheduleCreate(args, context?.sessionId) ??
  errorOut("schedule_create is confirmed via the in-chat card, not this handler");

/** The card's "Create schedule": the tool output (a JSON string). */
export async function createScheduleViaBridge(input: ScheduleCreateInput): Promise<string> {
  const bridge = schedulesBridge();
  if (!bridge) return errorOut("Schedules are not available here.");
  try {
    const res = await bridge.create({ name: input.name, prompt: input.prompt, cron: input.cron });
    if ("error" in res) return errorOut(res.error);
    return JSON.stringify({ status: "created", schedule: toScheduleSummary(res.schedule) });
  } catch (e) {
    return errorOut(e instanceof Error ? e.message : String(e));
  }
}

export const DECLINED_OUTPUT = JSON.stringify({ status: "declined" });

// ---- schedule_set_enabled / schedule_delete: the same confirmation-card flow, keyed by tool name ----

export type ScheduleActionTool = "schedule_set_enabled" | "schedule_delete";
export type ScheduleAction =
  | { tool: "schedule_set_enabled"; id: string; enabled: boolean }
  | { tool: "schedule_delete"; id: string };

export const SCHEDULE_ACTION_TOOLS = ["schedule_set_enabled", "schedule_delete"] as const;
export const UNKNOWN_SCHEDULE_ERROR = "Unknown schedule id. Call schedule_list.";

const SCHEDULE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isScheduleActionTool(tool: unknown): tool is ScheduleActionTool {
  return (SCHEDULE_ACTION_TOOLS as readonly unknown[]).includes(tool);
}

/** Returns the call when `input` matches the tool's schema, else null. */
export function parseScheduleActionInput(tool: ScheduleActionTool, input: unknown): ScheduleAction | null {
  if (!input || typeof input !== "object") return null;
  const { id, enabled } = input as Record<string, unknown>;
  if (typeof id !== "string" || !SCHEDULE_ID.test(id)) return null;
  if (tool === "schedule_delete") return { tool, id };
  if (typeof enabled !== "boolean") return null;
  return { tool, id, enabled };
}

function actionBridge(tool: ScheduleActionTool) {
  const b = window.penAgentPanel?.schedules;
  if (!b || typeof b.list !== "function") return undefined;
  const method = tool === "schedule_delete" ? b.remove : b.setEnabled;
  return typeof method === "function" ? b : undefined;
}

export const unknownScheduleOutput = () => errorOut(UNKNOWN_SCHEDULE_ERROR);

/**
 * Decides schedule_set_enabled / schedule_delete before the card: an output string when the call is answered
 * at once (bad input, background chat, no bridge, unknown id, nothing to change), or null when it stays pending
 * for the person's confirmation.
 */
export async function precheckScheduleAction(
  tool: ScheduleActionTool,
  input: unknown,
  sessionId: string | undefined,
  toolCallId?: string,
): Promise<string | null> {
  const call = parseScheduleActionInput(tool, input);
  if (!call) {
    return errorOut(
      tool === "schedule_delete"
        ? "Invalid input: id is required (letters, digits, - and _, up to 128 characters)."
        : "Invalid input: id (letters, digits, - and _, up to 128 characters) and enabled (boolean) are required.",
    );
  }
  if (isBackgroundTaskChat(sessionId)) return errorOut(BACKGROUND_ACTION_ERROR);
  const bridge = actionBridge(tool);
  if (!bridge) return errorOut("Schedules are not available here.");
  try {
    const res = await bridge.list();
    if ("error" in res) return errorOut(res.error, true);
    const found = res.schedules.find((s) => s.id === call.id);
    if (!found) return unknownScheduleOutput();
    if (call.tool === "schedule_set_enabled" && found.enabled === call.enabled) {
      return JSON.stringify({ status: "updated", schedule: toScheduleSummary(found) });
    }
    // The card is needed: record what the card shows before the part is left pending.
    if (toolCallId !== undefined) {
      pendingScheduleActions.set(toolCallId, { name: found.name, cron: found.cron, prompt: found.prompt, enabled: found.enabled });
    }
  } catch (e) {
    return errorOut(e instanceof Error ? e.message : String(e), true);
  }
  return null;
}

/** Registry fallback: the in-chat card normally owns the pending call. */
export const scheduleSetEnabled: ToolHandler = async (args, context) =>
  (await precheckScheduleAction("schedule_set_enabled", args, context?.sessionId)) ??
  errorOut("schedule_set_enabled is confirmed via the in-chat card, not this handler");

export const scheduleDelete: ToolHandler = async (args, context) =>
  (await precheckScheduleAction("schedule_delete", args, context?.sessionId)) ??
  errorOut("schedule_delete is confirmed via the in-chat card, not this handler");

/** The card's confirm button: the tool output (a JSON string). */
export async function runScheduleAction(call: ScheduleAction): Promise<string> {
  const bridge = actionBridge(call.tool);
  if (!bridge) return errorOut("Schedules are not available here.");
  try {
    if (call.tool === "schedule_delete") {
      const res = await bridge.remove(call.id);
      if ("error" in res) return errorOut(res.error, true);
      return JSON.stringify({ status: "deleted", id: call.id });
    }
    const res = await bridge.setEnabled(call.id, call.enabled);
    if ("error" in res) return errorOut(res.error, true);
    return JSON.stringify({ status: "updated", schedule: toScheduleSummary(res.schedule) });
  } catch (e) {
    return errorOut(e instanceof Error ? e.message : String(e), true);
  }
}
