import { splitTraceAssets, type BrowseTrace } from "@sideform/browser-agent/agent/session";
import { combineSignals } from "@/lib/abortSignals";
import type { BrowseTraceSavePayload, BrowseTraceSaveResult } from "@/lib/desktopBridge";

/** Longest wait for a trace save: a slow shell or network must not hold the tool result. */
export const TRACE_SAVE_TIMEOUT_MS = 15_000;

/** Kept free before the tool's outer timeout: the save must not push the result past it. */
export const TRACE_SAVE_SAFETY_MARGIN_MS = 5_000;

/** Where a saved trace lives: on this machine. Light has no cloud traces. */
export type TraceSource = "local";

export interface SavedTrace {
  id: string;
  source: TraceSource;
}

/** The shell's save function. Undefined on a shell without trace tabs. */
function desktopSave(): ((payload: BrowseTraceSavePayload) => Promise<BrowseTraceSaveResult>) | undefined {
  const panel = window.penAgentPanel?.traces?.save;
  return panel ? panel.bind(window.penAgentPanel!.traces) : undefined;
}

/** True when a trace of this run can be stored: the shell has a save bridge. */
export function canSaveBrowseTrace(): boolean {
  return desktopSave() !== undefined;
}

export interface SaveBrowseTraceOptions {
  /** `Date.now()` value at which the tool's outer timeout ends. The save stops TRACE_SAVE_SAFETY_MARGIN_MS before it. */
  outerEnd?: number;
  /** The run's signal: on Stop the save is abandoned at once. */
  signal?: AbortSignal;
}

/**
 * Stores a finished trace through the shell (it never leaves the machine) and returns where it went.
 * A shell without `traces.save` stores nothing. Bounded by the smaller of
 * TRACE_SAVE_TIMEOUT_MS and the time left before `outerEnd` (minus a margin; none left = no save).
 * A stop, a timeout or a failure only logs and resolves undefined. Never rejects.
 */
export async function saveBrowseTrace(trace: BrowseTrace, options: SaveBrowseTraceOptions = {}): Promise<SavedTrace | undefined> {
  const budget = Math.min(
    TRACE_SAVE_TIMEOUT_MS,
    options.outerEnd === undefined ? TRACE_SAVE_TIMEOUT_MS : options.outerEnd - Date.now() - TRACE_SAVE_SAFETY_MARGIN_MS,
  );
  if (budget <= 0 || options.signal?.aborted) return undefined;
  const stop = new AbortController();
  const signal = combineSignals([stop.signal, options.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const save = async (): Promise<SavedTrace | undefined> => {
      const payload = splitTraceAssets(trace);
      const fn = desktopSave();
      if (!fn) return undefined;
      const out = await fn(payload);
      if ("error" in out) throw new Error(out.error);
      return { id: out.id, source: "local" };
    };
    // Rejects on the timeout or on Stop: the shell call (no signal) is then no longer waited for.
    const gone = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), budget);
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const pending = save();
    pending.catch(() => undefined);
    return await Promise.race([pending, gone]);
  } catch (error) {
    console.warn("[browse trace] not saved:", error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
}
