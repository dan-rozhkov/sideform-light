import type { PenAgentPanelApi } from "@/lib/agentPanel";

export type BrowserBridge = NonNullable<PenAgentPanelApi["browser"]>;

// One isolated bridge per run session, dropped by closeBrowserSession.
const isolatedBridges = new Map<string, BrowserBridge>();
// Run sessions already closed (bounded): the shell treats a closed id as dead
// for good, so a straggler call must not revive it through `isolated()`.
const MAX_CLOSED_SESSIONS = 500;
const closedSessions = new Set<string>();
const CLOSED_ERROR = { error: "browser session closed" };
const closedBridge = new Proxy({} as BrowserBridge, {
  get: (_t, key) => (key === "then" || typeof key === "symbol" ? undefined : async () => CLOSED_ERROR),
});

/** The shell's built-in browser: `window.penAgentPanel.browser`. */
export function desktopBrowserBridge(): BrowserBridge | undefined {
  return window.penAgentPanel?.browser;
}

/**
 * The bridge every browse_* handler talks to. `browserSession` (a browse_agent run's id) selects the run's
 * isolated bridge: the shell's `browser.isolated(id, { seedCookies })`. Ignored when isolation is unavailable.
 */
export function getBrowserBridge(_chatId?: string, browserSession?: string, opts?: { seedCookies?: boolean }): BrowserBridge | undefined {
  const desktop = desktopBrowserBridge();
  if (desktop && browserSession && typeof desktop.isolated === "function") {
    if (closedSessions.has(browserSession)) return closedBridge;
    let bridge = isolatedBridges.get(browserSession);
    if (!bridge) {
      // The seed option matters only for the call that creates the bridge (the run's first one).
      bridge = opts?.seedCookies === undefined ? desktop.isolated(browserSession) : desktop.isolated(browserSession, { seedCookies: opts.seedCookies });
      isolatedBridges.set(browserSession, bridge);
    }
    return bridge;
  }
  return desktop;
}

/** Longest wait for the shell to confirm a close: a hung shell must not hold the run (and its slot) forever. */
export const CLOSE_SESSION_TIMEOUT_MS = 15_000;

/** Ends an isolated run's browser. Bounded by CLOSE_SESSION_TIMEOUT_MS; never rejects. */
export async function closeBrowserSession(browserSession: string): Promise<void> {
  closedSessions.add(browserSession);
  if (closedSessions.size > MAX_CLOSED_SESSIONS) closedSessions.delete(closedSessions.values().next().value as string);
  isolatedBridges.delete(browserSession);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      desktopBrowserBridge()?.closeSession?.(browserSession),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_SESSION_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Best effort: the shell also closes a session when its editor tab goes away.
  } finally {
    clearTimeout(timer);
    isolatedBridges.delete(browserSession);
  }
}

/** True when the shell exposes its built-in browser. */
export function isDesktopBrowserAvailable(): boolean {
  return Boolean(desktopBrowserBridge());
}

/** Test-only: forget cached bridges and closed ids. */
export function resetBrowserBridgeCacheForTests(): void {
  isolatedBridges.clear();
  closedSessions.clear();
}
