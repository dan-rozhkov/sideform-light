export type UITheme = "light" | "dark";

export const UI_THEME_STORAGE_KEY = "ui-theme";

/** The one parser for a stored/received theme value; anything but "dark" (incl. removed) is light. */
export function parseUITheme(value: string | null): UITheme {
  return value === "dark" ? "dark" : "light";
}

export function getStoredUITheme(): UITheme {
  return parseUITheme(localStorage.getItem(UI_THEME_STORAGE_KEY));
}

const appliedListeners = new Set<(theme: UITheme) => void>();

/**
 * Run `fn` after EVERY application of the theme to <html>, from any path (store init, a no-op
 * store update, a switch). A path that toggled `.dark` silently let it be stripped under a
 * dark-only page (the landing) whose hook only heard about no-transition switches.
 */
export function onUIThemeApplied(fn: (theme: UITheme) => void): () => void {
  appliedListeners.add(fn);
  return () => appliedListeners.delete(fn);
}

export function applyUITheme(theme: UITheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  appliedListeners.forEach((fn) => fn(theme));
}

export function getAppliedUITheme(): UITheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyStoredUITheme() {
  applyUITheme(getStoredUITheme());
}

/**
 * Switch the theme with `transition: none` in effect, so every surface flips
 * in the same frame. (Moved from uiThemeStore; see the reflow note below.)
 */
export function applyThemeWithoutTransitions(theme: UITheme) {
  const root = document.documentElement;
  root.classList.add("disable-theme-transitions");
  // Apply the theme while transitions are disabled, then force a synchronous
  // style recalc BEFORE removing the class, so the two are not coalesced into
  // one recalc (which would let the transition run). Not dead code.
  applyUITheme(theme);
  void root.offsetHeight;
  requestAnimationFrame(() => {
    root.classList.remove("disable-theme-transitions");
  });
}

let stateSetter: ((theme: UITheme) => void) | null = null;
let storageSyncInstalled = false;

/**
 * uiThemeStore registers here (it is loaded on /agent too, via
 * EditorProviders). A remote theme goes through the store, which applies it
 * without transitions and does not persist it.
 */
export function setUIThemeStateSetter(fn: ((theme: UITheme) => void) | null) {
  stateSetter = fn;
}

/**
 * Every view follows theme changes made in other same-origin documents (`storage` fires only in the
 * OTHER documents). Idempotent.
 */
export function installUIThemeStorageSync() {
  if (storageSyncInstalled || typeof window === "undefined") return;
  storageSyncInstalled = true;
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.storageArea !== localStorage) return;
    // key === null: localStorage.clear() in another document -> removed -> light.
    if (e.key !== null && e.key !== UI_THEME_STORAGE_KEY) return;
    const theme = parseUITheme(e.key === null ? null : e.newValue);
    if (stateSetter) stateSetter(theme);
    else applyThemeWithoutTransitions(theme);
  });
}

const THEME_CHANNEL_NAME = "pen-ui-theme";
let themeChannel: BroadcastChannel | null = null;

function getThemeChannel(): BroadcastChannel | null {
  if (themeChannel || typeof BroadcastChannel === "undefined") return themeChannel;
  themeChannel = new BroadcastChannel(THEME_CHANNEL_NAME);
  return themeChannel;
}

/** An explicit user choice (`source: "user"`), announced to every other same-origin document. */
export function postUserTheme(theme: UITheme) {
  getThemeChannel()?.postMessage({ theme });
}

let broadcastSyncInstalled = false;

/**
 * The user-intent channel next to the `storage` sync above: only
 * `source: "user"` changes are posted, and every view applies a received one
 * as "remote" (never written back). BroadcastChannel
 * does not deliver to the posting instance. Idempotent.
 */
export function installUIThemeBroadcastSync() {
  if (broadcastSyncInstalled) return;
  const channel = getThemeChannel();
  if (!channel) return;
  broadcastSyncInstalled = true;
  channel.onmessage = (e: MessageEvent<{ theme?: unknown }>) => {
    const theme = e.data?.theme;
    if (theme !== "light" && theme !== "dark") return;
    if (stateSetter) stateSetter(theme);
    else applyThemeWithoutTransitions(theme);
  };
}
