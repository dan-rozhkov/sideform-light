import type { TraceSource } from "@/lib/browseTraces";

/** `?src=` -> a source. Light has local traces only. */
export function traceSourceFromParam(_value: string | null): TraceSource {
  return "local";
}
