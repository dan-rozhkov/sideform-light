// Frequency presets of the Schedules editor <-> five-field cron strings (local time), and the human
// description of a cron. Pure. Anything the presets cannot express stays "custom" (the raw cron).

import { currentLocale, t } from "@/i18n";
import { intlLocale, type Language } from "@/i18n/languages";
import { translate, type MessageKey } from "@/i18n/messages";

export type Frequency =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; day: number; hour: number; minute: number }
  | { kind: "custom"; cron: string };

export type FrequencyKind = Frequency["kind"];

/** Name of a cron day-of-week (0 = Sunday) in the interface language (or `locale`), as it reads inside a sentence. */
export function dayName(day: number, locale: string = currentLocale()): string {
  // 2024-01-07 was a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(2024, 0, 7 + (day % 7)));
}

/** Short weekday name with a capital first letter, for a button ("Mon" / "Пн"). */
export function dayShortLabel(day: number): string {
  const locale = currentLocale();
  const name = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2024, 0, 7 + (day % 7)));
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

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

/**
 * "Every weekday at 09:00" in the interface language, or in `language` when given (English for text the model
 * reads), or the raw cron when no preset fits.
 */
export function describeCron(cron: string, language?: Language): string {
  const f = fromCron(cron);
  const say: (key: MessageKey, params: Record<string, string>) => string = language
    ? (key, params) => translate(language, key, params)
    : (key, params) => t(key, params);
  switch (f.kind) {
    case "hourly":
      return say("schedules.describe.hourly", { minute: pad(f.minute) });
    case "daily":
      return say("schedules.describe.daily", { time: formatTime(f.hour, f.minute) });
    case "weekdays":
      return say("schedules.describe.weekdays", { time: formatTime(f.hour, f.minute) });
    case "weekly":
      return say("schedules.describe.weekly", {
        day: dayName(f.day, language ? intlLocale(language) : undefined),
        time: formatTime(f.hour, f.minute),
      });
    case "custom":
      return cron.trim();
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

/**
 * The first run strictly after `now` (ms, local time) of a preset frequency, or null for `custom`
 * (the cron is evaluated by the app, not here) and for a malformed time.
 */
export function nextRunOfFrequency(frequency: Frequency, now: number): number | null {
  if (frequency.kind === "custom") return null;
  const { minute } = frequency;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (frequency.kind === "hourly") {
    const candidate = new Date(now);
    candidate.setMinutes(minute, 0, 0);
    const at = candidate.getTime();
    return at > now ? at : at + HOUR_MS;
  }
  const { hour } = frequency;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + ahead);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= now) continue;
    const day = candidate.getDay();
    if (frequency.kind === "weekdays" && (day === 0 || day === 6)) continue;
    if (frequency.kind === "weekly" && day !== frequency.day) continue;
    return candidate.getTime();
  }
  return null;
}
