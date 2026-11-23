import { contextBridge, ipcRenderer } from "electron";

// The interface languages (src/main/i18n/languages.ts; a sandboxed preload cannot import it). Main validates again.
const SUPPORTED_LANGUAGES: string[] = ["en", "ru", "de", "it", "fr"];

// The agent panel's bridge. The panel's browser tools run here: its OWN browser bridge over
// `browser:command` (main accepts the panel's webContents as the only browser owner), chat storage on disk,
// trace storage and the Settings opener. No MCP, no menu, nothing else.
//
// Built-in browser bridge (design doc `2026-09-18-builtin-browser-design.md`
// §5) — each call is a plain request/response over "browser:command". No
// validation here: main (src/main/window.ts's "browser:command" handler,
// BrowserController) is the trust boundary and validates everything, since
// these arguments ultimately come from an LLM tool call.
// `session` undefined = the shared browser (payload identical to what it always
// was); a string = one isolated session (docs/superpowers/specs/
// 2026-10-17-isolated-parallel-browse-design.md). Main validates the id.
// `isolated(undefined)` must NOT fall back to the shared browser: the scope is a
// wrapper, so a missing/invalid id still travels as `session` and main rejects it.
const makeBrowser = (scope?: { session: unknown; seedCookies?: boolean }) => {
  const call = (payload: { command: string; args?: unknown }): Promise<unknown> =>
    ipcRenderer.invoke("browser:command", scope === undefined ? payload : { ...payload, ...scope });
  return {
    open: (args: { url: string }): Promise<unknown> =>
      call({ command: "open", args }),
    act: (args: Record<string, unknown>): Promise<unknown> =>
      call({ command: "act", args }),
    findImages: (args: Record<string, unknown>): Promise<unknown> =>
      call({ command: "findImages", args }),
    // jev-loop design doc `2026-09-18-browse-task-jev-loop-design.md` §1 —
    // same "no validation here, main is the trust boundary" shape as the
    // three commands above; snapshot/perform stay loop internals reached only
    // through this preload, never offered to the model as their own penTools.
    snapshot: (): Promise<unknown> => call({ command: "snapshot" }),
    perform: (args: Record<string, unknown>): Promise<unknown> =>
      call({ command: "perform", args }),
    // QA assertions (browser-agent docs/specs/2026-10-18-qa-diagnostics-design.md
    // section 2): { checks, snapshotId? }. Read-only; same "no validation
    // here, main is the trust boundary" shape.
    assert: (args: Record<string, unknown>): Promise<unknown> =>
      call({ command: "assert", args }),
    // jev-loop design doc "Addendum 2, 2026-09-19" §2 — a readable digest of
    // the current page. Same "no validation here" shape as every other
    // command; main is the trust boundary.
    read: (args?: Record<string, unknown>): Promise<unknown> =>
      call({ command: "read", args }),
    // Full browser use (design doc `2026-09-23-full-browser-use-design.md`) —
    // same "no validation here, main is the trust boundary" shape as every
    // command above.
    screenshot: (args?: Record<string, unknown>): Promise<unknown> =>
      call({ command: "screenshot", args }),
    tabs: (args: Record<string, unknown>): Promise<unknown> =>
      call({ command: "tabs", args }),
    // The page as self-contained HTML. Light uses it only for trace DOM snapshots
    // (`{ forTrace: true }`, @sideform/browser-agent traceDomSource). Same "no validation
    // here, main is the trust boundary" shape as every command above.
    capture: (args?: Record<string, unknown>): Promise<unknown> =>
      call({ command: "capture", args }),
    // PageFixture. `opts` (an AbortSignal) cannot cross IPC and is dropped;
    // main gates the fixture and passes allowNetworkMocks: true (desktop
    // allows mocks, scoped to browser tabs through CDP Fetch).
    applyFixture: (fixture: unknown, _opts?: unknown): Promise<unknown> =>
      call({ command: "applyFixture", args: { fixture } }),
    releaseFixture: (token?: string): Promise<unknown> =>
      call({ command: "releaseFixture", args: { token } }),
    // Ends the emulation the agent's `viewport` action set (the run end). No args.
    clearActEmulation: (): Promise<unknown> => call({ command: "clearActEmulation" }),
    // Saved logins (docs/superpowers/specs/2026-10-16-browser-saved-logins-design.md):
    // main types the stored login into the current tab's sign-in form. Only
    // { label?, submit? } leaves this preload; the result never holds a secret.
    // Only these two keys are forwarded; main validates their types.
    fillLogin: (args?: { label?: unknown; submit?: unknown }): Promise<unknown> =>
      call({
        command: "fillLogin",
        args: { label: args?.label, submit: args?.submit },
      }),
    // Checkpoint journal. startJournal resolves to the owner token (string);
    // the checkpoint holds secrets (cookies/storage), so it goes back to the
    // caller only (the agent panel).
    startJournal: (opts?: { origins?: string[] }): Promise<unknown> =>
      call({ command: "startJournal", args: opts }),
    stopJournal: (token?: string): Promise<unknown> =>
      call({ command: "stopJournal", args: { token } }),
    captureCheckpoint: (token?: string): Promise<unknown> =>
      call({ command: "captureCheckpoint", args: { token } }),
    // Read-only: the tab network request log since the last call ({ requests, dropped? }).
    requests: (): Promise<unknown> => call({ command: "requests", args: {} }),
  };
};

