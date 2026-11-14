// The app-level MCP bridge service: owns the HTTP server, the settings (on/off + token) and the connection file.
// Created once in index.ts, Electron-free (every effect is injected), unit-tested. Operations are serialized, so a
// quick on/off/on never races two servers on one port.
//
// Off by default. Turning it on starts the server on the fixed port (busy port -> status error, never a random
// fallback: a static client config would silently break) and writes the connection file; turning it off stops the
// server and removes the file.

import type { Handshake, HandshakeFileEntry } from "./handshake";
import type { HttpServerHandle, HttpServerOptions } from "./httpServer";
import type { JsonRpcDeps } from "./jsonRpc";
import type { McpSettingsStore } from "./settingsStore";
import { createKeyedChain } from "../storeUtils";
import { MCP_PATH } from "./types";

export type McpStatusState = "off" | "starting" | "listening" | "error";

export interface McpStatus {
  state: McpStatusState;
  error?: string;
}

/** What the Settings page shows (`penDesktop.mcp.get`). */
export interface McpSettingsView {
  enabled: boolean;
  port: number;
  url: string;
  token: string;
  status: McpStatus;
}

export interface McpServiceDeps {
  settings: McpSettingsStore;
  handshake: Pick<Handshake, "write" | "remove" | "removeSync" | "path">;
  rpc: JsonRpcDeps;
  port: number;
  startServer(options: HttpServerOptions): Promise<HttpServerHandle>;
  log?: { warn(msg: string): void };
}

export interface McpService {
  get(): McpSettingsView;
  /** Starts the server when the saved flag is on (app ready). Never rejects. */
  start(): Promise<void>;
  setEnabled(enabled: boolean): Promise<McpSettingsView | { error: string }>;
  regenerateToken(): Promise<McpSettingsView | { error: string }>;
  /** will-quit: removes the connection file synchronously (when it is ours) and closes the server. */
  disposeSync(): void;
}

/** A human message for a failed listen. Never includes the token. */
export function describeListenError(err: unknown, port: number): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EADDRINUSE") return `Port ${port} is already in use. Close the app that uses it and turn the bridge on again.`;
  if (code === "EACCES") return `Not allowed to listen on port ${port}.`;
  return `Could not start the server: ${err instanceof Error ? err.message : String(err)}`;
}

export function createMcpService(deps: McpServiceDeps): McpService {
  const log = deps.log ?? { warn: (m: string) => console.warn(m) };
  let status: McpStatus = { state: "off" };
  let running: { handle: HttpServerHandle; entry: HandshakeFileEntry } | null = null;
  let disposed = false;
  // The entry being written (or last written) and not yet removed: will-quit can land while `running` is still null.
  let written: HandshakeFileEntry | null = null;
  const serialized = createKeyedChain();
  const queue = <T>(fn: () => Promise<T>): Promise<T> => serialized("mcp", fn);

  const view = (): McpSettingsView => {
    const { enabled, token } = deps.settings.get();
    return { enabled, port: deps.port, url: `http://127.0.0.1:${deps.port}${MCP_PATH}`, token, status: { ...status } };
  };

  async function stopServer(): Promise<void> {
    const current = running;
    running = null;
    if (!current) return;
    try {
      await current.handle.close();
    } catch (err) {
      log.warn(`[mcp] closing the server failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (disposed) {
      // will-quit ran while the server closed: the sync remove is the one that completes before exit.
      deps.handshake.removeSync(current.entry);
    } else {
      await deps.handshake.remove(current.entry);
    }
    if (written === current.entry) written = null;
  }

  async function startServer(): Promise<void> {
    await stopServer();
    if (disposed) return;
    const { token } = deps.settings.get();
    status = { state: "starting" };
    let handle: HttpServerHandle;
    try {
      handle = await deps.startServer({
        token,
        deps: deps.rpc,
        port: deps.port,
        onError: (err) => log.warn(`[mcp] server error: ${err.message}`),
      });
    } catch (err) {
      status = { state: "error", error: describeListenError(err, deps.port) };
      return;
    }
    if (disposed) {
      // will-quit ran during the listen: close the server, leave no connection file behind.
      await handle.close().catch(() => undefined);
      return;
    }
    const entry: HandshakeFileEntry = { url: `http://127.0.0.1:${handle.port}${MCP_PATH}`, token, port: handle.port };
    written = entry;
    if (!(await deps.handshake.write(entry))) {
      written = null;
      await handle.close().catch(() => undefined);
      status = { state: "error", error: "Could not write the connection file in ~/.sideform-light." };
      return;
    }
    if (disposed) {
      // will-quit ran during the file write: undo both.
      await handle.close().catch(() => undefined);
      deps.handshake.removeSync(entry);
      written = null;
      return;
    }
    running = { handle, entry };
    status = { state: "listening" };
  }

  return {
    get: view,
    start: () =>
      queue(async () => {
        if (deps.settings.get().enabled) await startServer();
      }),
    setEnabled: (enabled) =>
      queue(async () => {
        if (deps.settings.setEnabled(enabled) === null) return { error: "Could not save the setting." };
        if (enabled) await startServer();
        else {
          await stopServer();
          status = { state: "off" };
        }
        return view();
      }),
    regenerateToken: () =>
      queue(async () => {
        const wasRunning = running !== null;
        // The old server (and its file) go first, so no moment serves the old token after the call returns.
        if (wasRunning) await stopServer();
        if (deps.settings.regenerateToken() === null) {
          if (wasRunning) await startServer();
          return { error: "Could not save the new token." };
        }
        if (deps.settings.get().enabled) await startServer();
        return view();
      }),
    disposeSync() {
      disposed = true;
      const current = running;
      running = null;
      // `written` also covers a write still in flight or a stop still closing (`running` is null then).
      const entry = written ?? current?.entry ?? null;
      written = null;
      if (entry) deps.handshake.removeSync(entry);
      if (current) void current.handle.close().catch(() => undefined);
    },
  };
}
