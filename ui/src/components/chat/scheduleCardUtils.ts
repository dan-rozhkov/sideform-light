// Shared by the schedule confirmation cards.

export const SCHEDULE_CARD = "mt-3 w-full rounded-lg border border-border-default bg-surface-panel/60 p-3 text-xs";

export interface ScheduleOutcome {
  status?: string;
  error?: string;
  /** The error is main's own reply (shown to the person), not an instruction for the model. */
  fromShell?: boolean;
  id?: string;
  schedule?: { name?: string; nextRun?: string };
}

export function parseScheduleOutcome(output: unknown): ScheduleOutcome {
  try {
    const v = typeof output === "string" ? (JSON.parse(output) as unknown) : output;
    if (v && typeof v === "object") {
      const o = v as ScheduleOutcome;
      if (typeof o.error === "string" && !o.status) return { status: "error", error: o.error };
      return o;
    }
  } catch {
    /* fall through */
  }
  return {};
}
