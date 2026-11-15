import { t } from "@/i18n";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Coarse relative-time label for the chat list ("just now" / "5m ago" / …) in the current interface
 * language. Deliberately coarse (minutes/hours/days only, no weeks/months) — the chat
 * list only needs enough precision to rank recency at a glance, and Date.now()
 * is read at call time so this stays correct across re-renders without a
 * ticking clock.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const deltaMs = Math.max(0, now - timestamp);

  if (deltaMs < MINUTE_MS) return t("time.justNow");
  if (deltaMs < HOUR_MS) return t("time.minutesAgo", { count: Math.floor(deltaMs / MINUTE_MS) });
  if (deltaMs < DAY_MS) return t("time.hoursAgo", { count: Math.floor(deltaMs / HOUR_MS) });
  return t("time.daysAgo", { count: Math.floor(deltaMs / DAY_MS) });
}
