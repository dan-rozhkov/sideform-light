import type { Language } from "./languages";
import { en } from "./locales/en";
import { de } from "./locales/de";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { ru } from "./locales/ru";
import type { Message, MessageParams, PluralForms } from "./types";

export type MessageKey = keyof typeof en;

/** Every language, bundled: a few hundred short strings each, no lazy loading needed. */
export const MESSAGES: Record<Language, Record<MessageKey, Message>> = { en, ru, de, it, fr };

const pluralRules = new Map<Language, Intl.PluralRules>();

function pickPlural(language: Language, forms: PluralForms, count: number): string {
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  const category = rules.select(count) as keyof PluralForms;
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  return forms[category] ?? forms.other;
}

/**
 * The message for `key` in `language` (English when missing), with `{name}` placeholders filled from
 * `params`. A plural message picks its form from `params.count`.
 */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const message: Message | undefined = MESSAGES[language][key] ?? MESSAGES.en[key];
  if (message === undefined) return key;
  const text = typeof message === "string" ? message : pickPlural(language, message, Number(params?.count ?? 0));
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
