import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import { startHttpServer, type HttpServerHandle } from "../src/main/mcp/httpServer";
import type { JsonRpcDeps, ToolManifestEntry } from "../src/main/mcp/jsonRpc";
import type { McpToolResult as ToolCallResult } from "../src/main/mcp/types";

const TOKEN = "a".repeat(64);

const manifest: ToolManifestEntry[] = [
  { name: "list_tasks", description: "desc", inputSchema: { type: "object" } },
];

function makeDeps(): JsonRpcDeps {
  return {
    toolManifest: manifest,
    callTool: vi.fn(async (): Promise<ToolCallResult> => ({ content: [{ type: "text", text: "ok" }] })),
  };
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

// Uses node:http's client directly (not fetch) so tests can set an
// arbitrary Host header — the whole point of the DNS-rebinding test below —
// which the fetch/undici client normalizes away.
function post(
  port: number,
  body: string,
  overrides: { host?: string; origin?: string; token?: string | null; path?: string; method?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: overrides.host ?? `127.0.0.1:${port}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (overrides.token !== null) {
      headers.Authorization = `Bearer ${overrides.token ?? TOKEN}`;
    }
    if (overrides.origin !== undefined) {
      headers.Origin = overrides.origin;
    }
    const req = request(
      { host: "127.0.0.1", port, path: overrides.path ?? "/mcp", method: overrides.method ?? "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("httpServer", () => {
  let handle: HttpServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("missing token -> 401", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    const res = await post(handle.port, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), { token: null });
    expect(res.status).toBe(401);
  });

  it("wrong token -> 401", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    const res = await post(handle.port, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), {
      token: "b".repeat(64),
    });
    expect(res.status).toBe(401);
  });

  it("correct token -> 200 application/json", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    const res = await post(handle.port, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("Origin header present -> 403, even with a correct token", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    const res = await post(handle.port, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), {
      origin: "https://evil.test",
    });
    expect(res.status).toBe(403);
  });

  it("Host header not 127.0.0.1:<port>/localhost:<port> -> 403", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    const res = await post(handle.port, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), {
      host: "attacker.test",
    });
    expect(res.status).toBe(403);
  });

  it("accepts a Host header of localhost:<port> too", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    const res = await post(handle.port, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), {
      host: `localhost:${handle.port}`,
    });
    expect(res.status).toBe(200);
  });

  it("oversized body -> 413", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0, maxBodyBytes: 100 });
    const bigBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(500) } });
    const res = await post(handle.port, bigBody);
    expect(res.status).toBe(413);
  });

  it("binds only to loopback (port 0 asks the OS for a free port)", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    expect(handle.port).toBeGreaterThan(0);
    const address = handle.server.address();
    expect(typeof address === "object" && address?.address).toBe("127.0.0.1");
  });

  it("routes tools/call through the injected dispatcher", async () => {
    const deps = makeDeps();
    handle = await startHttpServer({ token: TOKEN, deps, port: 0 });
    const res = await post(
      handle.port,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_tasks", arguments: {} } }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).result).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(deps.callTool).toHaveBeenCalledWith("list_tasks", {});
  });

  it("GET /mcp -> 405 with Allow: POST (no stream is offered), before any auth", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    for (const method of ["GET", "DELETE", "PUT"]) {
      const res = await post(handle.port, "", { method, token: null });
      expect(res.status, method).toBe(405);
      expect(res.headers.allow).toBe("POST");
    }
  });

  it("any path but /mcp -> 404", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    for (const path of ["/", "/api/mcp", "/mcp/", "/mcpx"]) {
      expect((await post(handle.port, "{}", { path })).status, path).toBe(404);
    }
    expect((await post(handle.port, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), { path: "/mcp?x=1" })).status).toBe(200);
  });

  it("a busy port rejects with EADDRINUSE, and nothing else is listening afterwards", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    await expect(startHttpServer({ token: TOKEN, deps: makeDeps(), port: handle.port })).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("a notification gets an empty 202, not a JSON body", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    const res = await post(handle.port, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
    expect(res.body).toBe("");
  });

  // Finding 6: server.removeListener("error", reject) fires once listening
  // succeeds and nothing re-attaches an 'error' handler in the original
  // code, so a post-listen error (EMFILE/ENFILE on accept, which
  // http.Server emits as 'error') reaches an EventEmitter with no listener
  // — Node re-throws that synchronously, crashing the whole Electron main
  // process over a failure in this background diagnostic server.
  it("a post-listen 'error' event is caught by a permanent handler, not left to crash the process", async () => {
    const onError = vi.fn();
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0, onError });

    expect(() => handle!.server.emit("error", new Error("EMFILE: too many open files"))).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("defaults to a logging handler (not an unhandled throw) when no onError is supplied", async () => {
    handle = await startHttpServer({ token: TOKEN, deps: makeDeps(), port: 0 });
    // No onError injected — relies on startHttpServer's own default. An
    // EventEmitter with zero 'error' listeners throws synchronously on
    // emit(), so simply not throwing here proves a permanent default
    // listener is attached.
    expect(() => handle!.server.emit("error", new Error("ENFILE"))).not.toThrow();
  });
});
