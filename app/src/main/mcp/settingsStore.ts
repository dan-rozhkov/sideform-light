// `<userData>/mcp-bridge.json` `{ enabled, token }`: the on/off flag (default off) and the bearer token (64 hex,
// generated once, replaced only by "Regenerate token"). File mode 0600, atomic write (tmp + rename). A missing or
// corrupt file gives the defaults and a fresh token; a field of a wrong type falls back per field.

import * as fs from "node:fs";
import { isObject, writeFileAtomicSync } from "../storeUtils";
import { generateToken, isValidToken } from "./handshake";

export const MCP_SETTINGS_FILE = "mcp-bridge.json";

export interface McpBridgeSettings {
  enabled: boolean;
  token: string;
}

export interface McpSettingsFs {
  readText(filePath: string): string | null;
  /** Atomic replace, mode 0600. Throws on failure. */
  writeText(filePath: string, text: string): void;
}

export const nodeMcpSettingsFs: McpSettingsFs = {
  readText(filePath) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  },
  writeText(filePath, text) {
    writeFileAtomicSync(filePath, text, { chmod: true });
  },
};

export interface McpSettingsStore {
  get(): McpBridgeSettings;
  /** Writes the flag. Returns the new settings, or null when the file could not be written (nothing changed). */
  setEnabled(enabled: boolean): McpBridgeSettings | null;
  /** Replaces the token. Returns the new settings, or null when the file could not be written (nothing changed). */
  regenerateToken(): McpBridgeSettings | null;
}

export interface McpSettingsStoreOptions {
  filePath: string;
  fs?: McpSettingsFs;
  newToken?: () => string;
}

export function createMcpSettingsStore(opts: McpSettingsStoreOptions): McpSettingsStore {
  const io = opts.fs ?? nodeMcpSettingsFs;
  const newToken = opts.newToken ?? generateToken;
  const write = (s: McpBridgeSettings): boolean => {
    try {
      io.writeText(opts.filePath, JSON.stringify(s, null, 2) + "\n");
      return true;
    } catch {
      return false;
    }
  };

  let rec: Record<string, unknown> = {};
  const text = io.readText(opts.filePath);
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isObject(parsed)) rec = parsed;
    } catch {
      // corrupt: defaults
    }
  }
  let current: McpBridgeSettings = {
    enabled: rec.enabled === true,
    token: isValidToken(rec.token) ? rec.token : newToken(),
  };
  // The token is generated once: persist it now (best effort; a failed write keeps it in memory for this run).
  if (!isValidToken(rec.token)) write(current);

  return {
    get: () => ({ ...current }),
    setEnabled(enabled) {
      if (enabled === current.enabled) return { ...current };
      const next = { ...current, enabled };
      if (!write(next)) return null;
      current = next;
      return { ...current };
    },
    regenerateToken() {
      const next = { ...current, token: newToken() };
      if (!write(next)) return null;
      current = next;
      return { ...current };
    },
  };
}
