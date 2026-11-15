// Display text shared by Settings > Schedules (the list and the edit dialog): one time formatter, one
// last-run sentence, one error text. All in the interface language. (The agent-facing English text lives in
// lib/tools/schedules.ts.)

import { currentLocale, t } from "@/i18n";
import type { ScheduleView } from "@/lib/desktopBridge";
import { formatRelativeTime } from "@/lib/relativeTime";

/** "15 Nov 2026, 09:00" in the interface language: the one absolute time format of the Schedules UI. */
export function formatScheduleWhen(ms: number): string {
  return new Date(ms).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
}

/** "Last run started 5m ago" / "Last run skipped 5m ago: reason" / "Last run failed 5m ago: reason". */
export function lastRunText(run: NonNullable<ScheduleView["lastRun"]>): string {
  const when = formatRelativeTime(run.at);
  switch (run.status) {
    case "started":
      return t("schedules.lastRun.started", { when });
    case "skipped":
      return run.error ? t("schedules.lastRun.skippedReason", { when, error: run.error }) : t("schedules.lastRun.skipped", { when });
    case "failed":
      return run.error ? t("schedules.lastRun.failedReason", { when, error: run.error }) : t("schedules.lastRun.failed", { when });
  }
}

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
