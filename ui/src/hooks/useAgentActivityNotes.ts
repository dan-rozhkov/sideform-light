import { useEffect, useRef } from "react";

import { apiFetch } from "@/lib/apiBase";
import { changesFromEventDetail, eventKey, type ChangeDetail } from "@/lib/memoryActivity";
import { useChatStore } from "@/store/chatStore";

// Two delayed checks per finished turn, both scheduled when the turn finishes (not chained). The backend's
// background review is a full model run that can outlast a single 20s check, so a second one ~60s out catches
// it without an unbounded poll loop: a fixed two-request budget per turn.
export const FIRST_CHECK_DELAY_MS = 20_000;
export const SECOND_CHECK_DELAY_MS = 60_000;

// The cursor (last event id read) is per anonymous userId, kept in localStorage so it survives reloads and is shared by
// every chat in this app.
export function cursorKey(userId: string): string {
  return `pen.memoryActivityCursor:${userId}`;
}

function readCursor(userId: string): number | undefined {
  try {
    const raw = localStorage.getItem(cursorKey(userId));
    if (raw === null) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeCursor(userId: string, id: number): void {
  try {
    localStorage.setItem(cursorKey(userId), String(id));
  } catch {
    // Losing persistence only costs an extra baseline call next time.
  }
}

// The backend returns at most this many events per call (while `latestId` is the overall max).
export const ACTIVITY_PAGE_LIMIT = 50;

type ActivityEvent = {
  id?: unknown;
  origin?: unknown;
  subsystem?: unknown;
  chatId?: unknown;
  messageId?: unknown;
  detail?: unknown;
};

// Defensive parse: this is a nice-to-have notification, so a shape we do not recognize means "nothing new".
function parseResponse(data: unknown): { events: ActivityEvent[]; latestId: number | null } | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { events, latestId } = data as { events?: unknown; latestId?: unknown };
  if (!Array.isArray(events)) return undefined;
  if (latestId !== null && typeof latestId !== "number") return undefined;
  return { events: events as ActivityEvent[], latestId };
}

const nonEmptyString = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

type NoteContent = { changesByEvent: Record<string, ChangeDetail[]> };
type TurnGroup = NoteContent & { chatId: string; messageId: string };

// Only `background_review` events of the `memory` subsystem make a row (foreground writes already show as the
// `memory` tool part). Events naming their chat and turn group per turn; the rest (an older backend) go to `legacy`.
function classifyActivity(events: ActivityEvent[]): { legacy: NoteContent | null; groups: TurnGroup[] } {
  let legacy: NoteContent | null = null;
  const groups = new Map<string, TurnGroup>();
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    if (event.origin !== "background_review" || event.subsystem !== "memory") continue;
    const changes = changesFromEventDetail(event.detail);
    const key = eventKey(event.id, changes);
    const chatId = nonEmptyString(event.chatId);
    const messageId = nonEmptyString(event.messageId);
    if (chatId === undefined || messageId === undefined) {
      legacy ??= { changesByEvent: {} };
      legacy.changesByEvent[key] ??= changes;
      continue;
    }
    const gkey = JSON.stringify([chatId, messageId]);
    let g = groups.get(gkey);
    if (!g) groups.set(gkey, (g = { chatId, messageId, changesByEvent: {} }));
    g.changesByEvent[key] ??= changes;
  }
  return { legacy, groups: [...groups.values()] };
}

function buildPath(userId: string, sinceId: number | undefined): string {
  const params = new URLSearchParams({ userId });
  if (sinceId !== undefined) params.set("sinceId", String(sinceId));
  return `/api/memory/activity?${params.toString()}`;
}

