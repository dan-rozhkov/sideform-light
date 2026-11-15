import { DEFAULT_LANGUAGE, type Language } from "./languages";
import { de } from "./locales/de";
import { en, type MessageKey } from "./locales/en";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { ru } from "./locales/ru";

export { DEFAULT_LANGUAGE, LANGUAGES, detectLanguage, parseLanguage, type Language } from "./languages";
export type { MessageKey } from "./locales/en";

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { en, ru, de, it, fr };

/** `{name}` placeholders replaced from `params`; one that has no param stays as written. */
export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole));
}

/** The text of `key` in `lang` (English when the language is unknown), placeholders filled from `params`. */
export function t(lang: Language, key: MessageKey, params?: Record<string, string | number>): string {
  const table = MESSAGES[lang] ?? MESSAGES[DEFAULT_LANGUAGE];
  return format(table[key] ?? MESSAGES[DEFAULT_LANGUAGE][key], params);
}