const browser = {
  ...makeBrowser(),
  // A private browser: own cookies, tabs, fixture, journal. Same methods as
  // `browser`; every call carries the session id. Created lazily by its first
  // page command in main. Close it with `closeSession` (idempotent).
  // `seedCookies: true` = a session created by this scope starts with a copy of the shared
  // profile's cookies (regular agent runs). Absent/false = clean (QA). Main validates it.
  isolated: (sessionId: string, opts?: { seedCookies?: boolean }) =>
    makeBrowser({ session: sessionId, ...(opts?.seedCookies === undefined ? {} : { seedCookies: opts.seedCookies }) }),
  closeSession: (sessionId: string): Promise<unknown> =>
    ipcRenderer.invoke("browser:command", { command: "closeSession", session: sessionId }),
  // Bring the agent's browser tab to the front (a click on a tool chip). No id = the
  // shared browser. Resolves false when there is no such tab; never creates one.
  revealAgentTab: (sessionId?: string): Promise<unknown> =>
    ipcRenderer.invoke("browser:reveal-agent-tab", { session: sessionId }),
};


// Chat storage (src/main/chatStore.ts): the panel keeps its chats on disk. Main accepts it only from this panel's own page.
const chats = {
  list: (): Promise<{ chats: unknown[] } | { error: string }> => ipcRenderer.invoke("chats:list"),
  read: (id: string): Promise<{ chat: unknown | null } | { error: string }> => ipcRenderer.invoke("chats:read", id),
  save: (chat: unknown): Promise<{ ok: true; rev: number; stale?: true } | { error: string }> => ipcRenderer.invoke("chats:save", chat),
  remove: (id: string): Promise<{ ok: true } | { error: string }> => ipcRenderer.invoke("chats:delete", id),
};
// Browse-run traces: store a finished trace locally, open its viewer tab. Main checks the sender.
const traces = {
  save: (payload: { manifest: unknown; assets: { path: string; dataUrl: string }[] }): Promise<{ id: string } | { error: string }> =>
    ipcRenderer.invoke("traces:save", payload),
  open: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("traces:open", id),
  listTabs: (): Promise<{ tabs: { traceId: string; title: string; active: boolean }[] } | { error: string }> =>
    ipcRenderer.invoke("traces:list-tabs"),
  // `opts.frames === false` skips the frame files (no base64 over IPC). Main validates `opts`.
  read: (id: string, opts?: { frames?: boolean; frameIds?: number[] }): Promise<{ trace: unknown } | { error: string }> =>
    opts === undefined ? ipcRenderer.invoke("traces:read", id) : ipcRenderer.invoke("traces:read", id, opts),
};

