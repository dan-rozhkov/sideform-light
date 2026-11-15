import { describe, expect, it } from "vitest";

import { describeCron, formatTime, formatUntil, fromCron, parseTime, toCron, withKind, type Frequency } from "../scheduleCron";

describe("scheduleCron", () => {
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

  it("withKind keeps the time and defaults the rest", () => {
    expect(withKind("weekly", { kind: "daily", hour: 6, minute: 20 })).toEqual({ kind: "weekly", day: 1, hour: 6, minute: 20 });
    expect(withKind("hourly", { kind: "daily", hour: 6, minute: 20 })).toEqual({ kind: "hourly", minute: 20 });
    expect(withKind("custom", { kind: "weekdays", hour: 6, minute: 20 })).toEqual({ kind: "custom", cron: "20 6 * * 1-5" });
    expect(withKind("daily", { kind: "custom", cron: "x" })).toEqual({ kind: "daily", hour: 9, minute: 0 });
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
