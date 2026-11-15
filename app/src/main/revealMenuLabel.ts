// Dependency-free on purpose (the i18n module is pure): menu.ts imports it. Keeping it out of
// revealInFolder.ts stops that import chain from reaching traceStore →
// @sideform/browser-agent.
import { t, type Language } from "./i18n";

/** "Reveal in Finder" on macOS, "Show in Explorer" on Windows, "Show in Folder" elsewhere (in the interface language). */
export function revealMenuLabel(platform: NodeJS.Platform, lang: Language = "en"): string {
  if (platform === "darwin") return t(lang, "menu.revealFinder");
  if (platform === "win32") return t(lang, "menu.revealExplorer");
  return t(lang, "menu.revealFolder");
}
