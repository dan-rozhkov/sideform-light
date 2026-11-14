import { hashString } from "@sideform/browser-agent/loop";
import { desktopBrowserBridge } from "./bridge";

/** Longest session id the desktop shell accepts (`^[A-Za-z0-9_-]{1,64}$`). */
const SESSION_ID_MAX = 64;
const CHAT_HASH_CHARS = 8;
let runCounter = 0;

/** Whether a browse_agent run can get its own browser: the shell exposes `browser.isolated`. Static for a page load. */
export function isolatedBrowseAvailable(): boolean {
  return typeof desktopBrowserBridge()?.isolated === "function";
}

/** Whether the shell's browser can run `qa_assert` / final checks (`browser.assert`). Static for a page load. */
export function browseAssertAvailable(): boolean {
  return typeof desktopBrowserBridge()?.assert === "function";
}

const idSafe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");
const NONCE_CHARS = 6;
const nonce = () => Math.random().toString(36).slice(2, 2 + NONCE_CHARS).padEnd(NONCE_CHARS, "0");

/**
 * The single predicate for "this browse_agent call is an isolated QA run": QA
 * mode, a goal and a shell that can isolate. `resume` does not matter: a QA call
 * with `resume` on an isolating shell continues a scenario in its own session. The hook (do not await) and the handler (take a slot) both use it.
 */
export function isIsolatedQaCall(args: Record<string, unknown>): boolean {
  return (
    args.qa === true &&
    typeof args.goal === "string" &&
    args.goal.trim() !== "" &&
    isolatedBrowseAvailable()
  );
}

/** `<prefix>-<hash of chat>-<tool call id>-<nonce>`, at most 64 chars; an over-long tool call id is cut and ends in its own hash. */
function sessionIdWithPrefix(prefix: string, chatId: string, toolCallId: string | undefined): string {
  const head = `${prefix}-${hashString(chatId).slice(0, CHAT_HASH_CHARS)}-`;
  const suffix = `-${nonce()}`;
  const room = SESSION_ID_MAX - head.length - suffix.length;
  const call = idSafe(toolCallId ?? `${Date.now().toString(36)}${(runCounter++).toString(36)}`);
  if (call.length <= room) return head + call + suffix;
  const tail = hashString(toolCallId ?? call).slice(0, CHAT_HASH_CHARS);
  return `${head}${call.slice(0, room - tail.length - 1)}-${tail}${suffix}`;
}

/**
 * The run's session id: `qa-<hash of chat>-<tool call id>-<nonce>`, at most 64
 * chars, unique per run (the shell treats a closed id as dead for good, so a
 * repeated tool call id must not reuse one). A tool call id too long to fit is
 * cut and ends in its own hash.
 */
export function runSessionId(chatId: string | undefined, toolCallId: string | undefined): string {
  return sessionIdWithPrefix("qa", chatId ?? "no-chat", toolCallId);
}

const MAX_RUN_SESSIONS = 500;
const runSessionsByCall = new Map<string, string>();

/** Remembers which isolated session a `browse_agent` call runs in, so its chip can reveal that tab. Bounded, oldest dropped. */
export function rememberRunSession(toolCallId: string, runSession: string): void {
  runSessionsByCall.delete(toolCallId);
  runSessionsByCall.set(toolCallId, runSession);
  if (runSessionsByCall.size > MAX_RUN_SESSIONS) runSessionsByCall.delete(runSessionsByCall.keys().next().value as string);
}

/** The isolated session of a `browse_agent` call, or undefined (not isolated, or not remembered). */
export function runSessionForCall(toolCallId: string): string | undefined {
  return runSessionsByCall.get(toolCallId);
}