/** One check; exported for tests. Resolves when done, never rejects. */
export function checkAgentActivity(userId: string, sessionId: string, afterMessageId: string): Promise<void> {
  const cursor = readCursor(userId);
  return apiFetch(buildPath(userId, cursor))
    .then((res) => (res.ok ? res.json() : null))
    .then((data: unknown) => {
      const parsed = parseResponse(data);
      if (!parsed) return;
      const { events, latestId } = parsed;

      if (cursor === undefined) {
        // Baseline: nothing to compare against, so only record where the timeline ends. Writing 0 for an empty
        // timeline tells "checked, saw nothing yet" from "never checked", so the next check is not a baseline again
        // and cannot swallow the first review's event.
        writeCursor(userId, latestId ?? 0);
        return;
      }

      if (latestId === null || latestId < cursor) {
        // The timeline was reset (ids restarted): the stored cursor is stale. Treat as a fresh baseline.
        writeCursor(userId, latestId ?? 0);
        return;
      }

      const { legacy, groups } = classifyActivity(events);
      const store = useChatStore.getState();

      // Events that name their chat and turn go to THAT chat, anchored to that turn's user message. A chat this app
      // does not hold is skipped. The id is the turn itself, so the 20s and 60s checks give one row (events merge).
      for (const g of groups) {
        if (!store.chats.some((c) => c.id === g.chatId)) continue;
        store.addActivityNote(g.chatId, {
          id: `memory-activity-turn-${JSON.stringify([g.chatId, g.messageId])}`,
          turnMessageId: g.messageId,
          changesByEvent: g.changesByEvent,
        });
      }

      if (legacy) {
        // The anchor was captured when the turn finished, so a message sent meanwhile cannot pull the row elsewhere.
        store.addActivityNote(sessionId, {
          id: `memory-activity-${latestId}`,
          afterMessageId,
          changesByEvent: legacy.changesByEvent,
        });
      }

      // Advance the cursor whether or not a note was added: an event is only lost if never recorded as read.
      // A full page may be truncated: advance only to the max returned id so the next check fetches the rest.
      if (events.length >= ACTIVITY_PAGE_LIMIT) {
        const ids = events.map((e) => (typeof e?.id === "number" ? e.id : -Infinity));
        const maxId = Math.max(...ids);
        writeCursor(userId, Number.isFinite(maxId) ? Math.max(maxId, cursor) : latestId);
      } else {
        writeCursor(userId, latestId);
      }
    })
    .catch(() => {
      // Network error, bad JSON or a backend without the route: never shown.
    });
}

interface UseAgentActivityNotesOptions {
  /** Anonymous client id memory is scoped to; absent disables the check. */
  userId: string | undefined;
  /** True while a turn is in flight; a busy -> idle transition schedules the checks. */
  busy: boolean;
  /** Chat the note is recorded under. */
  sessionId: string;
  /** Reads the latest message id at call time; read once when the turn finishes (the note's anchor). */
  getLastMessageId: () => string | undefined;
}

/**
 * Schedules two delayed checks (20s and 60s after a turn finishes) for memory writes the background review made
 * after the stream closed, and records a UI-only row under the turn when it wrote something. A new turn cancels
 * pending checks (its own checks pick up the events: the cursor only moves on a successful read). Silent on failure.
 */
export function useAgentActivityNotes({ userId, busy, sessionId, getLastMessageId }: UseAgentActivityNotesOptions): void {
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wasBusyRef = useRef(false);

  useEffect(() => {
    const timeouts = timeoutsRef;
    return () => timeouts.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const justFinished = wasBusyRef.current && !busy;
    wasBusyRef.current = busy;
    if (busy) {
      // A new turn started: its own checks will pick up the events (the cursor only moves on a successful read).
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    }
    if (!justFinished || !userId) return;
    const afterMessageId = getLastMessageId();
    if (afterMessageId === undefined) return;

    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [
      setTimeout(() => void checkAgentActivity(userId, sessionId, afterMessageId), FIRST_CHECK_DELAY_MS),
      setTimeout(() => void checkAgentActivity(userId, sessionId, afterMessageId), SECOND_CHECK_DELAY_MS),
    ];
  }, [busy, userId, sessionId, getLastMessageId]);
}
