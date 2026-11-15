import { describe, expect, it } from "vitest";
import { cronMatches, nextRunAfter, parseCron, type Cron } from "../src/main/schedules/cron";

const cronOf = (expr: string): Cron => {
  const r = parseCron(expr);
  if ("error" in r) throw new Error(`${expr}: ${r.error}`);
  return r.cron;
};
const d = (y: number, mo: number, day: number, h = 0, mi = 0) => new Date(y, mo - 1, day, h, mi);
const next = (expr: string, from: Date) => nextRunAfter(cronOf(expr), from);
const same = (a: Date | null, b: Date) => expect(a?.getTime()).toBe(b.getTime());

describe("parseCron", () => {
  it("accepts the documented forms", () => {
    for (const e of [
      "* * * * *", "0 9 * * *", "*/15 * * * *", "0 9-17 * * 1-5", "0,30 * * * *", "5/10 * * * *", "0-30/10 * * * *",
      "0 0 1 JAN *", "0 0 * * sun", "0 0 * * MON-FRI", "0 0 * jan-mar *", "0 0 * * 7", "0 0 * * 5-7", "  0   9 * * *  ", "0 0 29 2 *", "*/5 */2 */3 */4 */2",
    ]) {
      expect("cron" in parseCron(e), e).toBe(true);
    }
  });

  it("rejects bad expressions with an error message", () => {
    const bad = [
      "", "   ", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * 32 * *", "* * * 0 *", "* * * 13 *", "* * * * 8",
      "5-1 * * * *", "*/0 * * * *", "1-2-3 * * * *", ", * * * *", "1,,2 * * * *", "a * * * *", "* * * FOO *", "* * * * MONDAY", "-1 * * * *", "1- * * * *",
      "*/ * * * *", "*/x * * * *", "1.5 * * * *", "@daily", "0 0 * * * # c", "100 * * * *", "0/0 * * * *", "*-5 * * * *", "?? * * * *",
    ];
    for (const e of bad) {
      const r = parseCron(e);
      expect("error" in r && r.error.length > 0, JSON.stringify(e)).toBe(true);
    }
    expect("error" in parseCron(5 as never)).toBe(true);
    expect("error" in parseCron(undefined as never)).toBe(true);
  });

  it("rejects an expression longer than 100 characters", () => {
    const long = "1" + ",1".repeat(60) + " * * * *";
    expect(long.length).toBeGreaterThan(100);
    expect("error" in parseCron(long)).toBe(true);
    const ok = "0 0 * * *" + " ".repeat(91);
    expect(ok.length).toBe(100);
    expect("cron" in parseCron(ok)).toBe(true);
    expect("error" in parseCron(ok + " ")).toBe(true);
  });
});

describe("cronMatches", () => {
  it("matches minute, hour, day, month and weekday", () => {
    const c = cronOf("30 9 15 6 *");
    expect(cronMatches(c, d(2026, 6, 15, 9, 30))).toBe(true);
    expect(cronMatches(c, d(2026, 6, 15, 9, 31))).toBe(false);
    expect(cronMatches(c, d(2026, 6, 15, 10, 30))).toBe(false);
    expect(cronMatches(c, d(2026, 6, 16, 9, 30))).toBe(false);
    expect(cronMatches(c, d(2026, 7, 15, 9, 30))).toBe(false);
  });
  it("ignores seconds", () => {
    expect(cronMatches(cronOf("0 9 * * *"), new Date(2026, 5, 1, 9, 0, 59, 999))).toBe(true);
  });
  it("steps and lists", () => {
    const c = cronOf("*/20 8,20 * * *");
    expect(cronMatches(c, d(2026, 1, 1, 8, 40))).toBe(true);
    expect(cronMatches(c, d(2026, 1, 1, 20, 0))).toBe(true);
    expect(cronMatches(c, d(2026, 1, 1, 9, 0))).toBe(false);
    expect(cronMatches(c, d(2026, 1, 1, 8, 30))).toBe(false);
    const n = cronOf("5/20 * * * *");
    expect([5, 25, 45].every((m) => cronMatches(n, d(2026, 1, 1, 0, m)))).toBe(true);
    expect(cronMatches(n, d(2026, 1, 1, 0, 4))).toBe(false);
  });
  it("day-of-week: 0 and 7 are both Sunday; names work", () => {
    const sun0 = cronOf("0 0 * * 0");
    const sun7 = cronOf("0 0 * * 7");
    const sunName = cronOf("0 0 * * SUN");
    const sunday = d(2026, 11, 15); // a Sunday
    expect(sunday.getDay()).toBe(0);
    for (const c of [sun0, sun7, sunName]) {
      expect(cronMatches(c, sunday)).toBe(true);
      expect(cronMatches(c, d(2026, 11, 16))).toBe(false);
    }
    const weekdays = cronOf("0 0 * * mon-fri");
    expect(cronMatches(weekdays, d(2026, 11, 16))).toBe(true);
    expect(cronMatches(weekdays, d(2026, 11, 21))).toBe(false);
  });
  it("Vixie rule: both day fields restricted means either one matches", () => {
    const c = cronOf("0 0 13 * 5"); // the 13th OR any Friday
    expect(cronMatches(c, d(2026, 11, 13))).toBe(true); // Friday the 13th
    expect(cronMatches(c, d(2026, 11, 20))).toBe(true); // a Friday
    expect(cronMatches(c, d(2026, 12, 13))).toBe(true); // Sunday the 13th
    expect(cronMatches(c, d(2026, 11, 14))).toBe(false);
  });
  it("one day field restricted: only that one counts", () => {
    expect(cronMatches(cronOf("0 0 13 * *"), d(2026, 11, 20))).toBe(false);
    expect(cronMatches(cronOf("0 0 * * 5"), d(2026, 11, 13))).toBe(true);
    expect(cronMatches(cronOf("0 0 * * 5"), d(2026, 11, 14))).toBe(false);
    // a star-led field keeps the AND rule: every second day, but only Fridays
    expect(cronMatches(cronOf("0 0 */2 * 5"), d(2026, 11, 13))).toBe(true); // 13th is odd (1,3,..): matches */2, and Friday
    expect(cronMatches(cronOf("0 0 */2 * 5"), d(2026, 11, 20))).toBe(false); // Friday, but the 20th is not in 1,3,5..
  });
  it("month names", () => {
    const c = cronOf("0 0 1 JAN,jul *");
    expect(cronMatches(c, d(2026, 1, 1))).toBe(true);
    expect(cronMatches(c, d(2026, 7, 1))).toBe(true);
    expect(cronMatches(c, d(2026, 2, 1))).toBe(false);
  });
});

