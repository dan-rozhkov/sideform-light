// The bundled local backend: a utilityProcess that runs dist/backend/server.mjs (built from
// pen-editor-backend `npm run build:local`). This module is Electron-free: `fork` and the filesystem are
// injected, so the lifecycle (ready wait, restart backoff, kill on quit) is unit-tested with a fake child.
// index.ts wires the real `utilityProcess.fork`, and `localApiProxy.ts` asks it for `{ origin, token }`.
import * as nodeCrypto from "node:crypto";

/** What the manager needs from a forked child (the subset of Electron's `UtilityProcess`). */
export interface BackendChild {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: "message", cb: (message: unknown) => void): unknown;
  on(event: "exit", cb: (code: number) => void): unknown;
  kill(): boolean;
}

export interface BackendForkOptions {
  serviceName: string;
  stdio: "pipe";
  cwd: string;
  env: Record<string, string>;
}

export type BackendFork = (modulePath: string, args: string[], options: BackendForkOptions) => BackendChild;

export interface BackendEndpoint {
  /** `http://127.0.0.1:<port>`. */
  origin: string;
  /** Sent as `X-Sideform-Local-Token` on every request. A new one per launch of the child. */
  token: string;
}

export interface LocalBackendDeps {
  fork: BackendFork;
  /** Absolute path of `server.mjs` (already mapped out of app.asar when packaged). */
  bundlePath: string;
  /** `<userData>/backend`: the child's cwd and `SIDEFORM_LOCAL_DATA_DIR`. */
  dataDir: string;
  /** The process env the allowlist is taken from (`process.env`). */
  baseEnv: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  ensureDir(path: string): void;
  log?(line: string): void;
  warn?(line: string): void;
  /** 32 random bytes as hex by default. */
  newToken?(): string;
  readyTimeoutMs?: number;
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface LocalBackend {
  /** Starts the child. Safe to call once; a missing bundle logs once and leaves the backend unavailable. */
  start(): void;
  /**
   * Resolves with the endpoint once the child is ready; null when it is unavailable or `timeoutMs` passes. After the
   * give-up cool-down (60 s) the next call starts the backend again with a fresh restart budget.
   */
  whenReady(timeoutMs: number): Promise<BackendEndpoint | null>;
  /** Kills the child and stops restarting. */
  stop(): void;
  /** For tests and logs. */
  state(): "idle" | "starting" | "ready" | "unavailable";
}

export const READY_TIMEOUT_MS = 20_000;
export const MAX_RESTARTS_PER_MINUTE = 3;
const RESTART_WINDOW_MS = 60_000;
/** After giving up (too many restarts) the backend stays down this long; the next `whenReady()` then starts it again. */
export const COOL_DOWN_MS = 60_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8_000;

/** Names (upper case) copied from the shell's env into the child's. Anything else, API keys included, stays out. */
const ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LANGUAGE",
  "USER",
  "USERNAME",
  "LOGNAME",
  "TZ",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "HOMEDRIVE",
  "HOMEPATH",
]);

/** The child's env: the allowlisted names of `base` (LC_* too) plus the fixed local-mode settings. */
export function buildChildEnv(base: NodeJS.ProcessEnv, extra: { token: string; dataDir: string }): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (ENV_ALLOWLIST.has(upper) || upper.startsWith("LC_")) env[name] = value;
  }
  env.SIDEFORM_LOCAL = "1";
  env.HOST = "127.0.0.1";
  env.PORT = "0";
  env.SIDEFORM_LOCAL_TOKEN = extra.token;
  env.SIDEFORM_LOCAL_DATA_DIR = extra.dataDir;
  return env;
}

/** The `ready` message of the child: `{ type: "ready", port }` with a TCP port. Returns the port or null. */
export function parseReadyMessage(message: unknown): number | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as { type?: unknown; port?: unknown };
  if (m.type !== "ready") return null;
  return typeof m.port === "number" && Number.isInteger(m.port) && m.port >= 1 && m.port <= 65535 ? m.port : null;
}

/** `server.mjs` of a packaged app is unpacked (`asarUnpack`): map the path out of the archive. */
export function unpackedPath(p: string, isPackaged: boolean): string {
  return isPackaged ? p.replace(/app\.asar(?![.\w])/, "app.asar.unpacked") : p;
}

