import { describe, expect, it } from "vitest";
import { createMcpSettingsStore, type McpSettingsFs } from "../src/main/mcp/settingsStore";
import { mkdtempSync, readFileSync, statSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeMcpSettingsFs } from "../src/main/mcp/settingsStore";

const T1 = "1".repeat(64);
const T2 = "2".repeat(64);
const T3 = "3".repeat(64);

function memFs(initial?: string) {
  const state = { text: initial ?? null, writes: 0, fail: false };
  const fs: McpSettingsFs = {
    readText: () => state.text,
    writeText: (_p, t) => {
      if (state.fail) throw new Error("disk full");
      state.writes++;
      state.text = t;
    },
  };
  return { fs, state };
}
const tokens = (...t: string[]) => () => t.shift() ?? "f".repeat(64);

describe("mcp settings store", () => {
  it("a missing file gives enabled=false and a generated token that is persisted at once", () => {
    const { fs, state } = memFs();
    const store = createMcpSettingsStore({ filePath: "/x/mcp-bridge.json", fs, newToken: tokens(T1) });
    expect(store.get()).toEqual({ enabled: false, token: T1 });
    expect(JSON.parse(state.text!)).toEqual({ enabled: false, token: T1 });
  });

  it("keeps a valid file as it is and does not rewrite it", () => {
    const { fs, state } = memFs(JSON.stringify({ enabled: true, token: T1 }));
    const store = createMcpSettingsStore({ filePath: "/x", fs, newToken: tokens(T2) });
    expect(store.get()).toEqual({ enabled: true, token: T1 });
    expect(state.writes).toBe(0);
  });

  it("a corrupt file gives the defaults and a new token", () => {
    for (const text of ["{nope", "[]", "null", "5", ""]) {
      const { fs } = memFs(text);
      expect(createMcpSettingsStore({ filePath: "/x", fs, newToken: tokens(T2) }).get()).toEqual({ enabled: false, token: T2 });
    }
  });

  it("falls back per field: a bad token is replaced, a non-boolean flag is off", () => {
    const { fs } = memFs(JSON.stringify({ enabled: "yes", token: "short" }));
    expect(createMcpSettingsStore({ filePath: "/x", fs, newToken: tokens(T2) }).get()).toEqual({ enabled: false, token: T2 });
    const b = memFs(JSON.stringify({ enabled: true, token: "A".repeat(64) }));
    expect(createMcpSettingsStore({ filePath: "/x", fs: b.fs, newToken: tokens(T3) }).get()).toEqual({ enabled: true, token: T3 });
  });

  it("setEnabled writes the flag; an unchanged value writes nothing", () => {
    const { fs, state } = memFs(JSON.stringify({ enabled: false, token: T1 }));
    const store = createMcpSettingsStore({ filePath: "/x", fs });
    expect(store.setEnabled(false)).toEqual({ enabled: false, token: T1 });
    expect(state.writes).toBe(0);
    expect(store.setEnabled(true)).toEqual({ enabled: true, token: T1 });
    expect(JSON.parse(state.text!)).toEqual({ enabled: true, token: T1 });
  });

  it("regenerateToken replaces the token and keeps the flag", () => {
    const { fs, state } = memFs(JSON.stringify({ enabled: true, token: T1 }));
    const store = createMcpSettingsStore({ filePath: "/x", fs, newToken: tokens(T2) });
    expect(store.regenerateToken()).toEqual({ enabled: true, token: T2 });
    expect(JSON.parse(state.text!)).toEqual({ enabled: true, token: T2 });
  });

  it("a failed write returns null and changes nothing in memory", () => {
    const { fs, state } = memFs(JSON.stringify({ enabled: false, token: T1 }));
    const store = createMcpSettingsStore({ filePath: "/x", fs, newToken: tokens(T2) });
    state.fail = true;
    expect(store.setEnabled(true)).toBeNull();
    expect(store.regenerateToken()).toBeNull();
    expect(store.get()).toEqual({ enabled: false, token: T1 });
  });

  it("an unwritable first start still gives a token for this run", () => {
    const { fs, state } = memFs();
    state.fail = true;
    expect(createMcpSettingsStore({ filePath: "/x", fs, newToken: tokens(T1) }).get().token).toBe(T1);
  });

  it("the real fs writes mode 0600 atomically (no temp file left) and reads it back", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-settings-"));
    try {
      const file = join(dir, "sub", "mcp-bridge.json");
      const store = createMcpSettingsStore({ filePath: file, fs: nodeMcpSettingsFs, newToken: tokens(T1) });
      store.setEnabled(true);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readdirSync(join(dir, "sub"))).toEqual(["mcp-bridge.json"]);
      expect(createMcpSettingsStore({ filePath: file, fs: nodeMcpSettingsFs }).get()).toEqual({ enabled: true, token: T1 });
      writeFileSync(file, "garbage");
      expect(createMcpSettingsStore({ filePath: file, fs: nodeMcpSettingsFs, newToken: tokens(T2) }).get()).toEqual({ enabled: false, token: T2 });
      expect(readFileSync(file, "utf8")).toContain(T2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
