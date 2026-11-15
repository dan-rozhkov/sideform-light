import { parseBrowseTrace, type BrowseTrace } from "@sideform/browser-agent/agent/session";
import { t } from "@/i18n";
import type { TraceSource } from "@/lib/browseTraces";

export type TraceLoadResult =
  | { ok: true; trace: BrowseTrace }
  | { ok: false; reason: "not-found" | "invalid" | "no-bridge" | "error"; message: string };

export { traceSourceFromParam } from "@/lib/traceSource";

/** Checks a parsed JSON value against the trace format. */
export function validate(value: unknown): TraceLoadResult {
  const parsed = parseBrowseTrace(value);
  if ("error" in parsed) return { ok: false, reason: "invalid", message: parsed.error };
  return { ok: true, trace: parsed.trace };
}

async function loadLocal(id: string): Promise<TraceLoadResult> {
  const read = window.penDesktop?.traces?.read;
  if (!read) {
    return { ok: false, reason: "no-bridge", message: t("trace.load.noBridge") };
  }
  const value = await read(id);
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") {
    const missing = /not found|no such|missing|enoent/i.test(value.error);
    return { ok: false, reason: missing ? "not-found" : "error", message: value.error };
  }
  if (!value || typeof value !== "object" || !("trace" in value)) {
    return { ok: false, reason: "invalid", message: t("trace.load.unexpected") };
  }
  return validate(value.trace);
}

/** Loads and validates a trace. Never rejects. */
export async function loadBrowseTrace(id: string, _source: TraceSource = "local"): Promise<TraceLoadResult> {
  try {
    return await loadLocal(id);
  } catch (error) {
    return { ok: false, reason: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
