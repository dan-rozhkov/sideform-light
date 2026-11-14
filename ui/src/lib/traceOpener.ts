import type { SavedTrace } from "@/lib/browseTraces";

/** The in-app link of a saved trace (the shell opens it as a trace tab). */
export function traceLinkHref(id: string, source: SavedTrace["source"] = "local"): string {
  return `/trace/${encodeURIComponent(id)}?src=${source}`;
}

/** How a trace opens: the shell's trace tab through the panel bridge. Undefined without the bridge. */
export function traceOpener(trace: SavedTrace): (() => void) | undefined {
  const open = window.penAgentPanel?.traces?.open;
  return open ? () => void open.call(window.penAgentPanel?.traces, trace.id).catch(() => undefined) : undefined;
}
