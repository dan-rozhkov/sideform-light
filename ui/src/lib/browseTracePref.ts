import { onStorageKey } from "@/lib/storageSync";

/** localStorage key: "all" or "qa"; absent (or anything else) = "mcp", the default. */
export const BROWSE_TRACES_KEY = "pen.browseTraces";

/** Which browse_agent runs keep a trace: QA tests only, QA tests and MCP tasks (default), or every run. */
export type TraceMode = "qa" | "mcp" | "all";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
onStorageKey(BROWSE_TRACES_KEY, notify);

function fromRaw(raw: string | null): TraceMode {
  return raw === "all" || raw === "qa" ? raw : "mcp";
}

/** Read at run time, so a change made in the Settings tab applies to the next run. */
export function getTraceMode(): TraceMode {
  try {
    return fromRaw(localStorage.getItem(BROWSE_TRACES_KEY));
  } catch {
    return "mcp";
  }
}

export function setTraceMode(mode: TraceMode): void {
  try {
    if (mode === "mcp") localStorage.removeItem(BROWSE_TRACES_KEY);
    else localStorage.setItem(BROWSE_TRACES_KEY, mode);
  } catch {
    // localStorage unavailable: the setting just doesn't stick.
  }
  notify();
}

/** useSyncExternalStore subscribe: fires on a local set and on another document's write. */
export function subscribeTraceMode(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** QA runs always keep a trace, whatever the mode. */
export function shouldRecordTrace({ qa, mcpTask, mode }: { qa: boolean; mcpTask: boolean; mode: TraceMode }): boolean {
  if (qa || mode === "all") return true;
  return mode === "mcp" && mcpTask;
}
