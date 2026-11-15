import type { Translation } from "../../types";
import type { common as en } from "../en/common";

export const common: Translation<typeof en> = {
  "common.cancel": "Abbrechen",
  "common.close": "Schließen",
  "common.copy": "Kopieren",
  "common.copied": "Kopiert",
  "common.delete": "Löschen",
  "common.retry": "Erneut versuchen",
  "common.save": "Speichern",
  "common.loading": "Wird geladen…",
  "time.justNow": "gerade eben",
  "time.minutesAgo": "vor {count} Min.",
  "time.hoursAgo": "vor {count} Std.",
  "time.daysAgo": "vor {count} T.",
};
