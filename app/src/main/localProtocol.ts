// The `app://sideform` scheme: the bundled ui (ui/dist, copied to dist/ui) served to the agent panel, the
// trace page and the settings page. Pure and Electron-free: the decision "which file answers this URL", the
// MIME table and the CSP string live here and are unit-tested; index.ts only wires `protocol.handle`.
import * as path from "node:path";
import { APP_HOST, APP_SCHEME } from "./config";

/** `registerSchemesAsPrivileged` entry. Must be registered BEFORE `app.ready`. */
export const APP_SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } as const;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
};

/** The Content-Type of a file path (by extension); unknown extensions are `application/octet-stream`. */
export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** The Content-Security-Policy of every ui response. `backendOrigin` is the one origin the ui may call. */
export function buildCsp(backendOrigin: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    `connect-src 'self' data: blob: ${backendOrigin}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** A path the SPA fallback may answer: not under `/assets/` and no file extension in the last segment. */
export function isSpaRoute(pathname: string): boolean {
  if (pathname === "/assets" || pathname.startsWith("/assets/")) return false;
  return path.posix.extname(pathname) === "";
}

export type AppRequestResolution = { status: 404 } | { status: 200; filePath: string; mimeType: string };

/**
 * Decides which file answers `rawUrl`:
 * - not `app://sideform/...` (wrong scheme or host) -> 404;
 * - the path (percent-decoded) leaves `distDir` -> 404;
 * - it names an existing file inside `distDir` -> that file;
 * - anything else is a missing file: a path under `/assets/` or whose last segment has a file extension -> 404
 *   (a stale hashed chunk must fail, not load HTML as a script); a route-like path -> `index.html` (SPA fallback).
 * `isFile` is injected (a synchronous stat) so the rule is testable without a disk.
 */
export function resolveAppRequest(rawUrl: string, distDir: string, isFile: (absolutePath: string) => boolean): AppRequestResolution {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { status: 404 };
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return { status: 404 };
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { status: 404 };
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return { status: 404 };
  const root = path.resolve(distDir);
  const target = path.resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(root + path.sep)) return { status: 404 };
  if (target !== root && isFile(target)) return { status: 200, filePath: target, mimeType: mimeTypeFor(target) };
  if (!isSpaRoute(pathname)) return { status: 404 };
  const index = path.join(root, "index.html");
  return { status: 200, filePath: index, mimeType: mimeTypeFor(index) };
}
