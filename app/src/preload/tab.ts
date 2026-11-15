import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type UITheme = "light" | "dark";

// The interface languages (src/main/i18n/languages.ts; a sandboxed preload cannot import it). Main validates again.
const SUPPORTED_LANGUAGES: string[] = ["en", "ru", "de", "it", "fr"];

let lastTheme: UITheme | undefined;
let lastLanguage: string | undefined;

/** The ui sets `<html lang>` to its active language code: report it (`tab:language`) when it changes, supported codes only. */
function publishLanguage(): void {
  const lang = document.documentElement?.getAttribute("lang") ?? "";
  if (!SUPPORTED_LANGUAGES.includes(lang) || lang === lastLanguage) return;
  lastLanguage = lang;
  ipcRenderer.send("tab:language", lang);
}

function publishTheme(): void {
  const theme: UITheme = document.documentElement?.classList.contains("dark") ? "dark" : "light";
  if (theme === lastTheme) return;
  lastTheme = theme;
  ipcRenderer.send("tab:theme", theme);
}

// Browse-run traces: the trace viewer page reads the trace it shows. Main checks the sender (a trace tab).
const traces = {
  read: (id: string): Promise<{ trace: unknown } | { error: string }> => ipcRenderer.invoke("traces:read", id),
};

// Built-in browser switches for the Settings page. Always present (main is the trust boundary): main answers only the
// top frame of a Settings tab on the settings page, everything else gets `{ error: "Not allowed." }`.
const browserSettings = {
  get: (): Promise<unknown> => ipcRenderer.invoke("browser-settings:get"),
  set: (patch: { adBlock?: boolean }): Promise<unknown> => ipcRenderer.invoke("browser-settings:set", patch),
};

// MCP agent bridge settings for the Settings page (`mcp-settings:*`). Same rule as browserSettings: main answers only the
// top frame of a Settings tab on the settings page, everything else gets `{ error: "Not allowed." }`.
const mcp = {
  get: (): Promise<unknown> => ipcRenderer.invoke("mcp-settings:get"),
  set: (patch: { enabled: boolean }): Promise<unknown> => ipcRenderer.invoke("mcp-settings:set", patch),
  regenerateToken: (): Promise<unknown> => ipcRenderer.invoke("mcp-settings:regenerate-token"),
};

// Scheduled chats for the Settings page (`schedules:*`). Same rule as `mcp`: main answers only the top frame of a Settings
// tab on the settings page, everything else gets `{ error: "Not allowed." }`. `onChanged` is main's `schedules:changed` push.
const schedules = {
  list: (): Promise<unknown> => ipcRenderer.invoke("schedules:list"),
  save: (input: unknown): Promise<unknown> => ipcRenderer.invoke("schedules:save", input),
  remove: (id: string): Promise<unknown> => ipcRenderer.invoke("schedules:remove", id),
  runNow: (id: string): Promise<unknown> => ipcRenderer.invoke("schedules:run-now", id),
  onChanged(cb: () => void): () => void {
    const listener = () => cb();
    ipcRenderer.on("schedules:changed", listener);
    return () => ipcRenderer.removeListener("schedules:changed", listener);
  },
};

// The bridge of the ui's tab pages (the trace viewer and the Settings page). The agent panel has its own preload;
// no page here can drive the browser.
const api = {
  traces,
  browserSettings,
  mcp,
  schedules,
  // Opens (or activates) the Settings tab; `section` is validated in main.
  settings: {
    open: (section?: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("settings:open", section),
    // Main asks the open Settings page to switch section without reloading it.
    onSection(cb: (section: string) => void): () => void {
      const listener = (_e: IpcRendererEvent, section: unknown) => {
        if (typeof section === "string") cb(section);
      };
      ipcRenderer.on("settings:section", listener);
      return () => ipcRenderer.removeListener("settings:section", listener);
    },
  },
};

contextBridge.exposeInMainWorld("penDesktop", api);

function startThemeObserver(): void {
  const root = document.documentElement;
  if (!root) return;
  publishTheme();
  new MutationObserver(publishTheme).observe(root, {
    attributes: true,
    attributeFilter: ["class"],
  });
  new MutationObserver(publishLanguage).observe(root, {
    attributes: true,
    attributeFilter: ["lang"],
  });
}

// The language is NOT read at once: the document's static `<html lang="en">` is only a placeholder until the ui sets the
// real code (when its script runs, before DOMContentLoaded). The observer reports that change; the DOMContentLoaded read
// covers a ui that set the code before the observer started.
window.addEventListener("DOMContentLoaded", publishLanguage, { once: true });

// The ui applies its theme by toggling `.dark` on <html>. Observing it here lets the shell paint the page's own
// view background to match, without coupling the page to Electron-specific APIs. Preloads may run before <html>
// exists, so defer the observer while exposing the public bridge immediately.
if (document.documentElement) {
  startThemeObserver();
} else {
  window.addEventListener("DOMContentLoaded", startThemeObserver, { once: true });
}
