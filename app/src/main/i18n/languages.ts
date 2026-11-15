/** The interface languages of the shell (and of the ui, whose Language setting is the source of truth). */
export const LANGUAGES = ["en", "ru", "de", "it", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "en";

/** `value` when it is exactly one of the supported codes, else null (no normalisation: the ui sends the bare code). */
export function parseLanguage(value: unknown): Language | null {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value) ? (value as Language) : null;
}

/**
 * The first supported language among BCP 47 / POSIX tags in preference order ("ru-RU" -> "ru", "de_AT" -> "de",
 * "en-GB" -> "en"). Nothing supported (or no tags) -> "en".
 */
export function detectLanguage(tags: readonly (string | null | undefined)[]): Language {
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const primary = tag.trim().toLowerCase().split(/[-_.@]/)[0] ?? "";
    const found = parseLanguage(primary);
    if (found) return found;
  }
  return DEFAULT_LANGUAGE;
}
