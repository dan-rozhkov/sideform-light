import { describe, expect, it, vi } from "vitest";

import { detectLanguage, intlLocale, LANGUAGES, parseLanguage } from "../languages";
import { MESSAGES, translate, type MessageKey } from "../messages";
import type { Message } from "../types";

const placeholders = (m: Message): string[] => {
  const texts = typeof m === "string" ? [m] : Object.values(m).filter((v): v is string => typeof v === "string");
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])))].sort();
};

describe("i18n", () => {
  it("detects the first supported system language", () => {
    expect(detectLanguage(["ru-RU", "en-US"])).toBe("ru");
    expect(detectLanguage(["pt-BR", "de"])).toBe("de");
    expect(detectLanguage(["ja"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });

  it("keeps the regional system tag for Intl formatting", () => {
    const spy = vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CH", "en-GB", "de-CH"]);
    expect(intlLocale("en")).toBe("en-GB");
    expect(intlLocale("de")).toBe("de-CH");
    expect(intlLocale("it")).toBe("it");
    spy.mockRestore();
  });

  it("parses only supported codes", () => {
    expect(parseLanguage("fr")).toBe("fr");
    expect(parseLanguage("es")).toBeNull();
    expect(parseLanguage(null)).toBeNull();
  });

  it("fills placeholders and picks plural forms", () => {
    expect(translate("en", "time.minutesAgo", { count: 5 })).toBe("5m ago");
    expect(translate("ru", "time.minutesAgo", { count: 5 })).toBe("5 мин назад");
  });

  const enKeys = Object.keys(MESSAGES.en) as MessageKey[];

  for (const { code } of LANGUAGES) {
    it(`${code}: every English key is translated, non-empty, with the same placeholders`, () => {
      const messages = MESSAGES[code];
      expect(Object.keys(messages).sort()).toEqual([...enKeys].sort());
      for (const key of enKeys) {
        const m = messages[key];
        const texts = typeof m === "string" ? [m] : Object.values(m);
        for (const text of texts) expect(text, `${code} ${key}`).toBeTruthy();
        // Plural forms may drop {count} ("one" in some languages), so compare against the full set only when present.
        const own = placeholders(m);
        const ref = placeholders(MESSAGES.en[key]);
        expect(own.every((p) => ref.includes(p)), `${code} ${key} has unknown placeholders ${own}`).toBe(true);
        if (typeof m === "string") expect(own, `${code} ${key}`).toEqual(ref);
      }
    });
  }
});
