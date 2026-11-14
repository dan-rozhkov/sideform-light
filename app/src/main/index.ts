import fs from "node:fs";
import path from "node:path";
import { app, BaseWindow, ipcMain, net, protocol, safeStorage, session } from "electron";
import { KEEP_RENDERING_WHEN_OCCLUDED_SWITCH } from "./agentActivity";
import { APP_SCHEME, DISPLAY_APP_NAME, isAdBlockDisabledByEnv, resolveBackendOrigin, resolveUiOrigin, resolveUserDataDir } from "./config";
import { APP_SCHEME_PRIVILEGES, buildCsp, resolveAppRequest } from "./localProtocol";
import { createMainWindow, flushAllForQuit, hasQuitFlushWork, isLiveTabbar, type HistoryServices } from "./window";
import { createQuitFlush } from "./quitFlush";
import { UI_ALLOWED_PERMISSIONS, denyAllPermissions, restrictPermissions } from "./browser/permissions";
import { CREDENTIALS_FILE, createCredentialStore, nodeCredentialFs } from "./browser/credentialStore";
import { FAVICONS_FILE, createFaviconCache, createIconFetcher } from "./browser/faviconCache";
import { createLoginCapture } from "./browser/loginCapture";
import { createPasswordsService } from "./passwordsService";
import { HISTORY_FILE, createHistoryStore, nodeHistoryFs } from "./browser/historyStore";
import { createHistoryService } from "./historyService";
import { registerHistorySuggest } from "./historySuggestIpc";
import { shouldReopenMainWindow } from "./closeTarget";
import { getBrowserSettings } from "./browserSettingsInstance";
import { createBrowserSettingsIpc } from "./browserSettingsIpc";
import {
  AD_BLOCK_CACHE_FILE,
  AD_BLOCK_PARTITION,
  createAdBlockController,
  createEngineManager,
  createFixtureBypassRegistry,
  isAdBlockCacheStale,
  loadAdBlockEngine,
  requireRestoringEnv,
  type BlockerPort,
  type WebRequestPort,
} from "./browser/adBlock";

const uiOrigin = resolveUiOrigin(process.env);
const backendOrigin = resolveBackendOrigin(process.env);
/** The bundled ui: `dist/ui` (`__dirname` is `dist/main`, which also holds inside the asar). */
const UI_DIST_DIR = path.join(__dirname, "../ui");

// The `app:` scheme must be registered as privileged BEFORE ready (it is what lets the ui use
// fetch, localStorage and a secure context on it). Served by `protocol.handle` below.
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { ...APP_SCHEME_PRIVILEGES } }]);

// A window covered by another app's window must keep rendering, or the agent's browser tab freezes
// (rAF stops, screenshots come back empty). Must run before ready.
app.commandLine.appendSwitch(KEEP_RENDERING_WHEN_OCCLUDED_SWITCH);

// Storage identity: the app name decides the userData directory AND the safeStorage Keychain item
// ("<name> Safe Storage"), and Chromium takes the latter from the name at ready. Both are fixed here, BEFORE
// ready, so Sideform Light never shares data (or the saved-logins key) with Sideform Desktop.
// e2e overrides the directory (SIDEFORM_LIGHT_USER_DATA_DIR).
app.setName(DISPLAY_APP_NAME);
app.setPath("userData", resolveUserDataDir(process.env) ?? path.join(app.getPath("appData"), DISPLAY_APP_NAME));

// One instance per userData dir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** The one way to open a main window after startup (dock "activate" or a second launch while every window is closed on macOS). */
function openMainWindowIfNone(): void {
  if (shouldReopenMainWindow(BaseWindow.getAllWindows())) createMainWindow(uiOrigin, loginServices, historyServices, browserSettingsIpc, fixtureBypass);
}

