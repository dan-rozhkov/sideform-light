import type { UIMessage } from "ai";

import { t } from "@/i18n";

import { isPendingAskUserPart } from "./pendingAskUser";
import { isPendingScheduleCreatePart } from "./pendingScheduleCreate";

/**
 * Tools whose call pauses the agent's turn until the person answers in the chat (a form or a card). While one
 * is pending the composer is blocked, and answering it re-arms auto-continuation after a Stop or an error.
 */
export const TOOLS_WAITING_FOR_PERSON = ["ask_user", "schedule_create"] as const;
export type WaitingTool = (typeof TOOLS_WAITING_FOR_PERSON)[number];

const IS_PENDING: Record<WaitingTool, (part: unknown) => boolean> = {
  ask_user: isPendingAskUserPart,
  schedule_create: isPendingScheduleCreatePart,
};

export interface PendingWaitingCall {
  tool: WaitingTool;
  toolCallId: string;
}

/** Every unanswered call of a tool that waits for the person, in message order. */
export function pendingWaitingCalls(messages: UIMessage[]): PendingWaitingCall[] {
  const out: PendingWaitingCall[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const part of m.parts) {
      const p = part as { type?: string; toolCallId?: string };
      for (const tool of TOOLS_WAITING_FOR_PERSON) {
        if (p.type === `tool-${tool}` && typeof p.toolCallId === "string" && IS_PENDING[tool](part)) {
          out.push({ tool, toolCallId: p.toolCallId });
        }
      }
    }
  }
  return out;
}

export function hasPendingWaitingCall(messages: UIMessage[]): boolean {
  return pendingWaitingCalls(messages).length > 0;
}

/** True when `tool` with this id is a real pending call (a stale or foreign id is not). */
export function isPendingWaitingCall(messages: UIMessage[], tool: string | undefined, toolCallId: string | undefined): boolean {
  return pendingWaitingCalls(messages).some((c) => c.tool === tool && c.toolCallId === toolCallId);
}

/** Composer placeholder while the (newest) pending call waits for the person. */
export function waitingPlaceholder(messages: UIMessage[]): string {
  const last = pendingWaitingCalls(messages).at(-1);
  return last?.tool === "schedule_create"
    ? t("chat.inputPlaceholderSchedule")
    : t("chat.inputPlaceholderAnswer");
}
