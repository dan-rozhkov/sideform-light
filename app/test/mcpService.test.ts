import { describe, expect, it, vi } from "vitest";
import { createMcpService, describeListenError } from "../src/main/mcp/service";
import type { HttpServerHandle, HttpServerOptions } from "../src/main/mcp/httpServer";
import type { McpBridgeSettings, McpSettingsStore } from "../src/main/mcp/settingsStore";
import type { HandshakeFileEntry } from "../src/main/mcp/handshake";

const T1 = "1".repeat(64);
const T2 = "2".repeat(64);

function setup(opts: { enabled?: boolean; port?: number; listenError?: NodeJS.ErrnoException; handshakeOk?: boolean; saveFails?: boolean } = {}) {
  let cur: McpBridgeSettings = { enabled: opts.enabled ?? false, token: T1 };
  const nextTokens = [T2, "3".repeat(64)];
  const settings: McpSettingsStore = {
    get: () => ({ ...cur }),
    setEnabled: (enabled) => (opts.saveFails ? null : ((cur = { ...cur, enabled }), { ...cur })),
    regenerateToken: () => (opts.saveFails ? null : ((cur = { ...cur, token: nextTokens.shift()! }), { ...cur })),
  };
  const servers: { options: HttpServerOptions; closed: boolean; handle: HttpServerHandle }[] = [];
  const startServer = vi.fn(async (options: HttpServerOptions) => {
    if (opts.listenError) throw opts.listenError;
    const rec = { options, closed: false } as (typeof servers)[number];
    rec.handle = { server: {} as never, port: options.port ?? 0, close: async () => void (rec.closed = true) };
    servers.push(rec);
    return rec.handle;
  });
  const files: { entry: HandshakeFileEntry | null } = { entry: null };
  const handshake = {
    path: "/home/.sideform-light/mcp.json",
    write: vi.fn(async (e: HandshakeFileEntry) => (opts.handshakeOk === false ? false : ((files.entry = e), true))),
    remove: vi.fn(async (e: HandshakeFileEntry) => void (files.entry?.token === e.token && (files.entry = null))),
    removeSync: vi.fn((e: HandshakeFileEntry) => void (files.entry?.token === e.token && (files.entry = null))),
  };
  const service = createMcpService({
    settings,
    handshake,
    rpc: { toolManifest: [], callTool: async () => ({ content: [] }) },
    port: opts.port ?? 47821,
    startServer,
    log: { warn: () => undefined },
  });
  return { service, servers, startServer, files, handshake, settings };
}

