// Frequency presets of the Schedules editor <-> five-field cron strings (local time), and the human
// description of a cron. Pure. Anything the presets cannot express stays "custom" (the raw cron).

export type Frequency =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; day: number; hour: number; minute: number }
  | { kind: "custom"; cron: string };

export type FrequencyKind = Frequency["kind"];

/** Index = cron day-of-week (0 = Sunday). */
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const FREQUENCY_LABELS: Record<FrequencyKind, string> = {
  hourly: "Every hour",
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Weekly",
  custom: "Custom cron",
};

export const CUSTOM_CRON_HINT = "Five fields: minute hour day-of-month month day-of-week, local time. Example: 30 8 * * 1-5 is 08:30 on weekdays.";

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

/** "Every weekday at 09:00", or the raw cron when no preset fits. */
export function describeCron(cron: string): string {
  const f = fromCron(cron);
  switch (f.kind) {
    case "hourly":
      return `Every hour at :${pad(f.minute)}`;
    case "daily":
      return `Every day at ${formatTime(f.hour, f.minute)}`;
    case "weekdays":
      return `Every weekday at ${formatTime(f.hour, f.minute)}`;
    case "weekly":
      return `Every ${DAY_NAMES[f.day]} at ${formatTime(f.hour, f.minute)}`;
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

/** "in 5m", "in 2h", "in 3d" ("in under a minute" below that). A past time reads "now". */
export function formatUntil(timestamp: number, now: number = Date.now()): string {
  const delta = timestamp - now;
  if (delta <= 0) return "now";
  if (delta < MINUTE_MS) return "in under a minute";
  if (delta < HOUR_MS) return `in ${Math.floor(delta / MINUTE_MS)}m`;
  if (delta < DAY_MS) return `in ${Math.floor(delta / HOUR_MS)}h`;
  return `in ${Math.floor(delta / DAY_MS)}d`;
}
