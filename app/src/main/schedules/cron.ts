// Five-field cron (`minute hour day-of-month month day-of-week`) in LOCAL time. Pure: no Electron, no clock.
// Field forms: `*`, `n`, `a-b`, `*/n`, `a-b/n`, `n/s` (n..max), comma lists; month names JAN..DEC and day names
// SUN..SAT (case-insensitive); day-of-week 7 = Sunday. Vixie rule: when neither day-of-month nor day-of-week
// starts with `*`, a day matches when EITHER matches; otherwise both must match (a `*` field matches everything).

export const CRON_MAX_LENGTH = 100;
/** `nextRunAfter` gives up when nothing fires within this many years. */
export const CRON_SEARCH_YEARS = 5;

export interface Cron {
  minutes: boolean[];
  hours: boolean[];
  /** Index 1..31 (0 unused). */
  daysOfMonth: boolean[];
  /** Index 1..12 (0 unused). */
  months: boolean[];
  /** Index 0..6, 0 = Sunday. */
  daysOfWeek: boolean[];
  domStar: boolean;
  dowStar: boolean;
}

export type CronParse = { cron: Cron } | { error: string };

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface FieldSpec {
  label: string;
  min: number;
  max: number;
  /** Names map to `nameBase + index`. */
  names?: string[];
  nameBase?: number;
}

function parseValue(token: string, spec: FieldSpec): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  if (spec.names) {
    const i = spec.names.indexOf(token.toUpperCase());
    if (i >= 0) return (spec.nameBase ?? 0) + i;
  }
  return null;
}

/** The set of values a field selects (boolean array indexed by value, size max+1), or an error. */
function parseField(text: string, spec: FieldSpec): { set: boolean[] } | { error: string } {
  const set: boolean[] = new Array<boolean>(spec.max + 1).fill(false);
  const bad = (): { error: string } => ({ error: `Invalid ${spec.label} field "${text.slice(0, 30)}".` });
  if (text === "") return bad();
  for (const part of text.split(",")) {
    const m = /^([^/]+)(?:\/(\d{1,3}))?$/.exec(part);
    if (!m) return bad();
    const [, base, stepText] = m;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) return bad();
    let from: number;
    let to: number;
    if (base === "*") {
      from = spec.min;
      to = spec.label === "day-of-week" ? 6 : spec.max;
    } else {
      const dash = base.split("-");
      if (dash.length > 2) return bad();
      const a = parseValue(dash[0], spec);
      if (a === null) return bad();
      from = a;
      if (dash.length === 2) {
        const b = parseValue(dash[1], spec);
        if (b === null) return bad();
        to = b;
      } else {
        to = stepText === undefined ? a : spec.max;
      }
    }
    if (from < spec.min || to > spec.max || from > to) return bad();
    for (let v = from; v <= to; v += step) set[v] = true;
  }
  return { set };
}

export function parseCron(expr: unknown): CronParse {
  if (typeof expr !== "string") return { error: "The schedule must be text." };
  if (expr.length > CRON_MAX_LENGTH) return { error: `The schedule is longer than ${CRON_MAX_LENGTH} characters.` };
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5 || fields[0] === "") return { error: "A schedule needs 5 fields: minute hour day-of-month month day-of-week." };
  const [min, hour, dom, mon, dow] = fields;
  const rMin = parseField(min, { label: "minute", min: 0, max: 59 });
  if ("error" in rMin) return rMin;
  const rHour = parseField(hour, { label: "hour", min: 0, max: 23 });
  if ("error" in rHour) return rHour;
  const rDom = parseField(dom, { label: "day-of-month", min: 1, max: 31 });
  if ("error" in rDom) return rDom;
  const rMon = parseField(mon, { label: "month", min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 });
  if ("error" in rMon) return rMon;
  const rDow = parseField(dow, { label: "day-of-week", min: 0, max: 7, names: DAY_NAMES, nameBase: 0 });
  if ("error" in rDow) return rDow;
  const daysOfWeek = rDow.set.slice(0, 7);
  if (rDow.set[7]) daysOfWeek[0] = true;
  return {
    cron: {
      minutes: rMin.set,
      hours: rHour.set,
      daysOfMonth: rDom.set,
      months: rMon.set,
      daysOfWeek,
      domStar: dom.startsWith("*"),
      dowStar: dow.startsWith("*"),
    },
  };
}

function dayMatches(cron: Cron, date: Date): boolean {
  const domOk = cron.daysOfMonth[date.getDate()];
  const dowOk = cron.daysOfWeek[date.getDay()];
  return cron.domStar || cron.dowStar ? domOk && dowOk : domOk || dowOk;
}

/** True when `date` (its local minute) is one the expression fires on. */
export function cronMatches(cron: Cron, date: Date): boolean {
  return (
    cron.minutes[date.getMinutes()] &&
    cron.hours[date.getHours()] &&
    cron.months[date.getMonth() + 1] &&
    dayMatches(cron, date)
  );
}

/** `next`, unless it does not move past `cur` (a DST fold): then `cur` + `fallbackMs`, so the search always progresses. */
function forward(cur: Date, next: Date, fallbackMs: number): Date {
  return next.getTime() > cur.getTime() ? next : new Date(cur.getTime() + fallbackMs);
}

/**
 * The first matching local minute strictly after `date`'s minute, or null when none within ~5 years (`0 0 31 2 *`).
 * Skips whole months, days and hours that cannot match instead of walking minute by minute.
 */
export function nextRunAfter(cron: Cron, date: Date): Date | null {
  const limit = new Date(date.getFullYear() + CRON_SEARCH_YEARS, date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()).getTime();
  let cur = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes() + 1);
  if (cur.getTime() <= date.getTime()) cur = new Date(date.getTime() + 60_000);
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  while (cur.getTime() <= limit) {
    if (!cron.months[cur.getMonth() + 1]) {
      cur = forward(cur, new Date(cur.getFullYear(), cur.getMonth() + 1, 1), DAY);
      continue;
    }
    if (!dayMatches(cron, cur)) {
      cur = forward(cur, new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1), HOUR);
      continue;
    }
    if (!cron.hours[cur.getHours()]) {
      cur = forward(cur, new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours() + 1), 60_000);
      continue;
    }
    let minute = cur.getMinutes();
    while (minute < 60 && !cron.minutes[minute]) minute++;
    if (minute >= 60) {
      cur = forward(cur, new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours() + 1), 60_000);
      continue;
    }
    if (minute === cur.getMinutes()) return cur;
    cur = forward(cur, new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours(), minute), 60_000);
  }
  return null;
}
