import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import type { BrowserBridge } from "@sideform/browser-agent/loop";

/** What `traces.save` takes: `splitTraceAssets` output (frames moved out of the manifest). */
export interface BrowseTraceSavePayload {
  manifest: BrowseTrace;
  assets: { path: string; dataUrl: string; contentType: string }[];
}

/** One saved local trace as `traces.list` reports it (no frames, no steps). */
export interface StoredTraceSummary {
  id: string;
  goal: string;
  /** Epoch milliseconds. */
  startedAt: number;
  status: string;
  qaOutcome?: string;
}

/** The shell's answer to a trace save: the stored id, or an error text. Never throws. */
export type BrowseTraceSaveResult = { id: string } | { error: string };

/**
 * The shell's built-in browser as the browse_* tools drive it: the package's `BrowserBridge`
 * (`findImages` is always present) plus the saved-login filler.
 */
export type DesktopBrowserBridge = BrowserBridge &
  Required<Pick<BrowserBridge, "findImages">> & {
    /** browse_fill_login: fills the saved login for the current page's host. The result holds no secret. */
    fillLogin?(args: { label?: string; submit?: boolean }): Promise<unknown>;
  };

/** Opens or focuses the Settings tab. */
export interface DesktopSettingsApi {
  open?(section?: string): Promise<{ ok: boolean }> | void;
  /** Subscribes to "switch to this section" requests while the Settings tab is open. */
  onSection?(cb: (section: string) => void): () => void;
}

/** Switches of the built-in browser (Settings > Browser). */
export interface DesktopBrowserSettings {
  adBlock: boolean;
}

export interface DesktopBrowserSettingsApi {
  get(): Promise<DesktopBrowserSettings | { error: string }>;
  set(patch: Partial<DesktopBrowserSettings>): Promise<DesktopBrowserSettings | { error: string }>;
}

/** Preload API of the trace and settings tabs (`preload/tab`). */
export interface PenDesktopApi {
  /** Local browse-run traces. `read` returns `{ trace }` with data-URL frames, or `{ error }`. */
  traces?: {
    read(id: string): Promise<{ trace: BrowseTrace } | { error: string }>;
    /** Saved local traces, newest first. Absent when the shell cannot list them. */
    list?(): Promise<{ traces: StoredTraceSummary[] } | { error: string }>;
    /** Opens a local trace in a trace tab. */
    open?(id: string): Promise<{ ok: boolean; error?: string }>;
  };
  /** Opens or focuses the Settings tab, optionally on a section. */
  settings?: DesktopSettingsApi;
  /** Ad blocking of the built-in browser. Settings tab only. */
  browserSettings?: DesktopBrowserSettingsApi;
}

declare global {
  interface Window {
    penDesktop?: PenDesktopApi;
  }
}
