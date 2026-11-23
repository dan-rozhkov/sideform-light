import { describe, it, expect, vi } from "vitest";
import { toSetDetails, startCookieCopy, type CookieLike } from "../src/main/browser/cookieCopy";

const NOW = 1_800_000_000;
const base: CookieLike = { name: "sid", value: "SECRETVAL", domain: "x.com", hostOnly: true, path: "/", sameSite: "lax" };

describe("toSetDetails", () => {
  it("keeps a host-only cookie host-only (no domain)", () => {
    const d = toSetDetails(base, NOW)!;
    expect(d.domain).toBeUndefined();
    expect(d.url).toBe("http://x.com/");
  });
  it("passes domain (dotted) only for a domain cookie, url without the dot", () => {
    const d = toSetDetails({ ...base, domain: ".x.com", hostOnly: false, path: "/app" }, NOW)!;
    expect(d.domain).toBe(".x.com");
    expect(d.url).toBe("http://x.com/app");
    expect(d.path).toBe("/app");
  });
  it("uses https for a secure cookie and keeps flags", () => {
    const d = toSetDetails({ ...base, secure: true, httpOnly: true }, NOW)!;
    expect(d.url).toBe("https://x.com/");
    expect(d.secure).toBe(true);
    expect(d.httpOnly).toBe(true);
  });
  it("__Host- is host-only, secure, path /", () => {
    const d = toSetDetails({ ...base, name: "__Host-a", domain: ".x.com", hostOnly: false, path: "/p", secure: false }, NOW)!;
    expect(d.domain).toBeUndefined();
    expect(d.secure).toBe(true);
    expect(d.path).toBe("/");
    expect(d.url).toBe("https://x.com/");
  });
  it("__Secure- becomes secure", () => {
    expect(toSetDetails({ ...base, name: "__Secure-a" }, NOW)!.url).toBe("https://x.com/");
  });
  it("session cookie has no expirationDate, persistent keeps it", () => {
    expect(toSetDetails({ ...base, session: true, expirationDate: NOW + 5 }, NOW)!.expirationDate).toBeUndefined();
    expect(toSetDetails({ ...base, session: false, expirationDate: NOW + 5 }, NOW)!.expirationDate).toBe(NOW + 5);
  });
  it("skips an expired cookie", () => {
    expect(toSetDetails({ ...base, session: false, expirationDate: NOW - 1 }, NOW)).toBeNull();
  });
  it("skips a cookie with no host", () => {
    expect(toSetDetails({ ...base, domain: "" }, NOW)).toBeNull();
  });
  it("SameSite=None without Secure becomes unspecified; with Secure it stays", () => {
    expect(toSetDetails({ ...base, sameSite: "no_restriction", secure: false }, NOW)!.sameSite).toBe("unspecified");
    expect(toSetDetails({ ...base, sameSite: "no_restriction", secure: true }, NOW)!.sameSite).toBe("no_restriction");
  });
  it("an unset hostOnly with a dotted domain is a domain cookie; undotted is host-only", () => {
    expect(toSetDetails({ ...base, hostOnly: undefined, domain: ".x.com" }, NOW)!.domain).toBe(".x.com");
    expect(toSetDetails({ ...base, hostOnly: undefined, domain: "x.com" }, NOW)!.domain).toBeUndefined();
  });
  it("maps sameSite, unknown becomes unspecified", () => {
    for (const s of ["unspecified", "no_restriction", "lax", "strict"] as const) {
      expect(toSetDetails({ ...base, secure: true, sameSite: s }, NOW)!.sameSite).toBe(s);
    }
    expect(toSetDetails({ ...base, sameSite: undefined }, NOW)!.sameSite).toBe("unspecified");
  });
});

describe("startCookieCopy", () => {
  const store = (cookies: CookieLike[], set = vi.fn(async () => {})) => ({ cookies: { get: async () => cookies, set } });
  const run = (from: never, to: never, opts = {}) => startCookieCopy(from, to, { nowSec: NOW, log: () => {}, ...opts });

  it("keeps going when one cookie fails and counts it", async () => {
    const set = vi.fn(async (d: { name: string }) => {
      if (d.name === "bad") throw new Error("nope");
    });
    const log = vi.fn();
    const r = await run(store([{ ...base, name: "a" }, { ...base, name: "bad" }, { ...base, name: "c" }]) as never, store([], set as never) as never, { log }).wait();
    expect(r).toMatchObject({ copied: 2, failed: 1, timedOut: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("1 cookie"));
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRETVAL");
  });

  it("wait gives up when the read hangs", async () => {
    const hang = { cookies: { get: () => new Promise<CookieLike[]>(() => {}), set: async () => {} } };
    expect((await run(hang as never, store([]) as never, { timeoutMs: 20 }).wait()).timedOut).toBe(true);
  });

  it("does not throw when the read rejects", async () => {
    const bad = { cookies: { get: async (): Promise<CookieLike[]> => Promise.reject(new Error("x")), set: async () => {} } };
    expect((await run(bad as never, store([]) as never).wait()).failed).toBe(1);
  });

  it("slow get -> timeout -> cancel: no set ever starts after the cancel, and done settles", async () => {
    let release: (c: CookieLike[]) => void = () => {};
    const slow = { cookies: { get: () => new Promise<CookieLike[]>((r) => (release = r)), set: async () => {} } };
    const set = vi.fn(async () => {});
    const copy = run(slow as never, store([], set) as never, { timeoutMs: 10 });
    expect((await copy.wait()).timedOut).toBe(true);
    copy.cancel();
    release([{ ...base, name: "a" }, { ...base, name: "b" }]);
    const r = await copy.done;
    expect(set).not.toHaveBeenCalled();
    expect(r.cancelled).toBe(true);
  });

  it("cancel mid-copy stops later writes; done waits for writes already started", async () => {
    const finished: string[] = [];
    let first: () => void = () => {};
    const set = vi.fn(
      (d: { name: string }) =>
        new Promise<void>((r) => {
          if (d.name === "a") first = () => (finished.push("a"), r());
          else r();
        }),
    );
    const copy = run(store([{ ...base, name: "a" }, { ...base, name: "b" }]) as never, store([], set as never) as never);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    copy.cancel();
    first();
    await copy.done;
    expect(finished).toEqual(["a"]);
  });
});