export function createLocalBackend(deps: LocalBackendDeps): LocalBackend {
  const log = deps.log ?? (() => undefined);
  const warn = deps.warn ?? (() => undefined);
  const newToken = deps.newToken ?? (() => nodeCrypto.randomBytes(32).toString("hex"));
  const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let state: "idle" | "starting" | "ready" | "unavailable" = "idle";
  let stopped = false;
  let child: BackendChild | null = null;
  let endpoint: BackendEndpoint | null = null;
  let readyTimer: unknown = null;
  let restartTimer: unknown = null;
  let restartTimes: number[] = [];
  /** `now()` when the restart budget ran out; null otherwise. */
  let gaveUpAt: number | null = null;
  const waiters = new Set<(value: BackendEndpoint | null) => void>();

  const settle = (value: BackendEndpoint | null): void => {
    for (const w of [...waiters]) w(value);
  };
  const giveUp = (why: string): void => {
    state = "unavailable";
    endpoint = null;
    gaveUpAt = now();
    warn(`[backend] unavailable: ${why}`);
    settle(null);
  };

  const pipeLines = (stream: NodeJS.ReadableStream | null | undefined, write: (line: string) => void): void => {
    if (!stream) return;
    let pending = "";
    stream.on("data", (chunk: Buffer | string) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line !== "") write(`[backend] ${line}`);
    });
    stream.on("end", () => {
      if (pending !== "") write(`[backend] ${pending}`);
      pending = "";
    });
  };

  const launch = (): void => {
    state = "starting";
    endpoint = null;
    const token = newToken();
    let current: BackendChild;
    try {
      deps.ensureDir(deps.dataDir);
      current = deps.fork(deps.bundlePath, [], {
        serviceName: "Sideform Light Backend",
        stdio: "pipe",
        cwd: deps.dataDir,
        env: buildChildEnv(deps.baseEnv, { token, dataDir: deps.dataDir }),
      });
    } catch (err) {
      giveUp(`fork failed: ${String(err)}`);
      return;
    }
    child = current;
    pipeLines(current.stdout, log);
    pipeLines(current.stderr, warn);
    readyTimer = setTimer(() => {
      readyTimer = null;
      if (child !== current || state !== "starting") return;
      warn(`[backend] no ready message in ${readyTimeoutMs} ms, killing it`);
      current.kill();
    }, readyTimeoutMs);
    current.on("message", (message) => {
      if (child !== current || state !== "starting") return;
      const port = parseReadyMessage(message);
      if (port === null) return;
      if (readyTimer !== null) clearTimer(readyTimer);
      readyTimer = null;
      endpoint = { origin: `http://127.0.0.1:${port}`, token };
      state = "ready";
      log(`[backend] ready on port ${port}`);
      settle(endpoint);
    });
    current.on("exit", (code) => {
      if (child !== current) return;
      child = null;
      endpoint = null;
      if (readyTimer !== null) clearTimer(readyTimer);
      readyTimer = null;
      if (stopped) return;
      warn(`[backend] exited unexpectedly (code ${code})`);
      const t = now();
      restartTimes = restartTimes.filter((x) => t - x < RESTART_WINDOW_MS);
      if (restartTimes.length >= MAX_RESTARTS_PER_MINUTE) {
        giveUp(`${MAX_RESTARTS_PER_MINUTE} restarts in a minute, cooling down ${COOL_DOWN_MS / 1000} s`);
        return;
      }
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** restartTimes.length, BACKOFF_MAX_MS);
      restartTimes.push(t);
      state = "starting";
      restartTimer = setTimer(() => {
        restartTimer = null;
        if (!stopped) launch();
      }, delay);
    });
  };

  return {
    start() {
      if (state !== "idle" || stopped) return;
      if (!deps.exists(deps.bundlePath)) {
        warn(`[backend] bundle not found at ${deps.bundlePath} (built with SIDEFORM_LIGHT_SKIP_BACKEND=1?): the local backend is unavailable`);
        state = "unavailable";
        return;
      }
      launch();
    },
    whenReady(timeoutMs) {
      if (state === "ready" && endpoint) return Promise.resolve(endpoint);
      if (state === "unavailable") {
        if (stopped || gaveUpAt === null || now() - gaveUpAt < COOL_DOWN_MS) return Promise.resolve(null);
        // Cool-down over: a fresh restart budget, and this request waits for the new child.
        gaveUpAt = null;
        restartTimes = [];
        log("[backend] cool-down over, starting it again");
        launch();
        if (state === "unavailable") return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        const timer = setTimer(() => {
          waiters.delete(done);
          resolve(null);
        }, timeoutMs);
        const done = (value: BackendEndpoint | null): void => {
          clearTimer(timer);
          waiters.delete(done);
          resolve(value);
        };
        waiters.add(done);
      });
    },
    stop() {
      stopped = true;
      if (readyTimer !== null) clearTimer(readyTimer);
      if (restartTimer !== null) clearTimer(restartTimer);
      readyTimer = null;
      restartTimer = null;
      const c = child;
      child = null;
      endpoint = null;
      if (state !== "unavailable") state = "unavailable";
      settle(null);
      try {
        c?.kill();
      } catch {
        // already gone
      }
    },
    state: () => state,
  };
}
