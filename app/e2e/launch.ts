import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

type LaunchOptions = NonNullable<Parameters<typeof electron.launch>[0]>;

/** The app plus the agent panel's page (see `launchShell`). */
export type Shell = ElectronApplication & { agentPage: Page };

/**
 * True for the page of the AGENT PANEL of the ui served at `base` (the SIDEFORM_LIGHT_UI_URL the shell was
 * launched with): same origin, path `/agent` or below. Browser tabs at the same origin and the trace/settings
 * pages are not the panel.
 */
export function isAgentPage(url: string, base: string): boolean {
  let u: URL;
  let b: URL;
  try {
    u = new URL(url);
    b = new URL(base);
  } catch {
    return false;
  }
  if (u.origin !== b.origin) return false;
  return u.pathname === "/agent" || u.pathname.startsWith("/agent/");
}

const CRASH_SIGNALS = new Set(["SIGSEGV", "SIGABRT", "SIGBUS", "SIGILL", "SIGFPE", "SIGTRAP"]);

/**
 * Prints a crash of the Electron process to stderr. Playwright itself only reports "Target page,
 * context or browser has been closed" at the next call. Kills on teardown (SIGKILL/SIGTERM) are
 * not crashes and stay silent.
 */
export function reportCrashes(app: ElectronApplication): void {
  const proc = app.process();
  proc.on("exit", (code, signal) => {
    if (signal && CRASH_SIGNALS.has(signal)) console.error(`Electron pid=${proc.pid} crashed with ${signal} (exit code ${code})`);
  });
}

/**
 * Waits, WITHOUT running code in the main process, until the shell's own views exist (the tab bar,
 * the suggestion popover and the empty start, the last view createMainWindow makes) and returns the tab bar page.
 *
 * Why: Node's inspector runs a main-process `app.evaluate` as a V8 interrupt, in the middle of
 * synchronous main code. One that lands while main is constructing a `WebContentsView` crashes
 * Electron with SIGSEGV. Playwright's page list and "window" events come from CDP target events
 * and never interrupt the main process. The wait rejects at once if the app exits.
 */
export async function waitForShellViews(app: ElectronApplication): Promise<Page> {
  const page = async (suffix: string) =>
    app.windows().find((p) => p.url().endsWith(suffix)) ??
    (await app.waitForEvent("window", { predicate: (p) => p.url().endsWith(suffix) }));
  const [tabbar] = await Promise.all([page("/tabbar/tabbar.html"), page("/tabbar/empty.html"), page("/omnibox/omnibox.html")]);
  return tabbar;
}

/**
 * Launches the shell against a stub ui: `options.env.SIDEFORM_LIGHT_UI_URL` (or the process env) points at the
 * suite's own http server, which stands in for the bundled ui (no ui/dist needed). The window starts with ZERO
 * tabs and the agent panel loads `/agent` from that server; this helper waits for the shell views and for the
 * panel page, and returns it as `shell.agentPage` — the page whose `window.penAgentPanel.browser` bridge
 * drives the browser (every browser spec goes through it).
 */
export async function launchShell(options: LaunchOptions): Promise<Shell> {
  const base = String(options.env?.SIDEFORM_LIGHT_UI_URL ?? process.env.SIDEFORM_LIGHT_UI_URL ?? "");
  const app = (await electron.launch(options)) as Shell;
  reportCrashes(app);
  // Listener first: the panel may load while the shell views are still being waited for.
  const waiting = app.windows().find((p) => isAgentPage(p.url(), base)) ?? app.waitForEvent("window", { predicate: (p) => isAgentPage(p.url(), base), timeout: 60_000 });
  Promise.resolve(waiting).catch(() => undefined);
  await waitForShellViews(app);
  app.agentPage = await waiting;
  return app;
}

/** Opens a browser tab the way the tab bar's "+" does (renderer -> `tabbar:new-browser`), so no main-process code runs. */
export async function newBrowserTabViaTabbar(tabbar: Page): Promise<void> {
  await tabbar.evaluate(() => (window as unknown as { penTabbar: { newTab(): void } }).penTabbar.newTab());
}
