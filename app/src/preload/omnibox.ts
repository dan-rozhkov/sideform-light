import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Item = { url: string; title: string; lastVisitedAt: number };
type RenderPayload = { items: Item[]; selected: number; query: string; theme: "light" | "dark"; isMac: boolean };

// The address-bar suggestion popover only paints what the tab bar sends (through main) and reports clicks.
const api = {
  onRender: (cb: (p: RenderPayload) => void) => {
    ipcRenderer.on("omnibox:render", (_e: IpcRendererEvent, p: RenderPayload) => cb(p));
  },
  /** The page's dictionary (`shell:i18n`): the active language and the strings this page needs. Sent on load and on every change. */
  onI18n: (cb: (payload: { lang: string; strings: Record<string, string> }) => void): void => {
    ipcRenderer.on("shell:i18n", (_e: IpcRendererEvent, payload: { lang: string; strings: Record<string, string> }) => cb(payload));
  },
  pick: (url: string) => ipcRenderer.send("omnibox:pick", { url }),
  remove: (url: string) => ipcRenderer.send("omnibox:remove", { url }),
  openHistory: () => ipcRenderer.send("omnibox:open-history"),
};

contextBridge.exposeInMainWorld("penOmnibox", api);
