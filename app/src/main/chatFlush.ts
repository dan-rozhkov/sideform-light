/**
 * Quit hold of chat storage (`chats:*`). The panel page defines `window.penChatsFlush` (panelSenders.ts
 * `CHATS_FLUSH_SCRIPT`); on quit main flushes every open agent panel in parallel (bounded per page) and waits
 * for panel closes that are still flushing, in one hold.
 */
import { flushPage, FLUSH_TIMEOUT_MS, CHATS_FLUSH_SCRIPT, type CloseFlushPort } from "./panelSenders";

export { CHATS_FLUSH_SCRIPT };

/** Runs the chat flush handshake in a panel page, bounded. Never rejects. */
export function flushPanelChats(port: Pick<CloseFlushPort, "isDestroyed" | "runInPage">, timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  return flushPage(port, timeoutMs, CHATS_FLUSH_SCRIPT);
}

export interface QuitFlushParts {
  /** A panel close that is still flushing. */
  hasPendingCloses(): boolean;
  /** Number of agent panels that can hold unsaved chats. */
  panelCount(): number;
  flushPendingCloses(): Promise<unknown>;
  flushPanels(): Promise<unknown>;
}

/** The quit hold covers agent panels AND panel closes still flushing. */
export function hasQuitWork(parts: Pick<QuitFlushParts, "hasPendingCloses" | "panelCount">): boolean {
  return parts.hasPendingCloses() || parts.panelCount() > 0;
}

/** Flushes the open panels and waits for pending closes in parallel; one failing never blocks the other. Never rejects. */
export async function flushQuitWork(parts: Pick<QuitFlushParts, "flushPendingCloses" | "flushPanels">): Promise<void> {
  const run = (f: () => Promise<unknown>): Promise<unknown> => {
    try {
      return f();
    } catch (err) {
      return Promise.reject(err);
    }
  };
  await Promise.allSettled([run(parts.flushPendingCloses), run(parts.flushPanels)]);
}
