import type { ScheduleView } from "@/lib/desktopBridge";
import { describeCron } from "@/lib/scheduleCron";
import { isBackgroundTaskChat } from "@/store/chatStore";
import type { ToolHandler } from "@/lib/toolRegistry";

// schedule_list / schedule_create (CONTRACT.md "Scheduled chats > Agent tools"). schedule_create waits for the
// person, like ask_user: useDesignChat.onToolCall leaves the part pending and MessageList renders
// ScheduleConfirmCard, which calls `createScheduleViaBridge` and then chat.addToolOutput.

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

const errorOut = (error: string) => JSON.stringify({ status: "error", error });

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
