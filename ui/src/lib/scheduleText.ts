// Display text shared by Settings > Schedules (the list and the edit dialog): one time formatter and one
// error text. All in the interface language. (The agent-facing English text lives in
// lib/tools/schedules.ts.)

import { currentLocale } from "@/i18n";

/** "15 Nov 2026, 09:00" in the interface language: the one absolute time format of the Schedules UI. */
export function formatScheduleWhen(ms: number): string {
  return new Date(ms).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
}

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
