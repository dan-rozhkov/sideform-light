import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

/** Helpers shared by the disk stores (chatStore.ts, traceStore.ts): same on-disk principles, one implementation. */

/** Temp files (`<name>.<pid>.<random>.tmp`) older than this are swept by `list`. */
export const STALE_TMP_MS = 60 * 60 * 1000;

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Runs tasks one after another per key (a per-id promise chain). A task runs whether the previous one
 * resolved or rejected; the entry is dropped once the chain is idle.
 */
export function createKeyedChain(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<unknown>>();
  return function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tail = run.catch(() => undefined);
    chains.set(key, tail);
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return run;
  };
}

/** Best effort: removes `.tmp` files older than STALE_TMP_MS (left by an interrupted write). */
export async function sweepStaleTmp(
  io: StoreFs,
  rootDir: string,
  files: { name: string; mtimeMs: number }[],
  now: () => number,
  label: string,
): Promise<void> {
  for (const f of files) {
    if (!f.name.endsWith(".tmp") || now() - f.mtimeMs <= STALE_TMP_MS) continue;
    try {
      await io.remove(path.join(rootDir, f.name));
    } catch (err) {
      console.error(`${label}: could not sweep ${f.name}: ${message(err)}`);
    }
  }
}

export interface StoreFs {
  /** The file bytes, or null when the file does not exist (ENOENT only; any other failure rejects). */
  read(filePath: string): Promise<Buffer | null>;
  /** Creates parent directories; atomic replace (tmp + rename), mode 0o600. Rejects on failure. */
  write(filePath: string, data: Buffer): Promise<void>;
  /** Files (names, not paths, with mtime in ms) directly in `dir`. A missing `dir` gives []. */
  listFiles(dir: string): Promise<{ name: string; mtimeMs: number }[]>;
  /** Removes a file; a missing one is not an error. */
  remove(filePath: string): Promise<void>;
}

const isErrno = (err: unknown, code: string): boolean =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;

/** Real fs (fs.promises: nothing blocks the main process). */
export const nodeStoreFs: StoreFs = {
  async read(filePath) {
    try {
      return await fsp.readFile(filePath);
    } catch (err) {
      if (isErrno(err, "ENOENT")) return null;
      throw err;
    }
  },
  async write(filePath, data) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    // Unique per write: two writers never share a tmp path.
    const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await fsp.writeFile(tmp, data, { mode: 0o600 });
    await fsp.rename(tmp, filePath);
  },
  async listFiles(dir) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const out: { name: string; mtimeMs: number }[] = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        try {
          out.push({ name: e.name, mtimeMs: (await fsp.stat(path.join(dir, e.name))).mtimeMs });
        } catch {
          // vanished between readdir and stat
        }
      }
      return out;
    } catch (err) {
      if (isErrno(err, "ENOENT")) return [];
      throw err;
    }
  },
  async remove(filePath) {
    await fsp.rm(filePath, { force: true });
  },
};

/** A deleted document: the rev it had when removed. A save at or below that rev is refused. */
