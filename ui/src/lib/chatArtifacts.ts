import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { SavedTrace } from "@/lib/browseTraces";
import { traceOpener } from "@/lib/traceOpener";

/** A browse-run trace a chat's tool calls touched. */
export interface ChatArtifact {
  kind: "trace";
  traceId: string;
  title: string;
}

const FALLBACK_TRACE_TITLE = "Trace";

type Rec = Record<string, unknown>;

const asRecord = (v: unknown): Rec | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined;

/** A tool output is a JSON string or an already-parsed object. Never throws. */
function parseOutput(output: unknown): Rec | undefined {
  if (typeof output !== "string") return asRecord(output);
  try {
    return asRecord(JSON.parse(output));
  } catch {
    return undefined;
  }
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

const oneLine = (v: unknown): string | undefined => {
  const s = nonEmpty(v);
  return s ? s.replace(/\s+/g, " ") : undefined;
};

/**
 * Every trace a chat's tool calls touched (browse_agent results, trace_read / trace_frame). Deduped by id; the most
 * recently referenced comes first; a fallback title never beats a real one. Pure and defensive: malformed parts are
 * skipped, never thrown on.
 */
export function collectChatArtifacts(messages: UIMessage[]): ChatArtifact[] {
  const byId = new Map<string, { artifact: ChatArtifact; fallback: boolean }>();
  const add = (traceId: string, title: string | undefined) => {
    const fallback = title === undefined;
    const existing = byId.get(traceId);
    if (!existing) byId.set(traceId, { artifact: { kind: "trace", traceId, title: title ?? FALLBACK_TRACE_TITLE }, fallback });
    else if (existing.fallback && !fallback) {
      existing.artifact.title = title;
      existing.fallback = false;
    }
  };

  for (let m = messages.length - 1; m >= 0; m--) {
    const parts = messages[m]?.parts;
    if (!Array.isArray(parts)) continue;
    for (let p = parts.length - 1; p >= 0; p--) {
      try {
        const part = parts[p] as unknown as Rec;
        if (!isToolUIPart(part as never)) continue;
        const toolName = getToolName(part as never);
        const done = part.state === "output-available";
        const input = asRecord(part.input);
        const out = done ? parseOutput(part.output) : undefined;
        if (toolName === "browse_agent") {
          const trace = asRecord(out?.trace);
          if (trace && typeof trace.id === "string" && trace.id !== "") add(trace.id, oneLine(input?.goal));
        } else if (toolName === "trace_read" || toolName === "trace_frame") {
          const id = nonEmpty(input?.traceId);
          if (done && out?.error === undefined && id) add(id, oneLine(out?.goal));
        }
      } catch {
        // A malformed part must not break the list.
      }
    }
  }
  return [...byId.values()].map((e) => e.artifact);
}

export interface OpenContext {
  openTrace?: (trace: SavedTrace) => (() => void) | undefined;
}

/** Opens a trace in the shell's trace tab. Never throws: a click on a stale row does nothing. */
export function openChatArtifact(artifact: ChatArtifact, ctx: OpenContext = { openTrace: traceOpener }): void {
  try {
    ctx.openTrace?.({ id: artifact.traceId, source: "local" })?.();
  } catch {
    // Swallowed on purpose.
  }
}
