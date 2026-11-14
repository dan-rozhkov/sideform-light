import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandshake, generateToken, isLoopbackAddress, isValidToken, type HandshakeFileEntry } from "../src/main/mcp/handshake";

// Never touches the real ~/.sideform-light: the home dir is injected.
const warnings: string[] = [];
const log = { warn: (m: string) => void warnings.push(m) };
const entry = (over: Partial<HandshakeFileEntry> = {}): HandshakeFileEntry => ({ url: "http://127.0.0.1:47821/mcp", token: generateToken(), port: 47821, ...over });

describe("handshake file", () => {
  let home = "";
  let hs: ReturnType<typeof createHandshake>;
  beforeEach(async () => {
    warnings.length = 0;
    home = await mkdtemp(join(tmpdir(), "sideform-home-"));
    hs = createHandshake({ homeDir: () => home, log });
  });
  afterEach(() => rm(home, { recursive: true, force: true }));

  it("lives at ~/.sideform-light/mcp.json", () => {
    expect(hs.path).toBe(join(home, ".sideform-light", "mcp.json"));
  });

  it("dir 0700, file 0600, exactly { url, token, port }, no temp file left", async () => {
    const e = entry();
    expect(await hs.write(e)).toBe(true);
    expect((await stat(join(home, ".sideform-light"))).mode & 0o777).toBe(0o700);
    expect((await stat(hs.path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(hs.path, "utf8"))).toEqual(e);
    expect(await readdir(join(home, ".sideform-light"))).toEqual(["mcp.json"]);
  });

  it("tightens a pre-existing loose directory", async () => {
    await mkdir(join(home, ".sideform-light"), { mode: 0o755 });
    await hs.write(entry());
    expect((await stat(join(home, ".sideform-light"))).mode & 0o777).toBe(0o700);
  });

  it("replaces an older file", async () => {
    await hs.write(entry({ port: 1111 }));
    const e = entry({ port: 2222 });
    await hs.write(e);
    expect(JSON.parse(await readFile(hs.path, "utf8")).port).toBe(2222);
  });

  it("a failed write returns false and logs without the token", async () => {
    await writeFile(join(home, ".sideform-light"), "i am a file, not a dir");
    const e = entry();
    expect(await hs.write(e)).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain(e.token);
  });

  it("remove deletes the file only while it holds our token", async () => {
    const mine = entry();
    await hs.write(mine);
    await hs.remove(entry());
    expect(await readFile(hs.path, "utf8")).toContain(mine.token);
    await hs.remove(mine);
    await expect(stat(hs.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removeSync follows the same ownership rule", async () => {
    const mine = entry();
    await hs.write(mine);
    hs.removeSync(entry());
    expect(await readFile(hs.path, "utf8")).toContain(mine.token);
    hs.removeSync(mine);
    await expect(stat(hs.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removing a missing file is silent; a corrupt file is left alone", async () => {
    await hs.remove(entry());
    hs.removeSync(entry());
    expect(warnings).toEqual([]);
    await hs.write(entry());
    await writeFile(hs.path, "{not json");
    await hs.remove(entry());
    expect(await readFile(hs.path, "utf8")).toBe("{not json");
  });
});

describe("token and loopback helpers", () => {
  it("generateToken gives 64 lowercase hex characters, different each time", () => {
    const a = generateToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(a);
    expect(isValidToken(a)).toBe(true);
    for (const bad of ["", "A".repeat(64), "a".repeat(63), 5, null]) expect(isValidToken(bad)).toBe(false);
  });
  it("isLoopbackAddress accepts 127/8, ::1 and mapped 127.x only", () => {
    for (const ok of ["127.0.0.1", "127.255.0.3", "::1", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(ok), ok).toBe(true);
    for (const bad of ["10.0.0.1", "192.168.1.1", "::ffff:10.0.0.1", "127.0.0", "127.0.0.1x", "256.0.0.1", "", null, undefined, "localhost"]) expect(isLoopbackAddress(bad), String(bad)).toBe(false);
  });
});
