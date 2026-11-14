import type { BrowserSettingsEvent } from "../browserSettingsIpc";
import { NOT_ALLOWED } from "../browserSettingsIpc";
import type { McpService, McpSettingsView } from "./service";

/** `mcp-settings:set` payload: a plain object with exactly the boolean `enabled`. */
export function parseMcpSettingsPatch(raw: unknown): { enabled: boolean } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "enabled") return null;
  const enabled = (raw as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? { enabled } : null;
}

export interface McpSettingsIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: BrowserSettingsEvent, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
  };
  service: Pick<McpService, "get" | "setEnabled" | "regenerateToken">;
  /** Same rule as `browser-settings:*`: the top frame of a Settings tab on the settings page. */
  isSettingsSender(event: BrowserSettingsEvent): boolean;
}

/**
 * `mcp-settings:get|set|regenerate-token` (invoke). `ipcMain.handle` is process-global: created once (index.ts).
 * Answered only to the Settings page; everything else gets `{ error: "Not allowed." }`. Never throws.
 */
export function registerMcpSettingsIpc(deps: McpSettingsIpcDeps): () => void {
  const guard = async (event: BrowserSettingsEvent, run: () => Promise<McpSettingsView | { error: string }>) => {
    if (!deps.isSettingsSender(event)) return NOT_ALLOWED;
    try {
      return await run();
    } catch {
      return { error: "Could not complete the request." };
    }
  };
  deps.ipcMain.handle("mcp-settings:get", (e) => guard(e, async () => deps.service.get()));
  deps.ipcMain.handle("mcp-settings:set", (e, payload) =>
    guard(e, async () => {
      const patch = parseMcpSettingsPatch(payload);
      return patch === null ? { error: "Invalid settings." } : deps.service.setEnabled(patch.enabled);
    }),
  );
  deps.ipcMain.handle("mcp-settings:regenerate-token", (e) => guard(e, () => deps.service.regenerateToken()));
  return () => {
    deps.ipcMain.removeHandler("mcp-settings:get");
    deps.ipcMain.removeHandler("mcp-settings:set");
    deps.ipcMain.removeHandler("mcp-settings:regenerate-token");
  };
}
