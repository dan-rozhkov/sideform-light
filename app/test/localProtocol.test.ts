import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SCHEME_PRIVILEGES, buildCsp, mimeTypeFor, resolveAppRequest } from "../src/main/localProtocol";

const DIST = path.resolve("/opt/app/dist/ui");
const files = new Set([path.join(DIST, "index.html"), path.join(DIST, "assets", "app-abc.js"), path.join(DIST, "assets", "style.css"), path.join(DIST, "logo.svg")]);
const isFile = (p: string) => files.has(p);
const resolve = (url: string) => resolveAppRequest(url, DIST, isFile);
const INDEX = { status: 200, filePath: path.join(DIST, "index.html"), mimeType: "text/html; charset=utf-8" };

describe("scheme privileges", () => {
  it("pin the contract: standard, secure, fetch, CORS", () => {
    expect(APP_SCHEME_PRIVILEGES).toEqual({ standard: true, secure: true, supportFetchAPI: true, corsEnabled: true });
  });
});

describe("resolveAppRequest", () => {
  it("serves an existing file with its MIME type", () => {
    expect(resolve("app://sideform/assets/app-abc.js")).toEqual({ status: 200, filePath: path.join(DIST, "assets", "app-abc.js"), mimeType: "text/javascript; charset=utf-8" });
    expect(resolve("app://sideform/assets/style.css?v=1#x")).toEqual({ status: 200, filePath: path.join(DIST, "assets", "style.css"), mimeType: "text/css; charset=utf-8" });
    expect(resolve("app://sideform/logo.svg")).toMatchObject({ status: 200, mimeType: "image/svg+xml" });
  });

  it("falls back to index.html for SPA routes and the root", () => {
    expect(resolve("app://sideform/agent")).toEqual(INDEX);
    expect(resolve("app://sideform/trace/abc123?src=local")).toEqual(INDEX);
    expect(resolve("app://sideform/settings?section=browser")).toEqual(INDEX);
    expect(resolve("app://sideform/")).toEqual(INDEX);
    expect(resolve("app://sideform")).toEqual(INDEX);
  });

  it("falls back to index.html for a missing file and for a directory", () => {
    expect(resolve("app://sideform/assets/missing.js")).toEqual(INDEX);
    expect(resolve("app://sideform/assets")).toEqual(INDEX);
  });

  it("rejects any host but sideform", () => {
    expect(resolve("app://evil/agent")).toEqual({ status: 404 });
    expect(resolve("app://sideform.evil.com/agent")).toEqual({ status: 404 });
    expect(resolve("app://sideformx/index.html")).toEqual({ status: 404 });
  });

  it("rejects another scheme", () => {
    expect(resolve("https://sideform/agent")).toEqual({ status: 404 });
    expect(resolve("file:///etc/passwd")).toEqual({ status: 404 });
    expect(resolve("not a url")).toEqual({ status: 404 });
  });

  it("never leaves the dist dir (plain, encoded and double-encoded traversal)", () => {
    // URL parsing already resolves a literal `..` and a `%2e%2e` segment: they collapse to the root and
    // reach the handler as an SPA path. An encoded slash survives parsing and decodes to `../`.
    expect(resolve("app://sideform/../../etc/passwd")).toEqual(INDEX);
    expect(resolve("app://sideform/%2e%2e/%2e%2e/etc/passwd")).toEqual(INDEX);
    expect(resolve("app://sideform/assets/%2e%2e/%2e%2e/%2e%2e/etc/passwd")).toEqual(INDEX);
    expect(resolve("app://sideform/%2e%2e%2fsecret")).toEqual({ status: 404 });
    expect(resolve("app://sideform/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd")).toEqual({ status: 404 });
    expect(resolve("app://sideform/%2E%2E%2Fsecret")).toEqual({ status: 404 });
    expect(resolve("app://sideform/..%5csecret")).toEqual({ status: 404 });
    expect(resolve("app://sideform/%00")).toEqual({ status: 404 });
    expect(resolve("app://sideform/%E0%A4%A")).toEqual({ status: 404 });
  });

  it("a sibling directory with the same prefix is outside the dist dir", () => {
    expect(resolve("app://sideform/%2e%2e%2fui-secret%2fkey.txt")).toEqual({ status: 404 });
  });

  it("never hands out a path outside the dist dir for a 200", () => {
    for (const url of ["app://sideform/a/b/../../assets/style.css", "app://sideform/./assets/app-abc.js", "app://sideform//assets//app-abc.js"]) {
      const r = resolve(url);
      if (r.status === 200) expect(r.filePath.startsWith(DIST + path.sep)).toBe(true);
    }
  });
});

describe("mimeTypeFor", () => {
  it("maps the common web types", () => {
    expect(mimeTypeFor("a.html")).toBe("text/html; charset=utf-8");
    expect(mimeTypeFor("a.mjs")).toBe("text/javascript; charset=utf-8");
    expect(mimeTypeFor("a.json")).toBe("application/json; charset=utf-8");
    expect(mimeTypeFor("a.woff2")).toBe("font/woff2");
    expect(mimeTypeFor("a.PNG")).toBe("image/png");
    expect(mimeTypeFor("a.wasm")).toBe("application/wasm");
  });
  it("falls back to octet-stream", () => {
    expect(mimeTypeFor("a.unknown")).toBe("application/octet-stream");
    expect(mimeTypeFor("noext")).toBe("application/octet-stream");
  });
});

describe("buildCsp", () => {
  it("is the contract policy with the backend origin in connect-src", () => {
    expect(buildCsp("http://localhost:3001")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' http://localhost:3001; frame-src 'none'; object-src 'none'; base-uri 'none'",
    );
  });
  it("names the configured backend", () => {
    expect(buildCsp("https://api.example.com")).toContain("connect-src 'self' https://api.example.com;");
  });
});
