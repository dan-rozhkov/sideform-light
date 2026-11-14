/**
 * Which route a page script takes. The default is `webContents.executeJavaScript` (and
 * `executeJavaScriptInIsolatedWorld`): its serialization is the contract of every command, and it
 * waits while a main-frame navigation is pending, so a script never runs on the outgoing or the
 * not yet committed document. It also waits until the page STOPS loading (electron/electron#5183),
 * so one subresource that never completes (an anti-bot challenge, a dead tracker) would time out
 * every command.
 *
 * A tab is "stuck" exactly when all hold:
 * - it is a browser tab showing a real document (not the hidden about:blank placeholder),
 * - tabLoading.ts says it is idle: no main-frame navigation owns the fill any more, i.e. the
 *   last one committed AND reached dom-ready (or failed / stopped), and
 * - Chromium still reports loading (`webContents.isLoading()`): a subresource or a subframe
 *   never finished.
 * Only then scripts go through `WebFrameMain.executeJavaScript` (isolated world: CDP), raced
 * against a timeout. Accepted trade-off: that route serializes differently (see app/CLAUDE.md).
 */
export const STUCK_SCRIPT_TIMEOUT_MS = 10_000;

export interface StuckInput {
  isBrowserTab: boolean;
  placeholderShown: boolean;
  /** tabLoading.ts state: a main-frame navigation still owns the fill. */
  navigationPending: boolean;
  /** webContents.isLoading() */
  chromiumLoading: boolean;
}

export type ScriptRoute = "electron" | "frame";

export function pickScriptRoute(input: StuckInput): ScriptRoute {
  const stuck = input.isBrowserTab && !input.placeholderShown && !input.navigationPending && input.chromiumLoading;
  return stuck ? "frame" : "electron";
}

/** Rejects with a timeout error when `promise` has not settled after `ms`. */
export function withScriptTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Frame script timed out after ${ms}ms.`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
