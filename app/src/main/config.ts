// Sideform Light loads its own UI (agent panel, trace page, settings page) from
// the privileged `app://sideform` scheme, served out of the bundled ui dist
// (localProtocol.ts). Nothing is loaded from the network. A developer can point
// the shell at the ui's Vite dev server with SIDEFORM_LIGHT_UI_URL; the page
// origin is then that server's origin and every origin check uses it.

export const APP_SCHEME = "app";
export const APP_HOST = "sideform";
/** The origin of the bundled ui. NOT `new URL(...).origin`: Node reports "null" for a non-special scheme. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** The product name shown to the user, and the userData directory name (never shared with Sideform Desktop). */
export const DISPLAY_APP_NAME = "Sideform Light";

/** Backend the ui talks to for agent requests; the CSP `connect-src` of the ui pages names it. */
export const DEFAULT_BACKEND_URL = "http://localhost:3001";

/** `protocol//host` of a URL: the origin as Chromium sees it, also for the standard `app:` scheme. Null when unparsable. */
export function originOf(rawUrl: string | undefined): string | null {
  if (rawUrl === undefined) return null;
  try {
    const u = new URL(rawUrl);
    if (u.host === "") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** True when `rawUrl` is on the ui origin. */
export function isOnUiOrigin(rawUrl: string | undefined, uiOrigin: string): boolean {
  return originOf(rawUrl) === uiOrigin;
}

/**
 * The origin the ui pages load from: the origin of SIDEFORM_LIGHT_UI_URL (http/https only; a path is
 * ignored), else `app://sideform`.
 */
export function resolveUiOrigin(env: NodeJS.ProcessEnv): string {
  const override = env.SIDEFORM_LIGHT_UI_URL;
  if (override) {
    try {
      const url = new URL(override);
      if (url.protocol === "http:" || url.protocol === "https:") return `${url.protocol}//${url.host}`;
    } catch {
      // fall through to the bundled ui
    }
  }
  return APP_ORIGIN;
}

/** The origin of the backend, from SIDEFORM_LIGHT_BACKEND_URL (http/https only), else `http://localhost:3001`. */
export function resolveBackendOrigin(env: NodeJS.ProcessEnv): string {
  const raw = env.SIDEFORM_LIGHT_BACKEND_URL;
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" || url.protocol === "https:") return `${url.protocol}//${url.host}`;
    } catch {
      // fall through to the default
    }
  }
  return DEFAULT_BACKEND_URL;
}

/** The agent panel page. */
export function resolveAgentPanelUrl(uiOrigin: string): string {
  return `${uiOrigin}/agent`;
}

/** The built-in browser's human-like cursor overlay (see BrowserController's
 * `moveCursor`) is on by default — it's what makes the agent driving the
 * browser tab visible to the user watching it. `SIDEFORM_LIGHT_BROWSER_CURSOR`
 * is the kill switch, matched case-insensitively against "off"/"0"/"false";
 * anything else (including unset) leaves it on. */
export function resolveBrowserCursorEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SIDEFORM_LIGHT_BROWSER_CURSOR;
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized !== "off" && normalized !== "0" && normalized !== "false";
}

/** True when an env var carries a real value. Empty and whitespace-only
 * count as UNSET (so they neither lock a menu item nor override a saved
 * choice). */
export function isEnvValueSet(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== "";
}

/** `SIDEFORM_LIGHT_USER_DATA_DIR` overrides Electron's userData directory (read
 * in index.ts before `app.ready`). Used by e2e so every run gets a fresh dir
 * and a developer's saved settings never leak in. Empty = unset. */
export function resolveUserDataDir(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.SIDEFORM_LIGHT_USER_DATA_DIR;
  return isEnvValueSet(raw) ? (raw as string).trim() : undefined;
}

/** `SIDEFORM_LIGHT_NO_ADBLOCK=1` skips loading the ad-block engine (no network, e2e). Matches 1/true/on/yes. */
export function isAdBlockDisabledByEnv(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SIDEFORM_LIGHT_NO_ADBLOCK;
  if (!isEnvValueSet(raw)) return false;
  return ["1", "true", "on", "yes"].includes((raw as string).trim().toLowerCase());
}

/** The section ids of the ui's `/settings` page (`?section=<id>`). */
export const SETTINGS_SECTIONS = ["appearance", "browser"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** True for one of the settings section ids; anything else (also non-strings) is not. */
export function isValidSettingsSection(section: unknown): section is SettingsSection {
  return typeof section === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(section);
}

/** The URL of the Settings tab: `/settings`, plus `?section=<id>` when the section is valid (an invalid one is dropped). */
export function resolveSettingsTabUrl(uiOrigin: string, section?: unknown): string {
  return `${uiOrigin}/settings${isValidSettingsSection(section) ? `?section=${section}` : ""}`;
}

/** True when the URL is the ui's settings page ON the ui origin (last path segment `settings`). */
export function isSettingsPageOn(rawUrl: string | undefined, uiOrigin: string): boolean {
  if (rawUrl === undefined || !isOnUiOrigin(rawUrl, uiOrigin)) return false;
  try {
    const segments = new URL(rawUrl).pathname.replace(/\/+$/, "").split("/");
    return segments[segments.length - 1] === "settings";
  } catch {
    return false;
  }
}

/** The URL of a browse-trace tab: `/trace/<id>?src=local`. The id is validated by the caller (`isValidTraceId`); it is still encoded here. */
export function resolveTraceTabUrl(uiOrigin: string, traceId: string): string {
  return `${uiOrigin}/trace/${encodeURIComponent(traceId)}?src=local`;
}

/** A trace id the agent panel may ask to open: 1-64 of `A-Za-z0-9_-` (the browse-trace id format). */
export function isValidTraceId(traceId: unknown): traceId is string {
  return typeof traceId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(traceId);
}

/** The trace id in the path of a trace tab URL (`/trace/<id>`), or null. */
export function traceIdOfUrl(rawUrl: string): string | null {
  try {
    const segments = new URL(rawUrl).pathname.split("/");
    let id: string;
    try {
      id = decodeURIComponent(segments[segments.length - 1] ?? "");
    } catch {
      id = segments[segments.length - 1] ?? "";
    }
    return segments[segments.length - 2] === "trace" && isValidTraceId(id) ? id : null;
  } catch {
    return null;
  }
}