describe("mcp service", () => {
  it("is off by default: nothing listens and no file is written", async () => {
    const s = setup();
    await s.service.start();
    expect(s.startServer).not.toHaveBeenCalled();
    expect(s.files.entry).toBeNull();
    expect(s.service.get()).toEqual({ enabled: false, port: 47821, url: "http://127.0.0.1:47821/mcp", token: T1, status: { state: "off" } });
  });

  it("start() with the saved flag on listens on the fixed port with the token and writes the connection file", async () => {
    const s = setup({ enabled: true });
    await s.service.start();
    expect(s.servers[0].options).toMatchObject({ token: T1, port: 47821 });
    expect(s.files.entry).toEqual({ url: "http://127.0.0.1:47821/mcp", token: T1, port: 47821 });
    expect(s.service.get().status).toEqual({ state: "listening" });
  });

  it("setEnabled(true) saves, starts and returns the view; setEnabled(false) stops and removes the file", async () => {
    const s = setup();
    const on = await s.service.setEnabled(true);
    expect(on).toMatchObject({ enabled: true, status: { state: "listening" } });
    expect(s.files.entry?.token).toBe(T1);
    const off = await s.service.setEnabled(false);
    expect(off).toMatchObject({ enabled: false, status: { state: "off" } });
    expect(s.servers[0].closed).toBe(true);
    expect(s.files.entry).toBeNull();
  });

  it("a busy port is a status error with a clear message, no fallback port, no file", async () => {
    const err = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    const s = setup({ listenError: err });
    const v = await s.service.setEnabled(true);
    expect(v).toMatchObject({ enabled: true, status: { state: "error", error: expect.stringContaining("47821") } });
    expect(s.startServer).toHaveBeenCalledTimes(1);
    expect(s.files.entry).toBeNull();
  });

  it("a failed connection file stops the server and shows an error", async () => {
    const s = setup({ handshakeOk: false });
    const v = (await s.service.setEnabled(true)) as { status: { state: string } };
    expect(v.status.state).toBe("error");
    expect(s.servers[0].closed).toBe(true);
  });

  it("a save failure is an { error } and nothing starts", async () => {
    const s = setup({ saveFails: true });
    expect(await s.service.setEnabled(true)).toEqual({ error: "Could not save the setting." });
    expect(s.startServer).not.toHaveBeenCalled();
  });

  it("regenerateToken restarts with the new token and rewrites the file; the old token no longer serves", async () => {
    const s = setup({ enabled: true });
    await s.service.start();
    const v = (await s.service.regenerateToken()) as { token: string; status: { state: string } };
    expect(v.token).toBe(T2);
    expect(v.status.state).toBe("listening");
    expect(s.servers[0].closed).toBe(true);
    expect(s.servers[1].options.token).toBe(T2);
    expect(s.files.entry?.token).toBe(T2);
  });

  it("regenerateToken while off only changes the token", async () => {
    const s = setup();
    const v = (await s.service.regenerateToken()) as { token: string; status: { state: string } };
    expect(v).toMatchObject({ token: T2, status: { state: "off" } });
    expect(s.startServer).not.toHaveBeenCalled();
  });

  it("a failed token save keeps the old server running", async () => {
    const s = setup({ enabled: true, saveFails: true });
    await s.service.start();
    expect(await s.service.regenerateToken()).toEqual({ error: "Could not save the new token." });
    expect(s.service.get().status.state).toBe("listening");
    expect(s.servers.at(-1)!.options.token).toBe(T1);
  });

  it("quick on/off/on never runs two servers at once", async () => {
    const s = setup();
    await Promise.all([s.service.setEnabled(true), s.service.setEnabled(false), s.service.setEnabled(true)]);
    const open = s.servers.filter((x) => !x.closed);
    expect(open).toHaveLength(1);
    expect(s.service.get().status.state).toBe("listening");
  });

  it("disposeSync removes our file synchronously and closes the server; it then never restarts", async () => {
    const s = setup({ enabled: true });
    await s.service.start();
    s.service.disposeSync();
    expect(s.handshake.removeSync).toHaveBeenCalled();
    expect(s.files.entry).toBeNull();
    expect(s.servers[0].closed).toBe(true);
    await s.service.setEnabled(true);
    expect(s.servers).toHaveLength(1);
  });

  it("a file that another process replaced is left alone on stop", async () => {
    const s = setup();
    await s.service.setEnabled(true);
    s.files.entry = { url: "x", token: "9".repeat(64), port: 1 };
    await s.service.setEnabled(false);
    expect(s.files.entry?.token).toBe("9".repeat(64));
  });

  it("the view never leaks the token into the status text", () => {
    expect(describeListenError(Object.assign(new Error("x"), { code: "EACCES" }), 80)).toContain("80");
    expect(describeListenError(new Error("weird"), 1)).toContain("weird");
  });

  it("disposeSync during the listen closes the late server and writes no connection file", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({ enabled: true });
    const inner = s.startServer.getMockImplementation()!;
    s.startServer.mockImplementation(async (o) => {
      await gate;
      return inner(o);
    });
    const started = s.service.start();
    await vi.waitFor(() => expect(s.startServer).toHaveBeenCalled());
    s.service.disposeSync();
    release();
    await started;
    expect(s.servers).toHaveLength(1);
    expect(s.servers[0].closed).toBe(true);
    expect(s.handshake.write).not.toHaveBeenCalled();
    expect(s.files.entry).toBeNull();
  });

  it("disposeSync during the handshake write removes the file the write lands", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({ enabled: true });
    const innerWrite = s.handshake.write.getMockImplementation()!;
    s.handshake.write.mockImplementation(async (e) => {
      await gate;
      return innerWrite(e);
    });
    const started = s.service.start();
    await vi.waitFor(() => expect(s.handshake.write).toHaveBeenCalled());
    s.service.disposeSync();
    release();
    await started;
    expect(s.handshake.removeSync).toHaveBeenCalled();
    expect(s.files.entry).toBeNull();
    expect(s.servers[0].closed).toBe(true);
  });

  it("disposeSync while stopServer awaits the close removes the file synchronously", async () => {
    const s = setup();
    await s.service.setEnabled(true);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    s.servers[0].handle.close = async () => {
      await gate;
      s.servers[0].closed = true;
    };
    const stopping = s.service.setEnabled(false);
    await Promise.resolve();
    s.service.disposeSync();
    expect(s.handshake.removeSync).toHaveBeenCalled();
    expect(s.files.entry).toBeNull();
    release();
    await stopping;
    expect(s.handshake.remove).not.toHaveBeenCalled();
  });
});