app.on("second-instance", () => {
  const win = BaseWindow.getAllWindows()[0];
  if (!win) {
    openMainWindowIfNone();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// Set by before-quit; checked after ready so a quit during startup creates nothing.
let quitting = false;

// Saved logins for the built-in browser — app-scoped: one store (and one "a save prompt is open"
// flag) for the whole app, not one per window. The cipher is Electron's safeStorage (macOS
// Keychain). Passwords exist as plaintext only inside the main process.
const credentialStore = createCredentialStore({
  filePath: path.join(app.getPath("userData"), CREDENTIALS_FILE),
  cipher: {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (cipher) => safeStorage.decryptString(cipher),
  },
});
// Site icons for the Passwords tab: taken from the browser tabs' own favicon
// events and downloaded through their session (window.ts); cached per origin.
const faviconCache = createFaviconCache({
  filePath: path.join(app.getPath("userData"), FAVICONS_FILE),
  fs: nodeCredentialFs,
  fetchIcon: createIconFetcher((url, init) => session.fromPartition("persist:penbrowser").fetch(url, init)),
  isWanted: (origin) => credentialStore.list().some((e) => e.origin === origin),
  // A new icon arrived: an open Passwords tab refreshes its row icons.
  onChange: () => loginServices.passwords.notifyChanged(),
});
const loginServices = {
  credentialStore,
  faviconCache,
  loginCapture: createLoginCapture(credentialStore),
  passwords: createPasswordsService(credentialStore, faviconCache, { ipcMain }),
};

// Browsing history of the built-in browser (address-bar suggestions + the History tab): one store and
// one service for the whole app, like the saved logins. The file loads in the background: the store
// merges what is recorded meanwhile, so window creation never waits for the disk.
const historyStore = createHistoryStore({ filePath: path.join(app.getPath("userData"), HISTORY_FILE), fs: nodeHistoryFs });
const historyServices: HistoryServices = { store: historyStore, service: createHistoryService(historyStore, { ipcMain }) };
// `ipcMain.handle` is process-global: one handler answers the tab bar of every window.
const unregisterHistorySuggest = registerHistorySuggest({ ipcMain, store: historyStore, isTabbar: isLiveTabbar });

// Built-in browser switches (Settings > Browser): one store, and one pair of `browser-settings:*` handlers,
// for the whole app; each window lends its Settings-tab check.
// Windows lend probes: ad blocking passes every request while any has a fixture on the shared browser.
const fixtureBypass = createFixtureBypassRegistry();
const browserSettingsIpc = createBrowserSettingsIpc({ ipcMain, store: getBrowserSettings() });

/**
 * Serves the bundled ui on `app://sideform` (localProtocol.ts decides the file, the MIME type and the CSP).
 * Registered on the default session, the one the agent panel and the trace/settings pages use.
 */
function serveUi(): void {
  const csp = buildCsp(backendOrigin);
  const isFile = (p: string): boolean => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  session.defaultSession.protocol.handle(APP_SCHEME, async (request) => {
    const resolved = resolveAppRequest(request.url, UI_DIST_DIR, isFile);
    if (resolved.status === 404) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    try {
      const body = await fs.promises.readFile(resolved.filePath);
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": resolved.mimeType, "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" },
      });
    } catch {
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  });
}

app.whenReady().then(() => {
  void historyStore.load().catch((err) => console.error("[history] load failed", err));
  // The visible product name (app menu labels, About box); the userData path and the Keychain item
  // name are already fixed above.
  app.setAboutPanelOptions({ applicationName: DISPLAY_APP_NAME });

  // Only the bundled ui may be served this way; with a dev server override nothing is registered.
  if (uiOrigin.startsWith(`${APP_SCHEME}:`)) serveUi();
  // The default session (ui pages): every permission is denied except a sanitized clipboard write.
  restrictPermissions(session.defaultSession, UI_ALLOWED_PERMISSIONS);

  // Built-in browser's dedicated session partition (see window.ts / design
  // doc §1) — a real browser tab with no chrome to ever reveal or revoke a
  // granted permission, so every permission request/check is denied
  // outright (finding 6). `session.fromPartition` needs the app to be
  // ready; `Session` objects for a given partition are singletons within
  // the app, and this must be set once, not per browser tab, so it lives
  // here rather than inside TabManager's per-tab createView.
  denyAllPermissions(session.fromPartition("persist:penbrowser"));

  // Ad and tracker blocking: network requests of the shared browser partition only (no preload, no cosmetic
  // filters: browser tabs stay preload-free). The engine loads in the background; nothing is blocked until then.
  const adBlock = createAdBlockController({
    partition: AD_BLOCK_PARTITION,
    webRequest: session.fromPartition(AD_BLOCK_PARTITION).webRequest as unknown as WebRequestPort,
    shouldBypass: () => fixtureBypass.shouldBypass(),
  });
  adBlock.setEnabled(getBrowserSettings().get().adBlock);
  // SIDEFORM_LIGHT_NO_ADBLOCK=1 (e2e): no engine is ever loaded, so nothing touches the network.
  if (!isAdBlockDisabledByEnv(process.env)) {
    const adBlockCachePath = path.join(app.getPath("userData"), AD_BLOCK_CACHE_FILE);
    const adBlockFs = {
      readFile: (p: string) => fs.promises.readFile(p),
      writeFile: (p: string, d: Uint8Array) => fs.promises.writeFile(p, d),
      mtimeMs: (p: string) => fs.promises.stat(p).then((st) => st.mtimeMs, () => null),
    };
    const loadEngine = (report: (message: string, err: unknown) => void, refresh: boolean) =>
      loadAdBlockEngine<BlockerPort>({
        cachePath: adBlockCachePath,
        fs: adBlockFs,
        log: report,
        refresh,
        // Required lazily, after ready: importing the package sets ELECTRON_DISABLE_SECURITY_WARNINGS
        // for the whole process, which is restored right after the require.
        create: (caching) => {
          const { ElectronBlocker } = requireRestoringEnv(
            process.env,
            "ELECTRON_DISABLE_SECURITY_WARNINGS",
            () => require("@ghostery/adblocker-electron") as typeof import("@ghostery/adblocker-electron"),
          );
          // Chromium networking: the system proxy / PAC and the OS certificate store apply (Node's fetch has neither).
          return ElectronBlocker.fromPrebuiltAdsAndTracking(net.fetch as unknown as typeof fetch, caching) as unknown as Promise<BlockerPort>;
        },
      });
    const engines = createEngineManager<BlockerPort>({
      isEnabled: () => getBrowserSettings().get().adBlock,
      onEngine: (engine) => adBlock.setEngine(engine),
      load: (report) => loadEngine(report, false),
      refresh: (report) => loadEngine(report, true),
      isStale: () => isAdBlockCacheStale({ fs: adBlockFs, cachePath: adBlockCachePath }),
    });
    // Nothing is fetched while blocking is off; turning it on (again) starts or retries the load.
    if (getBrowserSettings().get().adBlock) engines.ensure();
    getBrowserSettings().onChange((s) => {
      adBlock.setEnabled(s.adBlock);
      if (s.adBlock) engines.ensure();
    });
    app.on("will-quit", () => engines.dispose());
  } else {
    getBrowserSettings().onChange((s) => adBlock.setEnabled(s.adBlock));
  }

  app.on("activate", () => {
    openMainWindowIfNone();
  });

  // The user quit during startup: do not create a window behind their back.
  if (quitting) return;

  createMainWindow(uiOrigin, loginServices, historyServices, browserSettingsIpc, fixtureBypass);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Agent panel chats are flushed through the page handshake (`window.penChatsFlush`, panelSenders.ts /
// chatFlush.ts) before the quit goes on; the decision is the pure quitFlush.ts.
const quitFlush = createQuitFlush({ hasWork: hasQuitFlushWork, flushAll: flushAllForQuit, quit: () => app.quit() });
app.on("before-quit", (event) => {
  quitting = true;
  const { firstPass } = quitFlush.onBeforeQuit(event);
  // Once per quit cycle, not on the re-entrant pass after the hold.
  if (firstPass) {
    // Best effort, not awaited: the debounced write may still be pending.
    void historyStore.flush().catch(() => undefined);
  }
});

app.on("will-quit", () => {
  loginServices.passwords.dispose();
  // Synchronous, so the last visit is on disk before the process exits (the async flush above may not finish).
  historyStore.flushSync();
  historyServices.service.dispose();
  browserSettingsIpc.dispose();
  unregisterHistorySuggest();
});
