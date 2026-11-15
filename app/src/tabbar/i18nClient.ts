// Dictionary client of the local shell pages (tab bar, empty start, suggestion popover, Passwords, History). A plain
// global script (no top-level import/export), loaded before each page's own script, like glyphs.ts. These pages cannot
// import the shared modules, so main sends the strings of the page over IPC (`shell:i18n` -> the preload's `onI18n`):
// `{ lang, strings }`, on load and on every language change.
//
// The HTML keeps the English text, so a page is readable before the first message. Static text is marked with
// `data-i18n` (textContent), `data-i18n-title`, `data-i18n-aria-label` and `data-i18n-placeholder` (the value is the key);
// dynamic text goes through `penI18n.tr(key, englishFallback, params)`. The fallback must equal the English locale
// (test/i18n.test.ts pins both). Everything hangs off ONE global, `penI18n`. The guarded assignment at the bottom only
// lets vitest (Node/CommonJS) require it.
var penI18n = (function () {
  var lang = "en";
  var strings: { [key: string]: string } = {};
  var listeners: (() => void)[] = [];

  /** `{name}` placeholders replaced from `params`; one without a param stays as written. */
  function format(template: string, params?: { [name: string]: string | number }): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, function (whole: string, name: string): string {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole;
    });
  }

  /** The text of `key` (the English `fallback` until the dictionary arrives or when the key is missing). */
  function tr(key: string, fallback: string, params?: { [name: string]: string | number }): string {
    var text = Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : fallback;
    return format(text, params);
  }

  /** A plural message: `key.<category>` of the active language's plural rules (`one`, `few`, `many`, `other`). */
  function tn(key: string, count: number, fallbackOne: string, fallbackOther: string): string {
    var category = "other";
    try {
      category = new Intl.PluralRules(lang).select(count);
    } catch {
      // unknown language: other
    }
    var found = Object.prototype.hasOwnProperty.call(strings, key + "." + category) ? strings[key + "." + category] : undefined;
    return format(found !== undefined ? found : count === 1 ? fallbackOne : fallbackOther, { n: count });
  }

  interface Root {
    querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null; setAttribute(name: string, value: string): void; textContent: string | null }>;
  }

  /** Applies the `data-i18n*` attributes under `root` from the current dictionary; a key it does not know leaves the English text. */
  function applyTo(root: Root): void {
    var targets: [string, string | null][] = [
      ["data-i18n", null],
      ["data-i18n-title", "title"],
      ["data-i18n-aria-label", "aria-label"],
      ["data-i18n-placeholder", "placeholder"],
    ];
    for (var i = 0; i < targets.length; i++) {
      var attr = targets[i][0];
      var target = targets[i][1];
      var nodes = root.querySelectorAll("[" + attr + "]");
      for (var j = 0; j < nodes.length; j++) {
        var key = nodes[j].getAttribute(attr);
        if (key === null || !Object.prototype.hasOwnProperty.call(strings, key)) continue;
        if (target === null) nodes[j].textContent = strings[key];
        else nodes[j].setAttribute(target, strings[key]);
      }
    }
  }

  /** The message of main: takes the language and the strings, sets `<html lang>`, re-applies the markup and tells the listeners. */
  function set(payload: unknown): void {
    var p = payload as { lang?: unknown; strings?: unknown } | null;
    if (!p || typeof p.lang !== "string" || !/^[a-z]{2,3}$/.test(p.lang) || typeof p.strings !== "object" || p.strings === null) return;
    var next: { [key: string]: string } = {};
    var raw = p.strings as { [key: string]: unknown };
    for (var key in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, key) && typeof raw[key] === "string") next[key] = raw[key] as string;
    }
    lang = p.lang;
    strings = next;
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      applyTo(document);
    }
    for (var i = 0; i < listeners.length; i++) listeners[i]();
  }

  return {
    format: format,
    tr: tr,
    tn: tn,
    applyTo: applyTo,
    set: set,
    /** The active language code (`en` until main has sent one). */
    get lang(): string {
      return lang;
    },
    /** Runs `cb` after every dictionary message (re-render the dynamic text). */
    onChange: function (cb: () => void): void {
      listeners.push(cb);
    },
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = penI18n;
}
