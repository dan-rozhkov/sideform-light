import { useCallback } from "react";

import { intlLocale, type Language } from "./languages";
import { useLanguageStore } from "./languageStore";
import { translate, type MessageKey } from "./messages";
import type { MessageParams } from "./types";

export { LANGUAGES, type Language } from "./languages";
export { installLanguageSync, useLanguageStore } from "./languageStore";
export type { MessageKey } from "./messages";

export type TFunction = (key: MessageKey, params?: MessageParams) => string;

/** Current interface language (React). */
export function useLanguage(): Language {
  return useLanguageStore((s) => s.language);
}

/** `t(key, params)` bound to the current language; the component re-renders when it changes. */
export function useT(): TFunction {
  const language = useLanguage();
  return useCallback((key, params) => translate(language, key, params), [language]);
}

/**
 * Non-React lookup (toasts, helpers called from event handlers) with the language at call time.
 * Never call it at module load: the result would not follow a language switch.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(useLanguageStore.getState().language, key, params);
}

/** The current language's Intl locale tag, for `toLocaleString`, `Intl.DateTimeFormat`, … */
export function currentLocale(): string {
  return intlLocale(useLanguageStore.getState().language);
}