// Settings tab (`settings:open`): `section` is one of appearance|model|memory|browser|mcp|schedules (config.ts SETTINGS_SECTIONS); main ignores any other value.
const settings = {
  open: (section?: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("settings:open", section),
};

// Schedules for the agent tools `schedule_list` / `schedule_create`: main accepts these only from this panel's own
// page and validates `create` like `schedules:save` (always stored enabled).
const schedules = {
  list: (): Promise<unknown> => ipcRenderer.invoke("schedules:panel-list"),
  create: (input: { name: string; prompt: string; cron: string }): Promise<unknown> => ipcRenderer.invoke("schedules:panel-create", input),
  setEnabled: (id: string, enabled: boolean): Promise<unknown> => ipcRenderer.invoke("schedules:panel-set-enabled", { id, enabled }),
  remove: (id: string): Promise<unknown> => ipcRenderer.invoke("schedules:panel-remove", id),
};

// MCP agent bridge (src/main/mcp/): main forwards a request of an external MCP client (`mcp:task-request`
// `{ requestId, request }`); the page's handler answers it and the reply goes back as `mcp:task-reply`
// `{ requestId, reply }`. `notifyChanged` pushes "this task's state may have changed" (`mcp:task-changed`), which wakes
// waiting `get_task` calls. Main accepts both only from this panel's own page. One handler: a second `onRequest` replaces it.
let mcpHandler: ((req: unknown) => Promise<unknown>) | null = null;
// The ONE request listener of this page, installed on the first `onRequest`. Not keyed on `mcpHandler`: an
// unsubscribe sets that to null, and a later subscribe (StrictMode re-run, remount) must not add a second listener.
let mcpListenerInstalled = false;
const mcp = {
  onRequest(handler: (req: unknown) => Promise<unknown>): () => void {
    if (!mcpListenerInstalled) {
      mcpListenerInstalled = true;
      ipcRenderer.on("mcp:task-request", (_e, message: unknown) => {
        const m = message as { requestId?: unknown; request?: unknown } | null;
        if (!m || typeof m.requestId !== "string") return;
        const requestId = m.requestId;
        const current = mcpHandler;
        const reply = (value: unknown) => ipcRenderer.send("mcp:task-reply", { requestId, reply: value });
        if (!current) return reply({ error: "Sideform Light is not ready" });
        Promise.resolve()
          .then(() => current(m.request))
          .then(reply, () => reply({ error: "The task request failed" }));
      });
    }
    mcpHandler = handler;
    ipcRenderer.send("mcp:panel-ready");
    return () => {
      if (mcpHandler === handler) mcpHandler = null;
    };
  },
  notifyChanged(taskId: string): void {
    ipcRenderer.send("mcp:task-changed", { taskId });
  },
};

contextBridge.exposeInMainWorld("penAgentPanel", { version: 3, browser, chats, traces, settings, mcp, schedules });

// Theme report for main (channel `panel:theme`): the page paints the stored ui theme as the
// class `dark` on <html>. Initial read on DOMContentLoaded, then a MutationObserver on that class.
// Main accepts it only from this webContents and only from the panel's own page.
if (window === window.top) {
  let lastTheme: "light" | "dark" | null = null;
  const report = () => {
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    if (theme === lastTheme) return;
    lastTheme = theme;
    ipcRenderer.send("panel:theme", theme);
  };
  // Language report (channel `panel:language`): the ui sets `<html lang>` to its active language code (the ui is the
  // source of truth). Same shape as the theme report; only a supported code is sent, and only when it changes.
  let lastLanguage: string | null = null;
  const reportLanguage = () => {
    const lang = document.documentElement.getAttribute("lang") ?? "";
    if (!SUPPORTED_LANGUAGES.includes(lang) || lang === lastLanguage) return;
    lastLanguage = lang;
    ipcRenderer.send("panel:language", lang);
  };
  document.addEventListener("DOMContentLoaded", () => {
    report();
    reportLanguage();
    new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(reportLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  });
}
