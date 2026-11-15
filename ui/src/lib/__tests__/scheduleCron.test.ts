import { afterEach, describe, expect, it } from "vitest";

import { useLanguageStore } from "@/i18n";

import { describeCron, formatTime, formatUntil, fromCron, nextRunOfFrequency, parseTime, toCron, type Frequency } from "../scheduleCron";

describe("scheduleCron", () => {
  afterEach(() => useLanguageStore.setState({ language: "en" }));

  it("describes in the interface language, or in the language asked for", () => {
    useLanguageStore.setState({ language: "ru" });
    expect(describeCron("0 9 * * 1-5")).toBe("По будням в 09:00");
    expect(describeCron("0 9 * * 1-5", "en")).toBe("Every weekday at 09:00");
    expect(describeCron("15 18 * * 1", "en")).toBe("Every Monday at 18:15");
  });

  const presets: [Frequency, string, string][] = [
    [{ kind: "hourly", minute: 5 }, "5 * * * *", "Every hour at :05"],
    [{ kind: "daily", hour: 9, minute: 0 }, "0 9 * * *", "Every day at 09:00"],
    [{ kind: "weekdays", hour: 8, minute: 30 }, "30 8 * * 1-5", "Every weekday at 08:30"],
    [{ kind: "weekly", day: 1, hour: 18, minute: 15 }, "15 18 * * 1", "Every Monday at 18:15"],
    [{ kind: "weekly", day: 0, hour: 7, minute: 0 }, "0 7 * * 0", "Every Sunday at 07:00"],
  ];

  it.each(presets)("%j round-trips through %s", (freq, cron, text) => {
    expect(toCron(freq)).toBe(cron);
    expect(fromCron(cron)).toEqual(freq);
    expect(describeCron(cron)).toBe(text);
  });

  it("reads day 7 as Sunday", () => {
    expect(fromCron("0 7 * * 7")).toEqual({ kind: "weekly", day: 0, hour: 7, minute: 0 });
  });

  it.each(["*/15 * * * *", "0 9 1 * *", "0 9 * 1 *", "0 9,17 * * *", "0 9 * * MON", "0 9 * * 1-3", "61 * * * *", "0 24 * * *", "nonsense", "0 9 * *", ""])(
    "falls back to custom for %j",
    (cron) => {
      expect(fromCron(cron)).toEqual({ kind: "custom", cron });
      expect(describeCron(cron)).toBe(cron.trim());
    },
  );

  it("custom produces the trimmed text", () => {
    expect(toCron({ kind: "custom", cron: "  */5 * * * * " })).toBe("*/5 * * * *");
  });

  it("formats and parses times", () => {
    expect(formatTime(9, 5)).toBe("09:05");
    expect(parseTime("09:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("")).toBeNull();
  });

  it("formatUntil", () => {
    expect(formatUntil(1000, 2000)).toBe("now");
    expect(formatUntil(31_000, 1000)).toBe("in under a minute");
    expect(formatUntil(5 * 60_000 + 1000, 1000)).toBe("in 5m");
    expect(formatUntil(3 * 3_600_000 + 1000, 1000)).toBe("in 3h");
    expect(formatUntil(2 * 86_400_000 + 1000, 1000)).toBe("in 2d");
  });
});

describe("nextRunOfFrequency", () => {
  // 2026-03-04 is a Wednesday.
  const at = (day: number, h: number, m: number) => new Date(2026, 2, day, h, m, 0, 0).getTime();
  const now = at(4, 10, 30);

  it("hourly: this hour when the minute is ahead, else the next hour", () => {
    expect(nextRunOfFrequency({ kind: "hourly", minute: 45 }, now)).toBe(at(4, 10, 45));
    expect(nextRunOfFrequency({ kind: "hourly", minute: 30 }, now)).toBe(at(4, 11, 30));
    expect(nextRunOfFrequency({ kind: "hourly", minute: 5 }, now)).toBe(at(4, 11, 5));
  });

  it("daily: today when still ahead, else tomorrow", () => {
    expect(nextRunOfFrequency({ kind: "daily", hour: 18, minute: 0 }, now)).toBe(at(4, 18, 0));
    expect(nextRunOfFrequency({ kind: "daily", hour: 9, minute: 0 }, now)).toBe(at(5, 9, 0));
  });

  it("weekdays: skips the weekend", () => {
    const friday = at(6, 12, 0);
    expect(nextRunOfFrequency({ kind: "weekdays", hour: 9, minute: 0 }, friday)).toBe(at(9, 9, 0));
  });

  it("weekly: the next matching day, a week ahead when it is today and passed", () => {
    expect(nextRunOfFrequency({ kind: "weekly", day: 5, hour: 9, minute: 0 }, now)).toBe(at(6, 9, 0));
    expect(nextRunOfFrequency({ kind: "weekly", day: 3, hour: 9, minute: 0 }, now)).toBe(at(11, 9, 0));
  });

  it("is null for custom and for an out-of-range time", () => {
    expect(nextRunOfFrequency({ kind: "custom", cron: "* * * * *" }, now)).toBeNull();
    expect(nextRunOfFrequency({ kind: "daily", hour: 25, minute: 0 }, now)).toBeNull();
    expect(nextRunOfFrequency({ kind: "hourly", minute: 60 }, now)).toBeNull();
  });
});
