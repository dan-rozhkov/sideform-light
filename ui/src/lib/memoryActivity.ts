// What exactly the agent changed in its own memory. One shared shape for both paths that show it: the in-turn
// `memory` tool part (built from the tool INPUT) and the background-review notes (built from the `detail` of
// `GET /api/memory/activity` events). Everything here is pure and parses defensively: tool input is model output.

import { t } from "@/i18n";

export type MemoryChange = {
  kind: "memory";
  target: "memory" | "user";
  action: "add" | "replace" | "remove";
  content?: string;
  oldText?: string;
};

/** Operations the backend cut from an event's detail (it keeps the first 10). */
export type MoreChanges = { kind: "more"; count: number };

export type ChangeDetail = MemoryChange | MoreChanges;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const MEMORY_ACTIONS = ["add", "replace", "remove"] as const;

/** Operations as the `memory` tool takes them (`old_text`) or as the activity endpoint reports them (`oldText`). Unknown shapes are dropped. */
function memoryChanges(target: unknown, operations: unknown): ChangeDetail[] {
  if (!Array.isArray(operations)) return [];
  const tgt = target === "user" ? "user" : "memory";
  const out: ChangeDetail[] = [];
  for (const op of operations) {
    if (!isRecord(op)) continue;
    const action = MEMORY_ACTIONS.find((a) => a === op.action);
    if (!action) continue;
    out.push({ kind: "memory", target: tgt, action, content: str(op.content), oldText: str(op.oldText) ?? str(op.old_text) });
  }
  return out;
}

/** Changes of a `memory` tool call, from its input. */
export function memoryChangesFromInput(input: unknown): ChangeDetail[] {
  if (!isRecord(input)) return [];
  return memoryChanges(input.target, input.operations);
}

/** Changes in one activity event's `detail` (camelCase); anything unrecognized gives []. */
export function changesFromEventDetail(detail: unknown): ChangeDetail[] {
  if (!isRecord(detail) || detail.kind !== "memory") return [];
  const out = memoryChanges(detail.target, detail.operations);
  const more = detail.moreOperations;
  if (typeof more === "number" && Number.isFinite(more) && more > 0) out.push({ kind: "more", count: Math.floor(more) });
  return out;
}

/** One human line for the expanded row, in the current language. */
export function formatChange(c: ChangeDetail): string {
  if (c.kind === "more") return t("memory.change.more", { count: c.count });
  const user = c.target === "user";
  const content = c.content ?? "";
  const old = c.oldText ?? "";
  switch (c.action) {
    case "add":
      return t(user ? "memory.change.addUser" : "memory.change.add", { text: content });
    case "replace":
      return t(user ? "memory.change.replaceUser" : "memory.change.replace", { old, text: content });
    case "remove":
      return t(user ? "memory.change.removeUser" : "memory.change.remove", { text: old });
  }
}

/** The flat list a note shows: its events' changes in key order (numeric ids ascending, then id-less events in arrival order). */
export function noteChangeList(byEvent: Record<string, ChangeDetail[]> | undefined): ChangeDetail[] {
  return byEvent ? Object.values(byEvent).flat() : [];
}

/** Union of two per-event maps; keys already present win. Returns `existing` itself when nothing is new. */
export function mergeChangesByEvent(
  existing: Record<string, ChangeDetail[]> | undefined,
  incoming: Record<string, ChangeDetail[]> | undefined,
): Record<string, ChangeDetail[]> | undefined {
  const fresh = Object.keys(incoming ?? {}).filter((k) => !existing || !(k in existing));
  if (fresh.length === 0) return existing;
  const out = { ...existing };
  for (const k of fresh) out[k] = incoming![k];
  return out;
}

/** Key of an event within a note: its numeric id, else its own content. */
export function eventKey(id: unknown, changes: ChangeDetail[]): string {
  return typeof id === "number" ? String(id) : `noid:${JSON.stringify(changes)}`;
}

/** The `memory` tool answers `{ ok: true }` on a write and `{ ok: false, error }` on a failure, both as a normal output (never a thrown error); the output may be a JSON string. */
export function isMemoryWriteSuccessful(output: unknown): boolean {
  let parsed = output;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return false;
    }
  }
  return typeof parsed === "object" && parsed !== null && (parsed as { ok?: unknown }).ok === true;
}
