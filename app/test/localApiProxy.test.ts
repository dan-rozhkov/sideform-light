import { describe, it, expect } from "vitest";
import { READY_TIMEOUT_MS } from "../src/main/localBackend";
import { API_READY_WAIT_MS, apiPathOf, buildClientResponseHeaders, buildUpstreamRequestHeaders, proxyApiRequest } from "../src/main/localApiProxy";

describe("apiPathOf", () => {
  it("matches /api and /api/... on app://sideform and keeps the query", () => {
    expect(apiPathOf("app://sideform/api")).toBe("/api");
    expect(apiPathOf("app://sideform/api/models")).toBe("/api/models");
    expect(apiPathOf("app://sideform/api/chat?x=1&y=%20")).toBe("/api/chat?x=1&y=%20");
  });
  it("rejects other paths, hosts and schemes", () => {
    expect(apiPathOf("app://sideform/apix")).toBeNull();
    expect(apiPathOf("app://sideform/agent")).toBeNull();
    expect(apiPathOf("app://sideform/x/api/y")).toBeNull();
    expect(apiPathOf("app://other/api/x")).toBeNull();
    expect(apiPathOf("http://sideform/api/x")).toBeNull();
    expect(apiPathOf("not a url")).toBeNull();
  });
  it("normalises dot segments out of /api", () => {
    expect(apiPathOf("app://sideform/api/../agent")).toBeNull();
  });
});

describe("buildUpstreamRequestHeaders", () => {
  it("drops hop-by-hop, host, cookie and an incoming token; adds the token", () => {
    const h = buildUpstreamRequestHeaders(
      new Headers({ accept: "text/event-stream", "content-type": "application/json", cookie: "a=b", host: "sideform", connection: "keep-alive", "x-sideform-local-token": "evil", "x-custom": "1" }),
      "TOK",
    );
    expect(Object.fromEntries(h)).toEqual({ accept: "text/event-stream", "content-type": "application/json", "x-custom": "1", "x-sideform-local-token": "TOK" });
  });
  it("adds no token for the dev override", () => {
    expect(buildUpstreamRequestHeaders(new Headers({ "X-Sideform-Local-Token": "evil" })).has("x-sideform-local-token")).toBe(false);
  });
});

describe("buildClientResponseHeaders", () => {
  it("keeps content headers, drops hop-by-hop and consumed encoding/length, adds ours", () => {
    const h = buildClientResponseHeaders(
      new Headers({ "content-type": "text/event-stream", "transfer-encoding": "chunked", "content-encoding": "gzip", "content-length": "3", "x-a": "1", "content-security-policy": "upstream" }),
      { "Content-Security-Policy": "ours", "X-Content-Type-Options": "nosniff" },
    );
    expect(Object.fromEntries(h)).toEqual({ "content-type": "text/event-stream", "x-a": "1", "content-security-policy": "ours", "x-content-type-options": "nosniff" });
  });
});

describe("proxyApiRequest", () => {
  const responseHeaders = { "Content-Security-Policy": "csp", "X-Content-Type-Options": "nosniff" };

  it("forwards method, headers, body and signal to origin+path+query and streams the response back", async () => {
    let seen: { url: string; init: RequestInit & { duplex?: string } } | null = null;
    const ctrl = new AbortController();
    const request = new Request("app://sideform/api/chat?a=1", { method: "POST", body: '{"q":1}', headers: { "content-type": "application/json", cookie: "x" }, signal: ctrl.signal });
    const res = await proxyApiRequest(request, "/api/chat?a=1", {
      target: async () => ({ origin: "http://127.0.0.1:5000", token: "T" }),
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response("data: 1\n\n", { status: 201, headers: { "content-type": "text/event-stream", "x-up": "1" } });
      }) as unknown as typeof fetch,
      responseHeaders,
    });
    expect(seen!.url).toBe("http://127.0.0.1:5000/api/chat?a=1");
    expect(seen!.init.method).toBe("POST");
    expect(seen!.init.duplex).toBe("half");
    expect(seen!.init.signal).toBe(request.signal);
    const sent = seen!.init.headers as Headers;
    expect(sent.get("x-sideform-local-token")).toBe("T");
    expect(sent.has("cookie")).toBe(false);
    expect(await new Response(seen!.init.body as ReadableStream).text()).toBe('{"q":1}');
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-up")).toBe("1");
    expect(res.headers.get("content-security-policy")).toBe("csp");
    expect(await res.text()).toBe("data: 1\n\n");
  });

  it("sends no body for GET and no token for the dev override", async () => {
    let init: (RequestInit & { duplex?: string }) | null = null;
    await proxyApiRequest(new Request("app://sideform/api/models"), "/api/models", {
      target: async () => ({ origin: "http://localhost:3001" }),
      fetch: (async (_u: string, i: RequestInit) => {
        init = i;
        return new Response("{}");
      }) as unknown as typeof fetch,
      responseHeaders,
    });
    expect(init!.body).toBeUndefined();
    expect(init!.duplex).toBeUndefined();
    expect((init!.headers as Headers).has("x-sideform-local-token")).toBe(false);
  });

  it("answers 502 local_backend_unavailable (never the retried 503) when the backend is not available", async () => {
    let waited = -1;
    const res = await proxyApiRequest(new Request("app://sideform/api/x"), "/api/x", {
      target: async (ms) => ((waited = ms), null),
      fetch: (async () => {
        throw new Error("must not be called");
      }) as unknown as typeof fetch,
      responseHeaders,
    });
    expect(waited).toBe(25_000);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "local_backend_unavailable" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("answers 502 local_backend_unavailable on an upstream network error", async () => {
    const res = await proxyApiRequest(new Request("app://sideform/api/x"), "/api/x", {
      target: async () => ({ origin: "http://127.0.0.1:1", token: "T" }),
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      responseHeaders,
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "local_backend_unavailable" });
  });

  it("waits longer for the backend than the backend's own ready timeout", () => {
    expect(API_READY_WAIT_MS).toBeGreaterThan(READY_TIMEOUT_MS);
  });

  it("returns the upstream body as a stream: cancelling the response body cancels the upstream", async () => {
    let cancelled = false;
    const upstreamBody = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode("data: x\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const res = await proxyApiRequest(new Request("app://sideform/api/chat"), "/api/chat", {
      target: async () => ({ origin: "http://127.0.0.1:1", token: "T" }),
      fetch: (async () => new Response(upstreamBody)) as unknown as typeof fetch,
      responseHeaders,
    });
    const reader = res.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    expect(cancelled).toBe(true);
  });
});
