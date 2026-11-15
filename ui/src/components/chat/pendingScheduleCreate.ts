import { pendingScheduleActions } from "@/lib/tools/pendingScheduleActions";
import { isScheduleActionTool, parseScheduleActionInput, parseScheduleCreateInput } from "@/lib/tools/schedules";

type Part = { type?: string; toolCallId?: string; input?: unknown; state?: string; output?: unknown };

/**
 * A schedule_create part that waits for the person: input complete (`input-available`), no output yet and an
 * input that parses. MessageList draws the confirmation card for exactly these parts, so a pending call
 * always has a card (a streaming or invalid call blocks nothing).
 */
export function isPendingScheduleCreatePart(part: unknown): boolean {
  const p = part as Part;
  return (
    p.type === "tool-schedule_create" &&
    typeof p.toolCallId === "string" &&
    p.state === "input-available" &&
    p.output === undefined &&
    parseScheduleCreateInput(p.input) !== null
  );
}

/**
 * A schedule_set_enabled / schedule_delete part that waits for the person: same rule as schedule_create
 * (input complete, no output yet, input parses) plus a record from the precheck (pendingScheduleActions), so
 * MessageList draws a card for exactly these parts and a precheck still in flight blocks nothing.
 */
export function isPendingScheduleActionPart(part: unknown): boolean {
  const p = part as Part;
  const tool = typeof p.type === "string" && p.type.startsWith("tool-") ? p.type.slice(5) : undefined;
  return (
    isScheduleActionTool(tool) &&
    typeof p.toolCallId === "string" &&
    p.state === "input-available" &&
    p.output === undefined &&
    parseScheduleActionInput(tool, p.input) !== null &&
    pendingScheduleActions.get(p.toolCallId) !== undefined
  );
}
