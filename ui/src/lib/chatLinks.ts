import { traceOpener } from "@/lib/traceOpener";

export type LinkTarget = { kind: "trace"; id: string } | { kind: "external"; href: string };

/** Decides what a link in a chat message means: a relative `/trace/<id>` link opens a trace tab, anything else is external. */
export function classifyHref(href: string): LinkTarget {
  const trace = /^\/trace\/([^/?#]+)(?:\?[^#]*)?(?:#.*)?$/.exec(href.trim());
  if (trace) {
    try {
      const id = decodeURIComponent(trace[1]);
      if (id) return { kind: "trace", id };
    } catch {
      // A malformed escape is not a trace link.
    }
  }
  return { kind: "external", href };
}

/** Opens a trace in the shell's trace tab. Never throws. */
export function openTraceLink(id: string): void {
  try {
    traceOpener({ id, source: "local" })?.();
  } catch (e) {
    console.error("open trace failed", e);
  }
}
