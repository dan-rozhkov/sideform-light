import type { UIMessage } from "ai";

import { parseScheduleCreateInput } from "@/lib/tools/schedules";

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

/** Tool call ids of schedule_create parts that wait for the person's confirmation (same rule as ask_user). */
export function pendingScheduleCreateIds(messages: UIMessage[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts as Part[]) if (isPendingScheduleCreatePart(p)) ids.push(p.toolCallId as string);
  }
  return ids;
}

/** True while a schedule_create confirmation card is unanswered: the composer stays blocked like for ask_user. */
export function hasPendingScheduleCreate(messages: UIMessage[]): boolean {
  return pendingScheduleCreateIds(messages).length > 0;
}
