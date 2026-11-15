import { useSyncExternalStore } from "react";

// What the schedule_set_enabled / schedule_delete precheck (useDesignChat.onToolCall) looked up for a call that
// needs the person's confirmation, keyed by toolCallId. The precheck is the only thing that decides a card is
// needed: MessageList draws ScheduleActionCard only while a record exists, and the card reads its details here.
// Memory only: after a reload the sanitizer turns pending parts into errors, so there is nothing to restore.

export interface ScheduleActionDetails {
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
}

const records = new Map<string, ScheduleActionDetails>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  for (const l of [...listeners]) l();
}

export const pendingScheduleActions = {
  get: (toolCallId: string | undefined): ScheduleActionDetails | undefined =>
    toolCallId === undefined ? undefined : records.get(toolCallId),
  set(toolCallId: string, details: ScheduleActionDetails) {
    records.set(toolCallId, details);
    changed();
  },
  delete(toolCallId: string) {
    if (records.delete(toolCallId)) changed();
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  version: () => version,
};

/** Re-renders the caller whenever a record is added or removed. */
export function usePendingScheduleActionsVersion(): number {
  return useSyncExternalStore(pendingScheduleActions.subscribe, pendingScheduleActions.version);
}
