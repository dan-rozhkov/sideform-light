import type { UITheme } from "./tabManager";
import { originOf } from "./config";

/**
 * The theme the window chrome (tab bar, panel, placeholder, rim) renders: the one the agent panel page
 * reports (`panel:theme`), else the fallback until it has reported. The panel's theme wins always: tab pages
 * (trace, Settings) share the panel's storage, so they paint the same theme and only colour their own view.
 */
export function resolveWindowTheme(panel: UITheme | null, system: UITheme): UITheme {
  return panel ?? system;
}

/** True when `url` is a document of the panel page (same origin, panel path or a subpath), not e.g. the offline fallback. */
export function isPanelDocument(url: string, panelUrl: string): boolean {
  try {
    const u = new URL(url);
    const p = new URL(panelUrl);
    if (originOf(url) !== originOf(panelUrl)) return false;
    const base = p.pathname.replace(/\/+$/, "");
    return u.pathname === p.pathname || u.pathname === base || u.pathname.startsWith(`${base}/`);
  } catch {
    return false;
  }
}

export interface GlassTint {
  /** CSS colour of the translucent layer under the islands. */
  color: string;
  alpha: number;
}

/** Tint base colours per theme. */
const GLASS_BASE: Record<UITheme, [number, number, number]> = { light: [244, 245, 248], dark: [28, 28, 30] };
/** Alpha when the theme matches the OS appearance (the wallpaper stays visible) / differs (the tint must win over the vibrancy). */
export const GLASS_ALPHA_SAME = 0.35;
export const GLASS_ALPHA_DIFFERENT = 0.85;

/**
 * Glass tint. The vibrancy follows the OS appearance and cannot be
 * changed per window, so a translucent layer of the theme's colour is
 * drawn over it: light when both agree, stronger when they differ.
 */
export function glassTint(theme: UITheme, osDark: boolean): GlassTint {
  const same = (theme === "dark") === osDark;
  const alpha = same ? GLASS_ALPHA_SAME : GLASS_ALPHA_DIFFERENT;
  const [r, g, b] = GLASS_BASE[theme];
  return { color: `rgba(${r}, ${g}, ${b}, ${alpha})`, alpha };
}

// --- window colours: the ONE TS place (the CSS twin is tokens.css `--island-bg`,
// pinned equal by test/windowTheme.test.ts) ---

/** Island surface = the ui's `--color-surface-panel`. Also the agent panel / tab content / empty view background. */
export const ISLAND_BG: Record<UITheme, string> = { light: "#ffffff", dark: "#2a2a2a" };
/** Non-macOS stand-in for the glass behind the islands. */
export const GLASS_SOLID: Record<UITheme, string> = { light: "#e4e6ea", dark: "#2b2b2e" };

/** Opaque background of tab content views / panel / placeholder (never flashes white in dark). */
export function contentBackground(theme: UITheme): string {
  return ISLAND_BG[theme];
}

/** The theme assumed before the panel reported: the ui ignores the OS (stored `ui-theme`, default light). */
export const FALLBACK_THEME: UITheme = "light";
