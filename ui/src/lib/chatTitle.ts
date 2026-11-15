import { t } from "@/i18n";

const MAX_TITLE_LENGTH = 40;

// Markdown leaders that read as noise once hoisted into a plain-text title:
// heading hashes, blockquote markers, and list bullets — each followed by at
// least one space. A slash command (e.g. "/prototype …") is deliberately not
// in this set: it is meaningful on its own and should read as typed.
const MARKDOWN_LEADER = /^(?:#+|>|[-*])\s+/;

/**
 * Derives a short chat title from a user's first message. Returns null when
 * there is no usable text (empty or whitespace-only input) so callers can
 * leave the existing (default) title alone.
 */
export function deriveChatTitle(rawText: string): string | null {
  const text = rawText;
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;

  const collapsed = firstLine.replace(/\s+/g, " ").replace(MARKDOWN_LEADER, "");
  if (!collapsed) return null;

  if (collapsed.length <= MAX_TITLE_LENGTH) {
    return collapsed;
  }

  // Truncate to the last word boundary at or before the limit, so we never
  // cut a word in half.
  const slice = collapsed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = slice.lastIndexOf(" ");
  const truncated = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${truncated}…`;
}

/**
 * The title to show for a chat. A default "Chat N" placeholder is stored (and persisted) as the English
 * text; it is shown in the interface language. A title the user or the first message set shows as is.
 */
export function displayChatTitle(chat: { title: string; titleIsAuto: boolean }): string {
  const m = chat.titleIsAuto ? /^Chat (\d+)$/.exec(chat.title) : null;
  return m ? t("chat.defaultTitle", { number: m[1] }) : chat.title;
}
