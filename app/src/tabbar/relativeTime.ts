// Pure relative-time label of the address-bar suggestion popover ("just now", "5 min ago", "3 h ago",
// "yesterday", "12 Oct", "12 Oct 2025"). Its own plain script, loaded before omnibox/renderer.js, like
// urlNormalization.ts: no top-level import/export, so tsc emits a plain global script. The guarded
// assignment at the bottom only lets vitest (Node/CommonJS) import the function.

var RELATIVE_TIME_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The slice of `penI18n` (i18nClient.ts) the label needs; absent = English. */
interface RelativeTimeI18n {
  lang: string;
  tr(key: string, fallback: string, params?: { [name: string]: string | number }): string;
}

/**
 * `then` and `now` are epoch ms. Calendar days are the viewer's local days. A future `then` (clock skew) reads as
 * "just now". `i18n` (the page's `penI18n`) gives the words and the date locale; without it the label is English.
 */
function formatRelativeTime(then: number, now: number, i18n?: RelativeTimeI18n): string {
  var tr = function (key: string, fallback: string, n?: number): string {
    var text = i18n ? i18n.tr(key, fallback) : fallback;
    return n === undefined ? text : text.replace("{n}", String(n));
  };
  var diff = now - then;
  if (!isFinite(diff) || diff < 60 * 1000) return tr("time.justNow", "just now");
  // Under 12 h the elapsed time wins over the calendar: 23:58 -> 00:01 is "3 min ago", not "yesterday".
  var minutes = Math.floor(diff / 60000);
  if (minutes < 60) return tr("time.minutesAgo", "{n} min ago", minutes);
  var hours = Math.floor(minutes / 60);
  if (hours < 12) return tr("time.hoursAgo", "{n} h ago", hours);
  var a = new Date(then);
  var b = new Date(now);
  var dayStart = function (d: Date): number {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  var days = Math.round((dayStart(b) - dayStart(a)) / 86400000);
  if (days <= 0) return tr("time.hoursAgo", "{n} h ago", hours);
  if (days === 1) return tr("time.yesterday", "yesterday");
  // English keeps its fixed "12 Oct" short months; every other language formats the date with its own locale.
  var label =
    !i18n || i18n.lang === "en"
      ? a.getDate() + " " + RELATIVE_TIME_MONTHS[a.getMonth()]
      : new Intl.DateTimeFormat(i18n.lang, { day: "numeric", month: "short" }).format(a);
  return a.getFullYear() === b.getFullYear() ? label : label + " " + a.getFullYear();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports.formatRelativeTime = formatRelativeTime;
}
