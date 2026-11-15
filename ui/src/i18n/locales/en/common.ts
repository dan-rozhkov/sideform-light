import type { Message } from "../../types";

/** Shared words and the relative-time labels. Keys are `<namespace>.<name>`. */
export const common = {
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.delete": "Delete",
  "common.retry": "Retry",
  "common.save": "Save",
  "common.loading": "Loading…",
  "time.justNow": "just now",
  "time.minutesAgo": "{count}m ago",
  "time.hoursAgo": "{count}h ago",
  "time.daysAgo": "{count}d ago",
} satisfies Record<string, Message>;
