import { MESSAGES, type Language, type MessageKey } from "./index";

/** The local shell pages that get their strings over IPC (`shell:i18n`). */
export type ShellPage = "tabbar" | "empty" | "omnibox" | "passwords" | "history";

/** Key prefixes each page needs: a page receives only these keys, not the whole dictionary. */
export const PAGE_PREFIXES: Record<ShellPage, readonly string[]> = {
  tabbar: ["tabbar."],
  empty: ["empty."],
  omnibox: ["omnibox.", "time."],
  passwords: ["passwords."],
  history: ["history."],
};

export interface I18nPayload {
  lang: Language;
  strings: Record<string, string>;
}

/** What main sends a shell page on `shell:i18n`: the active language and the keys of that page. */
export function pagePayload(lang: Language, page: ShellPage): I18nPayload {
  const prefixes = PAGE_PREFIXES[page];
  const table = MESSAGES[lang];
  const strings: Record<string, string> = {};
  for (const key of Object.keys(table) as MessageKey[]) {
    if (prefixes.some((p) => key.startsWith(p))) strings[key] = table[key];
  }
  return { lang, strings };
}
