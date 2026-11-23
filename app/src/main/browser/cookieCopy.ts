// Copies the cookies of the shared browser profile (`persist:penbrowser`) into an isolated
// session partition when the session starts, so an agent run sees the user's logins.
// Only cookies: localStorage / IndexedDB are never copied. The isolated partition is a
// separate in-memory store; nothing set there flows back (the teardown wipe clears it).
//
// The conversion is pure (`toSetDetails`); `copyCookies` is the thin Electron adapter.
// Cookie values are never logged.

/** The subset of Electron.Cookie we read. */
export interface CookieLike {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

/** The subset of Electron.CookiesSetDetails we produce. */
export interface CookieSetDetailsLike {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

const SAME_SITE = new Set(["unspecified", "no_restriction", "lax", "strict"]);

/**
 * One cookie as `cookies.set` details, or null when it must not be copied (expired, no
 * host). Host-only cookies stay host-only (no `domain`); `__Host-` cookies are always
 * host-only, secure, path "/"; `__Secure-` cookies are secure. `nowSec` is injected for tests.
 */
export function toSetDetails(c: CookieLike, nowSec: number = Date.now() / 1000): CookieSetDetailsLike | null {
  const host = (c.domain ?? "").replace(/^\./, "");
  if (!host || !c.name) return null;
  // A session cookie has no expirationDate; a persistent one must still be in the future.
  const persistent = c.session === false || (c.session === undefined && typeof c.expirationDate === "number");
  if (persistent && typeof c.expirationDate === "number" && c.expirationDate <= nowSec) return null;

  const isHostPrefix = c.name.startsWith("__Host-");
  const secure = Boolean(c.secure) || isHostPrefix || c.name.startsWith("__Secure-");
  // Chromium rejects SameSite=None without Secure.
  const sameSiteIn = c.sameSite && SAME_SITE.has(c.sameSite) ? c.sameSite : "unspecified";
  const sameSite = sameSiteIn === "no_restriction" && !secure ? "unspecified" : sameSiteIn;
  const path = isHostPrefix ? "/" : c.path || "/";
  const details: CookieSetDetailsLike = {
    url: `${secure ? "https" : "http"}://${host}${path}`,
    name: c.name,
    value: c.value,
    path,
    secure,
    httpOnly: Boolean(c.httpOnly),
    sameSite,
  };
  // An unset hostOnly with a dotted domain is a domain cookie.
  const hostOnly = c.hostOnly ?? !(c.domain ?? "").startsWith(".");
  // Only a domain cookie gets `domain` (Electron then adds the leading dot).
  if (!hostOnly && !isHostPrefix) details.domain = c.domain!.startsWith(".") ? c.domain! : `.${c.domain}`;
  if (persistent && typeof c.expirationDate === "number") details.expirationDate = c.expirationDate;
  return details;
}

export interface CookieStoreLike<D> {
  cookies: {
    get(filter: Record<string, never>): Promise<CookieLike[]>;
    set(details: D): Promise<void>;
  };
}

export interface CopyResult {
  copied: number;
  skipped: number;
  failed: number;
  timedOut: boolean;
  cancelled: boolean;
}

export const COOKIE_COPY_TIMEOUT_MS = 3000;

export interface CookieCopy {
  /** The whole copy (no timeout). Never rejects. Teardown awaits THIS before the wipe. */
  done: Promise<CopyResult>;
  /** `done`, but gives up waiting after the timeout (the work keeps running unless cancelled). Never rejects. */
  wait(): Promise<CopyResult>;
  /** No further `set` will start; one already in flight settles inside `done`. */
  cancel(): void;
}

/**
 * Starts copying every cookie of `from` into `to`. One failing cookie does not stop the rest.
 * `wait()` is bounded (a hung read or write must not hold the session's creator), but the work
 * is not: after `cancel()` no `set` starts (checked after the read and before every write), and
 * `done` settles only when the writes already started have. Never logs values.
 */
export function startCookieCopy<D extends CookieSetDetailsLike>(
  from: CookieStoreLike<D>,
  to: CookieStoreLike<D>,
  opts: { timeoutMs?: number; log?: (msg: string) => void; nowSec?: number } = {},
): CookieCopy {
  const timeoutMs = opts.timeoutMs ?? COOKIE_COPY_TIMEOUT_MS;
  const log = opts.log ?? (() => {});
  const result: CopyResult = { copied: 0, skipped: 0, failed: 0, timedOut: false, cancelled: false };
  const inflight: Promise<void>[] = [];
  const done = (async () => {
    const all = await from.cookies.get({});
    for (const c of all) {
      if (result.cancelled) break;
      const d = toSetDetails(c, opts.nowSec);
      if (!d) {
        result.skipped++;
        continue;
      }
      inflight.push(
        to.cookies.set(d as D).then(
          () => void result.copied++,
          () => void result.failed++,
        ),
      );
    }
    await Promise.allSettled(inflight);
  })()
    .catch((err) => {
      result.failed++;
      log(`browser session: reading the shared cookies failed (${err instanceof Error ? err.name : "error"})`);
    })
    .then(() => {
      if (result.failed > 0) log(`browser session: ${result.failed} cookie(s) could not be copied`);
      return result;
    });
  return {
    done,
    cancel: () => {
      result.cancelled = true;
    },
    async wait() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          result.timedOut = true;
          resolve();
        }, timeoutMs);
      });
      await Promise.race([done, timeout]);
      clearTimeout(timer);
      if (result.timedOut) log(`browser session: cookie copy timed out after ${timeoutMs} ms, continuing with ${result.copied} cookies`);
      return result;
    },
  };
}
