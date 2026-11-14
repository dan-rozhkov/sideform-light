/**
 * Process-level sender registry and close-flush handshake of the agent panel (`chats:*` storage).
 *
 * Why not "is this the live panel of my window": the panel's last chat save is flushed while the panel
 * closes (`window.penChatsFlush`, see chatFlush.ts). The window's handlers can be gone before the panel's
 * unload handlers run, so the final `chats:save` must be accepted from a webContents that is no longer
 * a live panel. A webContents id therefore stays a panel for `graceMs` after its `destroyed` event
 * (the IPC message of the unload handler reaches main before or just after it). Ids are never reused
 * within a process, so a late entry cannot admit a stranger.
 */

export interface PanelSenderRegistryOptions {
  /** How long an id stays valid after `release`. Default 10 s. */
  graceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface PanelSenderRegistry {
  /** An agent panel: may use chat storage. Cancels a pending release. */
  addPanel(webContentsId: number): void;
  /** The webContents is destroyed: it stays valid for the grace period, then is forgotten. */
  release(webContentsId: number): void;
  isPanel(webContentsId: number): boolean;
}

export const PANEL_SENDER_GRACE_MS = 10_000;

export function createPanelSenderRegistry(opts: PanelSenderRegistryOptions = {}): PanelSenderRegistry {
  const graceMs = opts.graceMs ?? PANEL_SENDER_GRACE_MS;
  const setTimer =
    opts.setTimer ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref?.(); // never keeps the process alive
      return t;
    });
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const panels = new Set<number>();
  const timers = new Map<number, unknown>();

  const cancel = (id: number) => {
    const t = timers.get(id);
    if (t !== undefined) clearTimer(t);
    timers.delete(id);
  };

  return {
    addPanel(id) {
      cancel(id);
      panels.add(id);
    },
    release(id) {
      cancel(id);
      if (!panels.has(id)) return;
      timers.set(
        id,
        setTimer(() => {
          timers.delete(id);
          panels.delete(id);
        }, graceMs),
      );
    },
    isPanel: (id) => panels.has(id),
  };
}

/**
 * Flush handshake with the page. The panel page defines `window.penChatsFlush: () => Promise<void>`:
 * it resolves after its pending chat saves got their `chats:save` reply (at once when nothing is
 * pending) and never rejects. Main runs this script and awaits the returned promise (executeJavaScript
 * awaits it), so when it resolves the save is on disk or failed: no assumption about the order of the
 * script reply and the ipc dispatch.
 */
export const CHATS_FLUSH_SCRIPT = "typeof window.penChatsFlush === 'function' ? window.penChatsFlush() : undefined";

/** Longest wait for one page flush. */
export const FLUSH_TIMEOUT_MS = 3000;

/** Resolves with `promise`'s value, or `undefined` after `ms` (the timer never keeps the process alive). Never rejects. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
    (timer as NodeJS.Timeout).unref?.();
  });
  const safe = promise.then(
    (v) => v,
    () => undefined,
  );
  return Promise.race([safe, timeout]).finally(() => clearTimeout(timer));
}

export interface CloseFlushPort {
  isDestroyed(): boolean;
  /** Runs a script in the page; may reject or never settle. */
  runInPage(script: string): Promise<unknown>;
  close(): void;
}

export interface CloseFlushOptions {
  /** Longest wait for the page flush. Default 3 s. */
  flushTimeoutMs?: number;
  /** Script of the flush handshake. Default `CHATS_FLUSH_SCRIPT`. */
  script?: string;
}

/** Runs the flush handshake in the page, bounded. Never rejects. */
export async function flushPage(
  port: Pick<CloseFlushPort, "isDestroyed" | "runInPage">,
  timeoutMs = FLUSH_TIMEOUT_MS,
  script = CHATS_FLUSH_SCRIPT,
): Promise<void> {
  if (port.isDestroyed()) return;
  let run: Promise<unknown>;
  try {
    run = port.runInPage(script);
  } catch {
    return;
  }
  await withTimeout(run, timeoutMs);
}

/** Closes that are still flushing (a quit waits for these too). */
const pendingCloses = new Set<Promise<void>>();
export function pendingCloseFlushes(): Promise<void>[] {
  return [...pendingCloses];
}

/** Flushes the page, closes. Always closes; never rejects. The flow is registered in `pendingCloseFlushes()`. */
export function flushThenClose(port: CloseFlushPort, opts: CloseFlushOptions = {}): Promise<void> {
  const flow = (async () => {
    try {
      await flushPage(port, opts.flushTimeoutMs, opts.script);
    } finally {
      try {
        if (!port.isDestroyed()) port.close();
      } catch (err) {
        console.error("panel close failed", err);
      }
    }
  })();
  pendingCloses.add(flow);
  void flow.finally(() => pendingCloses.delete(flow));
  return flow;
}

/** The process-wide sender registry (window.ts registers the panel views). */
export const panelSenders = createPanelSenderRegistry();
