/** The interface languages Sideform Light ships. The shell (`app/src/main/i18n`) keeps the same list. */
export const LANGUAGES = [
  { code: "en", nativeName: "English" },
  { code: "ru", nativeName: "Русский" },
  { code: "de", nativeName: "Deutsch" },
  { code: "it", nativeName: "Italiano" },
  { code: "fr", nativeName: "Français" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: Language = "en";

/** localStorage key of an explicit choice. Absent: follow the system language. */
export const LANGUAGE_STORAGE_KEY = "ui-language";

const CODES: readonly string[] = LANGUAGES.map((l) => l.code);

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && CODES.includes(value);
}

/** The one parser for a stored/received value: a supported code, else null. */
export function parseLanguage(value: string | null | undefined): Language | null {
  return isLanguage(value) ? value : null;
}

/** First supported language among BCP 47 tags ("ru-RU" -> "ru"), else English. */
export function detectLanguage(tags: readonly string[] | undefined): Language {
  for (const tag of tags ?? []) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}

export function systemLanguage(): Language {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  return detectLanguage(tags);
}

/** Stored choice, else the system language. */
export function getStoredLanguage(): Language {
  try {
    return parseLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY)) ?? systemLanguage();
  } catch {
    return systemLanguage();
  }
}

/** Tag used for Intl formatting (dates, numbers). */
export function intlLocale(language: Language): string {
  if (typeof navigator === "undefined") return language;
  const tags = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
  return tags.find((tag) => tag.split("-")[0]!.toLowerCase() === language) ?? language;
}
