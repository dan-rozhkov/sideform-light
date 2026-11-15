import { originOf } from "../config";
import { isPanelDocument } from "../windowTheme";

/** The slice of an `ipcMain.on` event the checks read. `senderFrame` is the top frame iff it is `sender.mainFrame`. */
export interface LanguageEvent {
  sender: { id: number; mainFrame?: unknown };
  senderFrame?: { url?: string } | null;
}

/** `panel:language`: only the agent panel's own webContents, and only while it shows the panel page. */
export function isPanelLanguageSender(event: LanguageEvent, panelWebContentsId: number, panelUrl: string): boolean {
  return event.sender.id === panelWebContentsId && isPanelDocument(event.senderFrame?.url ?? "", panelUrl);
}

/**
 * `tab:language`: the TOP frame of a ui tab (trace, Settings) of this window, and only while that frame is on the ui
 * origin. A subframe, a tab that navigated away, or any other webContents (a browser tab has no preload at all) is ignored.
 */
export function isTabLanguageSender(event: LanguageEvent, isUiTab: (webContentsId: number) => boolean, uiOrigin: string): boolean {
  const frame = event.senderFrame;
  if (frame == null || frame !== event.sender.mainFrame) return false;
  if (!isUiTab(event.sender.id)) return false;
  const origin = originOf(frame.url);
  return origin !== null && origin === originOf(uiOrigin);
}
