import type { UIMessage } from "ai";

/**
 * True when some assistant message carries an `ask_user` tool part that has no
 * output yet. The agent's turn is paused on it, so the composer should stay
 * blocked until the user answers — otherwise sending a new message strands the
 * answer (the part is no longer in the last assistant message when it resolves).
 * A part only counts as pending once its `input` has arrived — a form is only
 * "pending" once it can actually be rendered; otherwise an interrupted
 * tool-call stream (no `input` yet) would block the composer with nothing
 * on screen to answer. A part that already resolved to an error
 * (`output-error`, e.g. a schema-invalid call) is not pending either — the
 * SDK considers it settled, so waiting on it would soft-lock the composer.
 */
export function isPendingAskUserPart(part: unknown): boolean {
  const p = part as { type?: string; input?: unknown; state?: string };
  return p.type === "tool-ask_user" && p.input != null && p.state !== "output-available" && p.state !== "output-error";
}

export function hasPendingAskUser(messages: UIMessage[]): boolean {
  return messages.some((m) => m.role === "assistant" && m.parts.some(isPendingAskUserPart));
}

/** The pending ask_user tool call (same rule as `hasPendingAskUser`), newest first. */
export function findPendingAskUser(
  messages: UIMessage[],
): { toolCallId: string; input: { title?: string; questions: unknown[] } } | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (let j = m.parts.length - 1; j >= 0; j -= 1) {
      const p = m.parts[j] as { type?: string; toolCallId?: string; input?: unknown; state?: string };
      if (
        p.type === "tool-ask_user" &&
        typeof p.toolCallId === "string" &&
        p.input != null &&
        p.state !== "output-available" &&
        p.state !== "output-error"
      ) {
        const input = p.input as { title?: string; questions?: unknown };
        return { toolCallId: p.toolCallId, input: { title: input.title, questions: Array.isArray(input.questions) ? input.questions : [] } };
      }
    }
  }
  return undefined;
}
