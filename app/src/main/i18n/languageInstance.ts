import * as path from "node:path";
import { app } from "electron";
import { createLanguageState, LANGUAGE_FILE, type LanguageState } from "./languageState";

let state: LanguageState | undefined;

/**
 * THE language state of the process, created on the FIRST call (never at import, like browserSettingsInstance.ts):
 * index.ts fixes `userData` before anything asks. Every caller gets the same instance.
 */
export function getLanguageState(): LanguageState {
  state ??= createLanguageState({
    filePath: path.join(app.getPath("userData"), LANGUAGE_FILE),
    systemTags: () => [app.getLocale(), ...app.getPreferredSystemLanguages()],
    forced: process.env.SIDEFORM_LIGHT_LANGUAGE,
  });
  return state;
}
