import path from "node:path";
import { isValidTraceId } from "./config";
import { TRACE_FILE } from "./traceStore";

/** A tab whose data is a file on disk under userData (a trace). */
export interface RevealTarget {
  kind: "trace";
  id: string;
}

/** The storage roots. */
export interface RevealDirs {
  /** `<userData>/browse-traces`; one directory per trace inside. */
  traces: string;
}

export { revealMenuLabel } from "./revealMenuLabel";

/**
 * The file to show and the directory to fall back to, or null for an invalid id
 * (nothing is built from an unvalidated id). A trace's fallback is its own directory
 * (a save in progress has the directory but no `trace.json` yet).
 */
export function revealTargetFor(target: RevealTarget, dirs: RevealDirs): { file: string; dir: string } | null {
  switch (target.kind) {
    case "trace": {
      if (!isValidTraceId(target.id)) return null;
      const dir = path.join(dirs.traces, target.id);
      return { file: path.join(dir, TRACE_FILE), dir };
    }
    default:
      return null;
  }
}

export interface RevealPorts {
  exists(p: string): Promise<boolean>;
  showItemInFolder(p: string): void;
  openPath(p: string): Promise<string>;
  warn?(msg: string): void;
}

/**
 * Shows the target's file in the OS file manager. File missing but directory there: opens the
 * directory. Neither: warns and does nothing. Never throws.
 */
export async function revealInFolder(target: RevealTarget, dirs: RevealDirs, ports: RevealPorts): Promise<void> {
  const warn = (msg: string) => {
    try {
      ports.warn?.(msg);
    } catch {
      // a failing logger must not break the action
    }
  };
  try {
    const where = revealTargetFor(target, dirs);
    if (!where) {
      warn(`reveal: invalid ${target.kind} id`);
      return;
    }
    if (await ports.exists(where.file)) {
      ports.showItemInFolder(where.file);
      return;
    }
    if (await ports.exists(where.dir)) {
      const error = await ports.openPath(where.dir);
      if (error) warn(`reveal: could not open ${where.dir}: ${error}`);
      return;
    }
    warn(`reveal: nothing on disk for ${target.kind} ${target.id}`);
  } catch (err) {
    warn(`reveal failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** `tabbar:tab-menu` payload `{id, x, y}`: a tab id and finite window coordinates, or null. */
export function parseTabMenuPayload(payload: unknown): { id: number; x: number; y: number } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { id, x, y } = payload as { id?: unknown; x?: unknown; y?: unknown };
  if (typeof id !== "number" || !Number.isInteger(id)) return null;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { id, x: Math.round(x), y: Math.round(y) };
}
