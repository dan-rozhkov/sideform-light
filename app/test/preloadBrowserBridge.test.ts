import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The agent panel's preload owns the one browser bridge (the trace/settings tab preload has none, see
// ipcContract.test.ts). Its shape is pinned here: the contract's `browser` member list, with nothing of the removed
// desktop-app or chat-binding surface.

const src = readFileSync(path.join(__dirname, "../src/preload/agentPanel.ts"), "utf8");

function makeBrowserKeys(): string[] {
  const start = src.indexOf("const makeBrowser = ");
  const end = src.indexOf("\nconst browser = {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...body.matchAll(/^ {4}(\w+): /gm)].map((m) => m[1]).sort();
}

describe("agent panel browser bridge", () => {
  it("makeBrowser exposes exactly the contract's commands", () => {
    expect(makeBrowserKeys()).toEqual(
      [
        "open", "act", "findImages", "snapshot", "perform", "assert", "read", "screenshot", "tabs",
        "applyFixture", "releaseFixture", "clearActEmulation", "fillLogin",
        "startJournal", "stopJournal", "captureCheckpoint", "requests", "capture",
      ].sort(),
    );
  });

  it("browser adds isolated(), closeSession and revealAgentTab, and nothing else", () => {
    const start = src.indexOf("const browser = {");
    const end = src.indexOf("\n};", start);
    const body = src.slice(start, end).replace(/^\s*\/\/.*$/gm, "");
    expect([...body.matchAll(/^ {2}(\w+)[:(]/gm)].map((m) => m[1]).sort()).toEqual(["closeSession", "isolated", "revealAgentTab"]);
    expect(body).toContain("...makeBrowser()");
  });

  it("exposes penAgentPanel version 3 with browser, chats, traces and settings only", () => {
    expect(src).toContain('contextBridge.exposeInMainWorld("penAgentPanel", { version: 3, browser, chats, traces, settings });');
  });

  it("carries no desktop-app surface (launchApp, releaseApp, nativeApps, forChat)", () => {
    for (const gone of ["launchApp", "releaseApp", "nativeApps", "forChat", "--sideform-native-apps"]) expect(src, gone).not.toContain(gone);
  });
});
