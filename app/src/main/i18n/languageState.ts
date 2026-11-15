import * as fs from "node:fs";
import { writeFileAtomicSync } from "../storeUtils";
import { detectLanguage, parseLanguage, type Language } from "./languages";

/** `<userData>/ui-language.json` `{ "language": "ru" }`: the language the ui last reported. */
export const LANGUAGE_FILE = "ui-language.json";

export interface LanguageFs {
  readText(filePath: string): string | null;
  /** Atomic replace. Throws on failure. */
  writeText(filePath: string, text: string): void;
}

export const nodeLanguageFs: LanguageFs = {
  readText(filePath) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  },
  writeText(filePath, text) {
    writeFileAtomicSync(filePath, text);
  },
};

export interface LanguageState {
  get(): Language;
  /**
   * The ui reported `value`. An unsupported value or the current language changes nothing (false). Otherwise the
   * language is persisted (best effort: a failed write keeps it for this run), listeners run, and it returns true.
   */
  set(value: unknown): boolean;
  /** Called with the new language after every change. Returns the unsubscribe. */
  onChange(cb: (lang: Language) => void): () => void;
}

export interface LanguageStateOptions {
  filePath: string;
  /** System language tags in preference order (`app.getLocale()`, `app.getPreferredSystemLanguages()`). */
  systemTags: () => readonly (string | undefined)[];
  /** Initial language when no file holds one (SIDEFORM_LIGHT_LANGUAGE: tests pin English with it). */
  forced?: unknown;
  fs?: LanguageFs;
}

/**
 * The interface language of the process. Initial value: the persisted file, else `forced`, else the system language
 * (else English). The ui is the source of truth afterwards: it reports its active language (`<html lang>`) through the
 * panel and the tab pages, and every change is persisted so the next start paints the shell in the right language
 * before the ui has loaded.
 */
export function createLanguageState(opts: LanguageStateOptions): LanguageState {
  const io = opts.fs ?? nodeLanguageFs;
  const read = (): Language | null => {
    const text = io.readText(opts.filePath);
    if (text === null) return null;
    try {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === "object" && parsed !== null ? parseLanguage((parsed as { language?: unknown }).language) : null;
    } catch {
      return null;
    }
  };
  let current: Language = read() ?? parseLanguage(opts.forced) ?? detectLanguage(opts.systemTags());
  const listeners = new Set<(lang: Language) => void>();
  return {
    get: () => current,
    set(value) {
      const next = parseLanguage(value);
      if (next === null || next === current) return false;
      current = next;
      try {
        io.writeText(opts.filePath, JSON.stringify({ language: next }, null, 2) + "\n");
      } catch (err) {
        console.error("[i18n] could not persist the language", err);
      }
      for (const cb of [...listeners]) {
        try {
          cb(next);
        } catch (err) {
          console.error("[i18n] language listener failed", err);
        }
      }
      return true;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
