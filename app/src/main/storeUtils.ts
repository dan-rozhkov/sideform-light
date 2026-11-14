import { promises as fsp, chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

const tmpPathOf = (filePath: string): string => `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

export interface AtomicWriteOptions {
  /** Opt-in: creates the parent directory with this mode and enforces it on an existing one. */
  dirMode?: number;
  /** Opt-in: chmods the tmp file to 0o600 before the rename (the umask and an inherited mode cannot loosen it). */
  chmod?: boolean;
}

/** On Windows a rename over a file another process has open fails with these codes until the handle closes. */
const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_TRIES = 5;
const RENAME_BACKOFF_MS = 20;

const isRetryable = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRY_CODES.has(code);
};

/** Renames, retrying a few times (growing backoff) on EPERM/EBUSY/EACCES only. Other errors and the last failure throw. */
export async function renameWithRetry(
  rename: (from: string, to: string) => Promise<void>,
  from: string,
  to: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (attempt >= RENAME_TRIES || !isRetryable(err)) throw err;
      await sleep(RENAME_BACKOFF_MS * attempt);
    }
  }
}

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Synchronous twin of `renameWithRetry`. */
export function renameWithRetrySync(
  rename: (from: string, to: string) => void,
  from: string,
  to: string,
  wait: (ms: number) => void = sleepSync,
): void {
  for (let attempt = 1; ; attempt++) {
    try {
      return rename(from, to);
    } catch (err) {
      if (attempt >= RENAME_TRIES || !isRetryable(err)) throw err;
      wait(RENAME_BACKOFF_MS * attempt);
    }
  }
}

/**
 * Atomic replace (unique tmp + rename), file mode 0o600, parent directories created. `opts.dirMode` and `opts.chmod`
 * are opt-in extras (the MCP connection and settings files); without them this is the plain store write. The rename
 * is retried on Windows sharing errors. The tmp file is removed when the write fails: a temp file must never be left behind.
 */
export async function writeFileAtomic(filePath: string, data: Buffer | string, opts: AtomicWriteOptions = {}): Promise<void> {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true, ...(opts.dirMode !== undefined ? { mode: opts.dirMode } : {}) });
  // mkdir's mode only applies to a directory it creates.
  if (opts.dirMode !== undefined) await fsp.chmod(dir, opts.dirMode);
  const tmp = tmpPathOf(filePath);
  try {
    await fsp.writeFile(tmp, data, { mode: 0o600 });
    if (opts.chmod) await fsp.chmod(tmp, 0o600);
    await renameWithRetry((from, to) => fsp.rename(from, to), tmp, filePath);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Synchronous twin of `writeFileAtomic` (same contract), for the stores whose API is synchronous. */
export function writeFileAtomicSync(filePath: string, data: Buffer | string, opts: AtomicWriteOptions = {}): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true, ...(opts.dirMode !== undefined ? { mode: opts.dirMode } : {}) });
  if (opts.dirMode !== undefined) chmodSync(dir, opts.dirMode);
  const tmp = tmpPathOf(filePath);
  try {
    writeFileSync(tmp, data, { mode: 0o600 });
    if (opts.chmod) chmodSync(tmp, 0o600);
    renameWithRetrySync(renameSync, tmp, filePath);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best effort
    }
    throw err;
  }
}

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
    await writeFileAtomic(filePath, data);
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
