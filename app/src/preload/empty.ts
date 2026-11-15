import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { UITheme } from "../main/tabManager";

// Minimal bridge of the empty-state view (zero tabs): it can only ask for a new browser tab and hear
// its state (theme, background session tab count). Nothing else of the tab bar API.
interface EmptyState {
  theme: UITheme;
  /** Background isolated-session tabs still open (the page shows a note when above 0). */
  sessionTabs: number;
}

const api = {
  newBrowserTab: () => ipcRenderer.send("tabbar:new-browser"),
  /** The page's dictionary (`shell:i18n`): the active language and the strings this page needs. Sent on load and on every change. */
  onI18n: (cb: (payload: { lang: string; strings: Record<string, string> }) => void): void => {
    ipcRenderer.on("shell:i18n", (_e: IpcRendererEvent, payload: { lang: string; strings: Record<string, string> }) => cb(payload));
  },
  onState: (cb: (state: EmptyState) => void) => {
    ipcRenderer.on("tabbar:theme", (_e: IpcRendererEvent, state: EmptyState) => cb(state));
  },
};

contextBridge.exposeInMainWorld("penEmpty", api);