describe("nextRunAfter", () => {
  it("is strictly after the given minute", () => {
    same(next("* * * * *", d(2026, 3, 10, 12, 0)), d(2026, 3, 10, 12, 1));
    same(next("* * * * *", new Date(2026, 2, 10, 12, 0, 30)), d(2026, 3, 10, 12, 1));
    same(next("0 12 * * *", d(2026, 3, 10, 12, 0)), d(2026, 3, 11, 12, 0));
    same(next("0 12 * * *", d(2026, 3, 10, 11, 59)), d(2026, 3, 10, 12, 0));
  });
  it("finds the next minute within the hour and the next hour", () => {
    same(next("*/15 * * * *", d(2026, 3, 10, 12, 16)), d(2026, 3, 10, 12, 30));
    same(next("*/15 * * * *", d(2026, 3, 10, 12, 46)), d(2026, 3, 10, 13, 0));
    same(next("5 * * * *", d(2026, 3, 10, 23, 30)), d(2026, 3, 11, 0, 5));
  });
  it("rolls over month ends", () => {
    same(next("0 0 * * *", d(2026, 1, 31, 0, 0)), d(2026, 2, 1, 0, 0));
    same(next("0 0 1 * *", d(2026, 1, 31, 12, 0)), d(2026, 2, 1, 0, 0));
    same(next("0 9 31 * *", d(2026, 4, 1)), d(2026, 5, 31, 9, 0)); // April has no 31st
    same(next("0 0 30 * *", d(2026, 1, 31)), d(2026, 3, 30, 0, 0)); // February has no 30th
  });
  it("rolls over the year", () => {
    same(next("0 0 1 1 *", d(2026, 6, 1)), d(2027, 1, 1, 0, 0));
    same(next("59 23 31 12 *", d(2026, 12, 31, 23, 59)), d(2027, 12, 31, 23, 59));
    same(next("30 8 * * *", d(2026, 12, 31, 9, 0)), d(2027, 1, 1, 8, 30));
    same(next("* * * 1 *", d(2026, 12, 31, 23, 59)), d(2027, 1, 1, 0, 0));
  });
  it("Feb 29 waits for the next leap year", () => {
    same(next("0 0 29 2 *", d(2026, 3, 1)), d(2028, 2, 29, 0, 0));
    same(next("0 0 29 2 *", d(2028, 2, 29, 0, 0)), d(2032, 2, 29, 0, 0));
  });
  it("weekday expressions", () => {
    same(next("0 9 * * 1-5", d(2026, 11, 13, 9, 0)), d(2026, 11, 16, 9, 0)); // Friday -> Monday
    same(next("0 9 * * 1-5", d(2026, 11, 15, 12, 0)), d(2026, 11, 16, 9, 0)); // Sunday
    same(next("0 0 * * SUN", d(2026, 11, 15, 0, 0)), d(2026, 11, 22, 0, 0));
    same(next("0 0 13 * 5", d(2026, 11, 14)), d(2026, 11, 20, 0, 0)); // OR rule: the next Friday beats the 13th of December
  });
  it("returns null when the expression never fires", () => {
    expect(next("0 0 31 2 *", d(2026, 1, 1))).toBeNull();
    expect(next("0 0 30 2 *", d(2026, 1, 1))).toBeNull();
    expect(next("0 0 31 4,6,9,11 *", d(2026, 1, 1))).toBeNull();
  });
  it("is fast for rare expressions (no minute-by-minute walk)", () => {
    const t = Date.now();
    for (let i = 0; i < 20; i++) next("0 0 29 2 *", d(2026, 3, 1));
    for (let i = 0; i < 20; i++) next("0 0 31 2 *", d(2026, 3, 1));
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it("always lands on a matching minute after the start, across a year of minutes", () => {
    const c = cronOf("7,37 */5 * * 1-5");
    let cur = d(2026, 1, 1);
    for (let i = 0; i < 500; i++) {
      const n = nextRunAfter(c, cur)!;
      expect(n.getTime()).toBeGreaterThan(cur.getTime());
      expect(cronMatches(c, n)).toBe(true);
      cur = n;
    }
  });
  it("works on local wall-clock time whatever the zone (DST days still progress and match)", () => {
    // Walk a whole year hour by hour; each result must match and be later than its start, even over the DST changes of the host zone.
    const c = cronOf("30 * * * *");
    let cur = d(2026, 1, 1);
    for (let i = 0; i < 24 * 366; i++) {
      const n = nextRunAfter(c, cur)!;
      expect(n.getTime()).toBeGreaterThan(cur.getTime());
      expect(cronMatches(c, n)).toBe(true);
      expect(n.getTime() - cur.getTime()).toBeLessThanOrEqual(3_600_000 * 1.5 + 60_000);
      cur = n;
    }
  });
});
