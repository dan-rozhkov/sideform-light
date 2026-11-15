import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, LANGUAGES, MESSAGES, detectLanguage, format, parseLanguage, t, type MessageKey } from "../src/main/i18n";
import { en } from "../src/main/i18n/locales/en";
import { PAGE_PREFIXES, pagePayload, type ShellPage } from "../src/main/i18n/pages";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const penI18n = require("../src/tabbar/i18nClient.ts") as {
  format(template: string, params?: Record<string, string | number>): string;
  tr(key: string, fallback: string, params?: Record<string, string | number>): string;
  tn(key: string, count: number, one: string, other: string): string;
  applyTo(root: unknown): void;
  set(payload: unknown): void;
  lang: string;
  onChange(cb: () => void): void;
};

const SRC = resolve(__dirname, "../src");
const read = (rel: string): string => readFileSync(resolve(SRC, rel), "utf8");
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("languages", () => {
  it("supports exactly en, ru, de, it, fr", () => {
    expect([...LANGUAGES]).toEqual(["en", "ru", "de", "it", "fr"]);
    expect(DEFAULT_LANGUAGE).toBe("en");
  });

  it("parseLanguage accepts only the bare supported codes", () => {
    for (const code of LANGUAGES) expect(parseLanguage(code)).toBe(code);
    for (const bad of ["", "RU", "ru-RU", "es", " ru", "zh", null, undefined, 1, {}, ["ru"]]) expect(parseLanguage(bad), String(bad)).toBeNull();
  });

  it("detectLanguage maps region and POSIX tags to the primary language", () => {
    expect(detectLanguage(["ru-RU"])).toBe("ru");
    expect(detectLanguage(["de_AT"])).toBe("de");
    expect(detectLanguage(["fr-CA"])).toBe("fr");
    expect(detectLanguage(["it"])).toBe("it");
    expect(detectLanguage(["en-GB"])).toBe("en");
    expect(detectLanguage(["IT-it"])).toBe("it");
    expect(detectLanguage(["de_DE.UTF-8"])).toBe("de");
  });

  it("takes the first supported tag in preference order and falls back to en", () => {
    expect(detectLanguage(["es-ES", "fr-FR", "ru"])).toBe("fr");
    expect(detectLanguage(["zh-CN", "ja"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
    expect(detectLanguage([undefined, null, "", "ru"])).toBe("ru");
  });
});

describe("t", () => {
  it("fills {name} placeholders", () => {
    expect(t("en", "menu.about", { appName: "Sideform Light" })).toBe("About Sideform Light");
    expect(t("ru", "menu.about", { appName: "Sideform Light" })).toBe("О приложении Sideform Light");
    expect(t("de", "dialog.savePassword.message", { site: "example.com" })).toBe("Passwort für example.com speichern?");
  });

  it("leaves a placeholder without a param as written and takes numbers", () => {
    expect(t("en", "menu.about")).toBe("About {appName}");
    expect(format("{n} of {m}", { n: 3 })).toBe("3 of {m}");
    expect(format("no params")).toBe("no params");
  });

  it("does not treat param values as templates", () => {
    expect(t("en", "menu.about", { appName: "{appName}$&" })).toBe("About {appName}$&");
  });

  it("an unknown language reads English", () => {
    expect(t("xx" as never, "menu.file")).toBe("File");
  });

  it("defaults are the English strings", () => {
    expect(t("en", "menu.newBrowserTab")).toBe("New Browser Tab");
    expect(t("ru", "menu.closeTab")).toBe("Закрыть вкладку");
    expect(t("fr", "menu.history")).toBe("Historique…");
  });
});

describe("locales", () => {
  const keys = Object.keys(en).sort();

  it("every locale has exactly the English keys", () => {
    for (const lang of LANGUAGES) expect(Object.keys(MESSAGES[lang]).sort(), lang).toEqual(keys);
  });

  it("every locale keeps the placeholders of the English text", () => {
    for (const lang of LANGUAGES) {
      for (const key of keys as MessageKey[]) {
        expect(placeholders(MESSAGES[lang][key]), `${lang} ${key}`).toEqual(placeholders(en[key]));
      }
    }
  });

  it("no value is empty or has stray surrounding space", () => {
    for (const lang of LANGUAGES) {
      for (const key of keys as MessageKey[]) {
        const v = MESSAGES[lang][key];
        expect(v.length, `${lang} ${key}`).toBeGreaterThan(0);
        expect(v, `${lang} ${key}`).toBe(v.trim());
      }
    }
  });

  it("other languages are actually translated (no copy of the English text for a whole page)", () => {
    for (const lang of LANGUAGES.filter((l) => l !== "en")) {
      const same = (keys as MessageKey[]).filter((k) => MESSAGES[lang][k] === en[k]);
      // Names that stay (Browser, Zoom, Trace, "{n} h ago" style units, ...) are allowed, a mostly English file is not.
      expect(same.length, `${lang}: ${same.join(", ")}`).toBeLessThan(keys.length * 0.12);
    }
  });

  it("the plural message has every category the language uses", () => {
    for (const lang of LANGUAGES) {
      for (const category of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
        expect(MESSAGES[lang][`passwords.neverLink.${category}` as MessageKey], `${lang} ${category}`).toBeTypeOf("string");
      }
    }
  });
});

describe("page payloads", () => {
  const pages = Object.keys(PAGE_PREFIXES) as ShellPage[];

  it("sends only the keys of the page, with the language", () => {
    const p = pagePayload("ru", "empty");
    expect(p.lang).toBe("ru");
    expect(Object.keys(p.strings).sort()).toEqual(Object.keys(en).filter((k) => k.startsWith("empty.")).sort());
    expect(p.strings["empty.headline"]).toBe("С чего начнём?");
    expect(Object.keys(pagePayload("en", "omnibox").strings).every((k) => k.startsWith("omnibox.") || k.startsWith("time."))).toBe(true);
  });

  it("every renderer-facing key (not menu./tools./dialog./notice.) belongs to some page", () => {
    const covered = new Set(pages.flatMap((page) => Object.keys(pagePayload("en", page).strings)));
    for (const key of Object.keys(en)) {
      const mainOnly = ["menu.", "tools.", "dialog.", "notice."].some((p) => key.startsWith(p));
      expect(covered.has(key) !== mainOnly, key).toBe(true);
    }
  });
});

// ---- the renderers' English defaults must equal the English locale ----

const PAGE_FILES: Record<ShellPage, { html: string; scripts: string[] }> = {
  tabbar: { html: "tabbar/tabbar.html", scripts: ["tabbar/renderer.ts"] },
  empty: { html: "tabbar/empty.html", scripts: ["tabbar/emptyRenderer.ts"] },
  omnibox: { html: "omnibox/omnibox.html", scripts: ["omnibox/renderer.ts", "tabbar/relativeTime.ts"] },
  passwords: { html: "passwords/passwords.html", scripts: ["passwords/renderer.ts", "passwords/helpers.ts"] },
  history: { html: "history/history.html", scripts: ["history/renderer.ts"] },
};

describe.each(Object.entries(PAGE_FILES) as [ShellPage, { html: string; scripts: string[] }][])("%s page", (page, files) => {
  const allowed = (key: string): boolean => PAGE_PREFIXES[page].some((p) => key.startsWith(p));

  it("every data-i18n key exists, belongs to the page and matches the English markup", () => {
    const html = read(files.html);
    const keysSeen: string[] = [];
    // <tag ... data-i18n="key" ...>text</tag>
    for (const m of html.matchAll(/<([a-z0-9]+)\b([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([^<]*)</g)) {
      keysSeen.push(m[3]);
      expect(en[m[3] as MessageKey], m[3]).toBeDefined();
      expect(m[5].trim(), m[3]).toBe(en[m[3] as MessageKey]);
    }
    // data-i18n-title / -aria-label / -placeholder next to the attribute they translate
    for (const m of html.matchAll(/<[^>]+>/g)) {
      for (const [attr, target] of [["data-i18n-title", "title"], ["data-i18n-aria-label", "aria-label"], ["data-i18n-placeholder", "placeholder"]] as const) {
        const key = new RegExp(`${attr}="([^"]+)"`).exec(m[0])?.[1];
        if (!key) continue;
        keysSeen.push(key);
        expect(en[key as MessageKey], key).toBeDefined();
        const shown = new RegExp(`\\s${target}="([^"]*)"`).exec(m[0])?.[1];
        // The sidebar toggle's key is the state-dependent one the renderer re-applies; its markup shows the "hide" text.
        expect(shown, `${key}: ${target}`).toBe(en[key as MessageKey]);
      }
    }
    expect(keysSeen.length).toBeGreaterThan(0);
    for (const key of keysSeen) expect(allowed(key), key).toBe(true);
  });

  it("every penI18n.tr / tr fallback is the English locale text of its key", () => {
    for (const script of files.scripts) {
      const code = read(script);
      for (const m of code.matchAll(/\btr\(\s*"([\w.]+)",\s*"((?:[^"\\]|\\.)*)"/g)) {
        const key = m[1];
        const fallback = JSON.parse(`"${m[2]}"`) as string;
        expect(en[key as MessageKey], `${script}: ${key}`).toBeDefined();
        expect(fallback, `${script}: ${key}`).toBe(en[key as MessageKey]);
        expect(allowed(key), `${script}: ${key}`).toBe(true);
      }
    }
  });
});

describe("penI18n client", () => {
  it("tr uses the dictionary, else the English fallback, and fills params", () => {
    penI18n.set({ lang: "ru", strings: { "a.b": "Привет, {name}" } });
    expect(penI18n.tr("a.b", "Hello, {name}", { name: "Мир" })).toBe("Привет, Мир");
    expect(penI18n.tr("a.missing", "Fallback {x}", { x: 1 })).toBe("Fallback 1");
    expect(penI18n.lang).toBe("ru");
  });

  it("tn picks the plural category of the language", () => {
    penI18n.set({ lang: "ru", strings: { "n.one": "{n} сайт", "n.few": "{n} сайта", "n.many": "{n} сайтов", "n.other": "{n} сайта" } });
    expect(penI18n.tn("n", 1, "1 site", "{n} sites")).toBe("1 сайт");
    expect(penI18n.tn("n", 3, "x", "y")).toBe("3 сайта");
    expect(penI18n.tn("n", 5, "x", "y")).toBe("5 сайтов");
    expect(penI18n.tn("n", 21, "x", "y")).toBe("21 сайт");
    penI18n.set({ lang: "en", strings: {} });
    expect(penI18n.tn("n", 1, "{n} site", "{n} sites")).toBe("1 site");
    expect(penI18n.tn("n", 2, "{n} site", "{n} sites")).toBe("2 sites");
  });

  it("applyTo translates text, title, aria-label and placeholder, leaving unknown keys alone", () => {
    const mk = (attr: string, key: string, text = "English") => {
      const attrs: Record<string, string> = { [attr]: key, title: "t0", "aria-label": "a0", placeholder: "p0" };
      return { getAttribute: (n: string) => attrs[n] ?? null, setAttribute: (n: string, v: string) => void (attrs[n] = v), textContent: text, attrs };
    };
    const nodes = {
      text: mk("data-i18n", "k.text"),
      title: mk("data-i18n-title", "k.title"),
      aria: mk("data-i18n-aria-label", "k.aria"),
      ph: mk("data-i18n-placeholder", "k.ph"),
      unknown: mk("data-i18n", "k.nope"),
    };
    const root = {
      querySelectorAll: (sel: string) => {
        const attr = /\[(.+)\]/.exec(sel)![1];
        return Object.values(nodes).filter((n) => n.attrs[attr] !== undefined);
      },
    };
    penI18n.set({ lang: "de", strings: { "k.text": "Text", "k.title": "Titel", "k.aria": "Beschriftung", "k.ph": "Suche" } });
    penI18n.applyTo(root);
    expect(nodes.text.textContent).toBe("Text");
    expect(nodes.title.attrs.title).toBe("Titel");
    expect(nodes.aria.attrs["aria-label"]).toBe("Beschriftung");
    expect(nodes.ph.attrs.placeholder).toBe("Suche");
    expect(nodes.unknown.textContent).toBe("English");
  });

  it("set ignores a malformed payload and notifies the listeners on a good one", () => {
    let calls = 0;
    penI18n.onChange(() => calls++);
    penI18n.set({ lang: "fr", strings: { x: "y" } });
    expect(calls).toBe(1);
    penI18n.set(null);
    penI18n.set({ lang: 5, strings: {} });
    penI18n.set({ lang: "<script>", strings: {} });
    penI18n.set({ lang: "fr", strings: null });
    expect(calls).toBe(1);
    expect(penI18n.lang).toBe("fr");
    // Non-string values are dropped, not shown.
    penI18n.set({ lang: "it", strings: { ok: "sì", bad: 3 } });
    expect(penI18n.tr("bad", "fallback")).toBe("fallback");
    expect(penI18n.tr("ok", "fallback")).toBe("sì");
  });
});
