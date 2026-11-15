// Frequency presets of the Schedules editor <-> five-field cron strings (local time), and the human
// description of a cron. Pure. Anything the presets cannot express stays "custom" (the raw cron).

import { currentLocale, t, type MessageKey } from "@/i18n";

export type Frequency =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; day: number; hour: number; minute: number }
  | { kind: "custom"; cron: string };

export type FrequencyKind = Frequency["kind"];

/** Name of a cron day-of-week (0 = Sunday) in the interface language, as it reads inside a sentence. */
export function dayName(day: number): string {
  // 2024-01-07 was a Sunday.
  return new Intl.DateTimeFormat(currentLocale(), { weekday: "long" }).format(new Date(2024, 0, 7 + (day % 7)));
}

/** `dayName` with a capital first letter, for a list or a button. */
export function dayLabel(day: number): string {
  const name = dayName(day);
  return name.charAt(0).toLocaleUpperCase(currentLocale()) + name.slice(1);
}

/** Message keys (translate at render, never at module load). */
export const FREQUENCY_LABEL_KEYS: Record<FrequencyKind, MessageKey> = {
  hourly: "schedules.frequency.hourly",
  daily: "schedules.frequency.daily",
  weekdays: "schedules.frequency.weekdays",
  weekly: "schedules.frequency.weekly",
  custom: "schedules.frequency.custom",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "09:05" */
export function formatTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

/** "09:05" -> { hour, minute }; null when it is not a valid HH:MM. */
export function parseTime(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function toCron(f: Frequency): string {
  switch (f.kind) {
    case "hourly":
      return `${f.minute} * * * *`;
    case "daily":
      return `${f.minute} ${f.hour} * * *`;
    case "weekdays":
      return `${f.minute} ${f.hour} * * 1-5`;
    case "weekly":
      return `${f.minute} ${f.hour} * * ${f.day}`;
    case "custom":
      return f.cron.trim();
  }
}

const NUM = /^\d{1,2}$/;

function inRange(text: string, max: number): number | null {
  if (!NUM.test(text)) return null;
  const n = Number(text);
  return n <= max ? n : null;
}

/** Detects a preset in a cron string; anything else (and any invalid text) is `custom` with the text kept. */
export function fromCron(cron: string): Frequency {
  const custom: Frequency = { kind: "custom", cron };
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return custom;
  const [min, hour, dom, mon, dow] = f;
  const minute = inRange(min, 59);
  if (minute === null || dom !== "*" || mon !== "*") return custom;
  if (hour === "*" && dow === "*") return { kind: "hourly", minute };
  const h = inRange(hour, 23);
  if (h === null) return custom;
  if (dow === "*") return { kind: "daily", hour: h, minute };
  if (dow === "1-5") return { kind: "weekdays", hour: h, minute };
  const d = inRange(dow, 7);
  if (d === null) return custom;
  return { kind: "weekly", day: d === 7 ? 0 : d, hour: h, minute };
}

/** "Every weekday at 09:00" in the interface language, or the raw cron when no preset fits. */
export function describeCron(cron: string): string {
  const f = fromCron(cron);
  switch (f.kind) {
    case "hourly":
      return t("schedules.describe.hourly", { minute: pad(f.minute) });
    case "daily":
      return t("schedules.describe.daily", { time: formatTime(f.hour, f.minute) });
    case "weekdays":
      return t("schedules.describe.weekdays", { time: formatTime(f.hour, f.minute) });
    case "weekly":
      return t("schedules.describe.weekly", { day: dayName(f.day), time: formatTime(f.hour, f.minute) });
    case "custom":
      return cron.trim();
  }
}

/** A default frequency for each kind, keeping the time the person already picked. */
export function withKind(kind: FrequencyKind, prev: Frequency): Frequency {
  const hour = "hour" in prev ? prev.hour : 9;
  const minute = "minute" in prev ? prev.minute : 0;
  switch (kind) {
    case "hourly":
      return { kind, minute };
    case "daily":
    case "weekdays":
      return { kind, hour, minute };
    case "weekly":
      return { kind, day: "day" in prev ? prev.day : 1, hour, minute };
    case "custom":
      return { kind, cron: prev.kind === "custom" ? prev.cron : toCron(prev) };
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "in 5m", "in 2h", "in 3d" ("in under a minute" below that), in the interface language. A past time reads "now". */
export function formatUntil(timestamp: number, now: number = Date.now()): string {
  const delta = timestamp - now;
  if (delta <= 0) return t("schedules.until.now");
  if (delta < MINUTE_MS) return t("schedules.until.underMinute");
  if (delta < HOUR_MS) return t("schedules.until.minutes", { count: Math.floor(delta / MINUTE_MS) });
  if (delta < DAY_MS) return t("schedules.until.hours", { count: Math.floor(delta / HOUR_MS) });
  return t("schedules.until.days", { count: Math.floor(delta / DAY_MS) });
}
