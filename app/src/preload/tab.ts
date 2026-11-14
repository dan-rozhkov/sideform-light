import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type UITheme = "light" | "dark";

let lastTheme: UITheme | undefined;

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

// The bridge of the ui's tab pages (the trace viewer and the Settings page). The agent panel has its own preload;
// no page here can drive the browser.
const api = {
  traces,
  browserSettings,
  mcp,
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
}

// The ui applies its theme by toggling `.dark` on <html>. Observing it here lets the shell paint the page's own
// view background to match, without coupling the page to Electron-specific APIs. Preloads may run before <html>
// exists, so defer the observer while exposing the public bridge immediately.
if (document.documentElement) {
  startThemeObserver();
} else {
  window.addEventListener("DOMContentLoaded", startThemeObserver, { once: true });
}
