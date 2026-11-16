// The `/api/*` proxy of the `app://sideform` handler. Electron-free (Request/Response/fetch are Node globals):
// the decision which headers cross, and the forwarding itself, are unit-tested with an injected `fetch`.
import { APP_HOST, APP_SCHEME } from "./config";

/** Where an `/api` request goes: the bundled backend (origin + token) or a dev origin (no token). */
export interface ApiTarget {
  origin: string;
  /** Absent for a SIDEFORM_LIGHT_BACKEND_URL override. */
  token?: string;
}

export const TOKEN_HEADER = "x-sideform-local-token";
/**
 * How long a request waits for the backend to be ready before the 502. Longer than the backend's own ready timeout
 * (`READY_TIMEOUT_MS`, 20 s, localBackend.ts) so a slow first start still gets one kill-and-restart window.
 */
export const API_READY_WAIT_MS = 25_000;

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);

/** The path+query to forward when `rawUrl` is `app://sideform/api` or `app://sideform/api/...`; otherwise null. */
export function apiPathOf(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return null;
  return url.pathname + url.search;
}

/** Request headers for the backend: no hop-by-hop, host, cookie or incoming token header; the token is added when given. */
export function buildUpstreamRequestHeaders(incoming: Headers, token?: string): Headers {
  const out = new Headers();
  incoming.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "host" || lower === "cookie" || lower === TOKEN_HEADER) return;
    out.append(name, value);
  });
  if (token) out.set("X-Sideform-Local-Token", token);
  return out;
}

/** Response headers for the renderer: the upstream ones minus hop-by-hop and the ones `fetch` already consumed (encoding, length). */
export function buildClientResponseHeaders(upstream: Headers, extra: Record<string, string>): Headers {
  const out = new Headers();
  upstream.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "content-encoding" || lower === "content-length") return;
    out.append(name, value);
  });
  for (const [name, value] of Object.entries(extra)) out.set(name, value);
  return out;
}

/**
 * 502, never 503: the chat client's retryFetch retries 408/429/503 with backoff (about a minute of spinner), while a 502
 * surfaces at once as the readable "local agent service is not running" error.
 */
function unavailable(extra: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "local_backend_unavailable" }), {
    status: 502,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

export interface ProxyDeps {
  /** Waits for the backend (up to the given ms); null when it is not available. */
  target(waitMs: number): Promise<ApiTarget | null>;
  fetch: typeof fetch;
  /** Headers added to every response (CSP, nosniff). */
  responseHeaders: Record<string, string>;
  waitMs?: number;
}

/** Forwards one `/api` request (`pathAndQuery` from `apiPathOf`). Never throws. */
export async function proxyApiRequest(request: Request, pathAndQuery: string, deps: ProxyDeps): Promise<Response> {
  const target = await deps.target(deps.waitMs ?? API_READY_WAIT_MS);
  if (!target) return unavailable(deps.responseHeaders);
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  try {
    const upstream = await deps.fetch(new URL(pathAndQuery, target.origin).toString(), {
      method: request.method,
      headers: buildUpstreamRequestHeaders(request.headers, target.token),
      body: hasBody ? request.body : undefined,
      // Node's fetch needs it for a streamed request body.
      ...(hasBody ? { duplex: "half" } : {}),
      // Harmless but inert: Electron 43's protocol.handle Request signal never fires. A renderer abort instead
      // cancels the response body below, which closes the upstream connection.
      signal: request.signal,
      redirect: "manual",
    } as RequestInit);
    // The upstream body stream itself, not buffered: cancelling it (renderer abort) cancels the upstream read.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: buildClientResponseHeaders(upstream.headers, deps.responseHeaders),
    });
  } catch (err) {
    console.error("[backend] proxy request failed", String(err));
    return unavailable(deps.responseHeaders);
  }
}
