/**
 * Runs a script in a named isolated JS world of the tab's main frame over CDP, for a tab whose load
 * never finishes (see scriptRoute.ts): `webContents.executeJavaScriptInIsolatedWorld` waits for the
 * load to end (electron/electron#5183). `Page.createIsolatedWorld` + `Runtime.evaluate` with that
 * context id has no such gate and needs no `Runtime.enable` (same recipe as browser/loginCapture.ts).
 *
 * The frame id and the world's context id are cached per main-frame document, so one eval is one
 * `Runtime.evaluate`; `onCdpEvent` drops them on every main-frame `Page.frameNavigated`. A context
 * that died anyway (cross-process swap racing the event) is recreated once.
 * Pure: the debugger session is the injected `send`.
 */
import type { CdpSend } from "./browser/loginCapture";

export type { CdpSend };

interface EvalResult {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

export function createIsolatedEvaluator(send: CdpSend, worldName: string) {
  let frameId: string | null = null;
  let contextId: number | null = null;

  const invalidate = () => {
    frameId = null;
    contextId = null;
  };

  async function ensureContext(): Promise<number> {
    if (contextId !== null) return contextId;
    if (frameId === null) {
      const tree = (await send("Page.getFrameTree")) as { frameTree?: { frame?: { id?: string } } };
      const id = tree.frameTree?.frame?.id;
      if (typeof id !== "string") throw new Error("Frame no longer exists.");
      frameId = id;
    }
    const world = (await send("Page.createIsolatedWorld", { frameId, worldName })) as { executionContextId?: number };
    if (typeof world.executionContextId !== "number") throw new Error("Could not create the isolated world.");
    contextId = world.executionContextId;
    return contextId;
  }

  async function runOnce(code: string): Promise<unknown> {
    const id = await ensureContext();
    const res = (await send("Runtime.evaluate", { expression: code, contextId: id, awaitPromise: true, returnByValue: true })) as EvalResult;
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "Script threw an exception.");
    }
    return res.result?.value;
  }

  return {
    async evaluate(code: string): Promise<unknown> {
      try {
        return await runOnce(code);
      } catch (err) {
        // A stale context/frame: forget both and retry once with a fresh world.
        const stale = contextId !== null && /context|frame|target/i.test(err instanceof Error ? err.message : String(err));
        if (!stale) throw err;
        invalidate();
        return runOnce(code);
      }
    },
    /** Feed every CDP event of the tab's session. */
    onCdpEvent(method: string, params: unknown): void {
      if (method !== "Page.frameNavigated") return;
      const frame = (params as { frame?: { parentId?: string } } | undefined)?.frame;
      if (frame && frame.parentId === undefined) invalidate();
    },
  };
}
