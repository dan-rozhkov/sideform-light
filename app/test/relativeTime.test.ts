import { describe, expect, it } from "vitest";

// relativeTime.ts is a plain global script (see its header); it is loaded with require like urlNormalization.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { formatRelativeTime } = require("../src/tabbar/relativeTime.ts") as { formatRelativeTime(then: number, now: number): string };

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 10, 24, 15, 0);

describe("formatRelativeTime", () => {
  it("under a minute and the future read as just now", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW + 5 * 60_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NaN, NOW)).toBe("just now");
  });
  it("minutes and hours the same day", () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe("1 min ago");
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe("59 min ago");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
  });
  it("the previous calendar day is yesterday, even under 24 hours", () => {
    expect(formatRelativeTime(at(2026, 10, 23, 23, 0), NOW)).toBe("yesterday");
    expect(formatRelativeTime(at(2026, 10, 23, 0, 5), NOW)).toBe("yesterday");
  });
  it("across midnight, short spans stay minutes and hours (23:58 -> 00:01)", () => {
    const now = at(2026, 10, 24, 0, 1);
    expect(formatRelativeTime(at(2026, 10, 23, 23, 58), now)).toBe("3 min ago");
    expect(formatRelativeTime(at(2026, 10, 23, 23, 2), now)).toBe("59 min ago");
    expect(formatRelativeTime(at(2026, 10, 23, 20, 1), now)).toBe("4 h ago");
    expect(formatRelativeTime(at(2026, 10, 23, 11, 30), now)).toBe("yesterday");
  });
  it("12 hours or more and a different calendar day is yesterday", () => {
    expect(formatRelativeTime(at(2026, 10, 23, 15, 0), NOW)).toBe("yesterday");
    expect(formatRelativeTime(NOW - 11 * 3_600_000 - 59 * 60_000, NOW)).toBe("11 h ago");
  });
  it("older days show day and month; another year adds the year", () => {
    expect(formatRelativeTime(at(2026, 10, 12, 9), NOW)).toBe("12 Oct");
    expect(formatRelativeTime(at(2026, 1, 3, 9), NOW)).toBe("3 Jan");
    expect(formatRelativeTime(at(2025, 12, 31, 9), NOW)).toBe("31 Dec 2025");
  });
});

describe("formatRelativeTime in another language", () => {
  const ru = {
    lang: "ru",
    tr: (key: string, fallback: string) =>
      ({ "time.justNow": "только что", "time.minutesAgo": "{n} мин назад", "time.hoursAgo": "{n} ч назад", "time.yesterday": "вчера" })[key] ?? fallback,
  };
  const withI18n = formatRelativeTime as (then: number, now: number, i18n?: typeof ru) => string;
  it("uses the dictionary words and the locale's date", () => {
    expect(withI18n(NOW - 10_000, NOW, ru)).toBe("только что");
    expect(withI18n(NOW - 5 * 60_000, NOW, ru)).toBe("5 мин назад");
    expect(withI18n(NOW - 3 * 3_600_000, NOW, ru)).toBe("3 ч назад");
    expect(withI18n(at(2026, 10, 23, 15, 0), NOW, ru)).toBe("вчера");
    expect(withI18n(at(2026, 10, 12, 9), NOW, ru)).toMatch(/^12 окт/);
    expect(withI18n(at(2025, 12, 31, 9), NOW, ru)).toMatch(/^31 дек.* 2025$/);
  });
  it("English language keeps the fixed English months", () => {
    expect(withI18n(at(2026, 9, 12, 9), NOW, { ...ru, lang: "en", tr: (_k: string, f: string) => f })).toBe("12 Sep");
  });
});
