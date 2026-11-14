import { isValidTraceId } from "./config";

/** What `traces:open` needs from the window. Kept as a port so the rule is unit-tested without Electron. */
export interface TraceOpenDeps {
  /** True only for this window's agent panel webContents. */
  isPanel(webContentsId: number): boolean;
  /** The id of the open trace tab showing this trace, or null. */
  findTraceTab(traceId: string): number | null;
  activate(tabId: number, opts: { focus: boolean }): void;
  /** Opens (and shows, with keyboard focus only when `focus`) a trace tab at `/trace/<id>?src=local`; returns its tab id. */
  newTraceTab(traceId: string, opts: { focus: boolean }): number;
}

export type TraceOpenResult = { ok: true } | { ok: false; error: string };

/**
 * `traces:open` (invoke), from the agent panel only: agent-initiated, so the tab is shown without taking
 * keyboard focus. An open tab for the trace is activated; otherwise a new trace tab opens. Never throws.
 */
export function openTraceTab(deps: TraceOpenDeps, senderId: number, traceId: unknown): TraceOpenResult {
  if (!deps.isPanel(senderId)) return { ok: false, error: "traces:open is only allowed from the agent panel" };
  if (!isValidTraceId(traceId)) return { ok: false, error: "invalid trace id" };
  const focus = false;
  try {
    const existing = deps.findTraceTab(traceId);
    if (existing !== null) deps.activate(existing, { focus });
    else deps.newTraceTab(traceId, { focus });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
