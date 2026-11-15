import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { BROWSER_COMMANDS, PAGE_DRIVING_COMMANDS } from "../src/main/browserCommands";

/**
 * IPC channel contract. Channel names are plain strings matched at runtime by
 * Electron: rename one side and nothing throws, the message is simply never
 * delivered. Both sides always live in this repo (the ui only ever sees
 * the preload API, never a channel name), so this test scans src/ and pins
 * every channel with its direction.
 *
 * It also guards the listener-leak invariant: every ipcMain.on channel must be
 * torn down by a matching removeListener (see the comment in window.ts — every
 * close/reopen cycle otherwise leaks a listener).
 *
 * Keep this table and the "IPC channels" section of CLAUDE.md in sync.
 */
const CHANNELS: { name: string; direction: "main->renderer" | "renderer->main" }[] = [
  // Page tabs (trace, Settings) report the theme their page paints: colours that tab's own view.
  { name: "tab:theme", direction: "renderer->main" },
  { name: "tabbar:state", direction: "main->renderer" },
  { name: "tabbar:theme", direction: "main->renderer" },
  { name: "tabbar:tail", direction: "main->renderer" },
  { name: "tabbar:strip-left", direction: "main->renderer" },
  // "+" button and the empty start's button: a new browser tab.
  { name: "tabbar:new-browser", direction: "renderer->main" },
  { name: "tabbar:tools-menu", direction: "renderer->main" },
  // Right-click on a tab: native menu (reveal a trace file, close). Payload `{id, x, y}`.
  { name: "tabbar:tab-menu", direction: "renderer->main" },
  { name: "tabbar:activate", direction: "renderer->main" },
  { name: "tabbar:close", direction: "renderer->main" },
  { name: "tabbar:reorder", direction: "renderer->main" },
  { name: "tabbar:toggle-panel", direction: "renderer->main" },
  // The panel preload reports its theme (class `dark` on <html>); main checks sender + page. The window chrome follows it.
  { name: "panel:theme", direction: "renderer->main" },
  { name: "tabbar:navigate", direction: "renderer->main" },
  { name: "browser:command", direction: "renderer->main" },
  // Panel-only: bring the agent's browser tab to the front.
  { name: "browser:reveal-agent-tab", direction: "renderer->main" },
  // Passwords tab (invoke/handle, sender-checked): saved logins, see CLAUDE.md.
  { name: "passwords:list", direction: "renderer->main" },
  { name: "passwords:add", direction: "renderer->main" },
  { name: "passwords:update", direction: "renderer->main" },
  { name: "passwords:theme", direction: "main->renderer" },
  { name: "passwords:changed", direction: "main->renderer" },
  { name: "passwords:remove", direction: "renderer->main" },
  { name: "passwords:never-remove", direction: "renderer->main" },
  // History tab (invoke/handle, sender-checked, registered once by createHistoryService) and its pushes. See CLAUDE.md "Browser history".
  { name: "history:list", direction: "renderer->main" },
  { name: "history:remove", direction: "renderer->main" },
  { name: "history:clear", direction: "renderer->main" },
  { name: "history:open", direction: "renderer->main" },
  { name: "history:theme", direction: "main->renderer" },
  { name: "history:changed", direction: "main->renderer" },
  // Address-bar suggestions: the tab bar asks (invoke, tab bar only) and drives the popover view; the popover reports clicks.
  { name: "history:suggest", direction: "renderer->main" },
  { name: "history:remove-suggestion", direction: "renderer->main" },
  { name: "tabbar:omnibox-show", direction: "renderer->main" },
  { name: "tabbar:omnibox-hide", direction: "renderer->main" },
  { name: "tabbar:omnibox-picked", direction: "main->renderer" },
  { name: "tabbar:omnibox-refresh", direction: "main->renderer" },
  { name: "omnibox:render", direction: "main->renderer" },
  { name: "omnibox:pick", direction: "renderer->main" },
  { name: "omnibox:remove", direction: "renderer->main" },
  { name: "omnibox:open-history", direction: "renderer->main" },
  // Settings tab: the panel or a trace/Settings tab asks main to open/activate it, optionally at a section.
  { name: "settings:open", direction: "renderer->main" },
  // Main tells an already-open Settings page to switch section (no reload).
  { name: "settings:section", direction: "main->renderer" },
  // Settings page > Browser (invoke/handle, Settings-tab senders only, registered once). See CLAUDE.md "Ad and tracker blocking".
  { name: "browser-settings:get", direction: "renderer->main" },
  { name: "browser-settings:set", direction: "renderer->main" },
  // Settings page > MCP (invoke/handle, Settings-tab senders only, registered once). See CLAUDE.md "MCP agent bridge".
  { name: "mcp-settings:get", direction: "renderer->main" },
  { name: "mcp-settings:set", direction: "renderer->main" },
  { name: "mcp-settings:regenerate-token", direction: "renderer->main" },
  // Settings page > Schedules (invoke/handle, Settings-tab senders only, registered once) and main's push after any change or run.
  { name: "schedules:list", direction: "renderer->main" },
  { name: "schedules:save", direction: "renderer->main" },
  { name: "schedules:remove", direction: "renderer->main" },
  { name: "schedules:run-now", direction: "renderer->main" },
  { name: "schedules:open-chat", direction: "renderer->main" },
  { name: "schedules:changed", direction: "main->renderer" },
  // MCP agent bridge, main <-> agent panel (panel's own page only): the page registers its handler (`panel-ready`), main
  // forwards a request `{requestId, request}` (`task-request`), the page answers `{requestId, reply}` (`task-reply`) and
  // pushes `{taskId}` when a task may have changed (`task-changed`).
  { name: "mcp:panel-ready", direction: "renderer->main" },
  { name: "mcp:task-reply", direction: "renderer->main" },
  { name: "mcp:task-changed", direction: "renderer->main" },
  { name: "mcp:task-request", direction: "main->renderer" },
  // Chat storage (invoke/handle): only the agent panel's own page saves/reads/lists its chats under userData. See CLAUDE.md "Chat storage".
  { name: "chats:list", direction: "renderer->main" },
  { name: "chats:read", direction: "renderer->main" },
  { name: "chats:save", direction: "renderer->main" },
  { name: "chats:delete", direction: "renderer->main" },
  // Browse-run traces (invoke/handle): the panel saves/reads/opens/lists, a trace tab reads. See CLAUDE.md "Trace tabs".
  { name: "traces:save", direction: "renderer->main" },
  { name: "traces:read", direction: "renderer->main" },
  { name: "traces:open", direction: "renderer->main" },
  { name: "traces:list-tabs", direction: "renderer->main" },
];

const SRC = resolve(__dirname, "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Drops `//` and block comments while keeping string / template literals
 * intact, so a channel named only in a doc comment can never satisfy a scan.
 */
function stripComments(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (c === "/" && n === "/") {
      while (i < code.length && code[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const codeOf = (files: string[]) => files.map((path) => stripComments(readFileSync(path, "utf8"))).join("\n");
const allFiles = sourceFiles(SRC);
const source = codeOf(allFiles);
const mainSource = codeOf(allFiles.filter((f) => f.startsWith(join(SRC, "main"))));

/** Channel names passed to any of `object.method(` calls, e.g. ipcMain.on("x"). */
function channelsFor(object: string, methods: string[], from: string = source): Set<string> {
  const pattern = new RegExp(`${object}\\.(?:${methods.join("|")})\\(\\s*"([^"]+)"`, "g");
  return new Set([...from.matchAll(pattern)].map((match) => match[1]));
}

const mainReceives = channelsFor("ipcMain", ["on", "once", "handle"]);
const mainRemoves = channelsFor("ipcMain", ["removeListener", "removeAllListeners", "removeHandler"]);
// ANY `<receiver>.send("x"` / `<receiver>?.send("x"` in main code (aliases such as `wc`
// included), comments stripped. The test below makes sure no send hides behind a
// non-literal channel.
const mainSends = new Set(
  [...mainSource.matchAll(/\??\.send\(\s*"([^"]+)"/g)].map((m) => m[1]),
);
const rendererSends = channelsFor("ipcRenderer", ["send", "invoke"]);
const rendererReceives = channelsFor("ipcRenderer", ["on", "once"]);

const byDirection = (direction: string) =>
  CHANNELS.filter((c) => c.direction === direction).map((c) => c.name).sort();

describe("IPC channel contract", () => {
  it("src/ uses exactly the pinned channel set", () => {
    const found = new Set([
      ...mainReceives,
      ...mainRemoves,
      ...mainSends,
      ...rendererSends,
      ...rendererReceives,
    ]);
    expect([...found].sort()).toEqual(CHANNELS.map((c) => c.name).sort());
  });

  it("every property send( in main code names its channel with a string literal (the scan cannot be dodged)", () => {
    const nonLiteral = [...mainSource.matchAll(/(\w+)\??\.send\(\s*(?!")/g)];
    expect(nonLiteral.map((m) => m[0])).toEqual([]);
  });

  it("a channel mentioned only in a comment does not count as sent", () => {
    expect(stripComments('// x.send("fake:chan")\n/* y.send("fake:two") */ const a = "k//z"; w?.send("real:one");')).toBe(
      '\n const a = "k//z"; w?.send("real:one");',
    );
  });

  it("every main->renderer channel is sent from main and listened for in a preload", () => {
    for (const name of byDirection("main->renderer")) {
      expect(mainSends.has(name), `${name} is never sent via webContents.send`).toBe(true);
      expect(rendererReceives.has(name), `${name} has no ipcRenderer.on listener`).toBe(true);
    }
  });

  it("every renderer->main channel is sent from a preload and received by ipcMain", () => {
    for (const name of byDirection("renderer->main")) {
      expect(rendererSends.has(name), `${name} is never sent via ipcRenderer.send`).toBe(true);
      expect(mainReceives.has(name), `${name} has no ipcMain listener`).toBe(true);
    }
  });

  it("channels do not flow in the direction they are not declared for", () => {
    for (const name of byDirection("main->renderer")) {
      expect(rendererSends.has(name), `${name} is declared main->renderer`).toBe(false);
      expect(mainReceives.has(name), `${name} is declared main->renderer`).toBe(false);
    }
    for (const name of byDirection("renderer->main")) {
      expect(mainSends.has(name), `${name} is declared renderer->main`).toBe(false);
      expect(rendererReceives.has(name), `${name} is declared renderer->main`).toBe(false);
    }
  });

  it("every ipcMain listener is torn down again (window close/reopen must not leak)", () => {
    const leaked = [...mainReceives].filter((name) => !mainRemoves.has(name));
    expect(leaked).toEqual([]);
  });
});

describe("MCP agent bridge wiring", () => {
  const windowSource = readFileSync(join(SRC, "main/window.ts"), "utf8");
  const panelPreload = readFileSync(join(SRC, "preload/agentPanel.ts"), "utf8");
  const tabPreload = readFileSync(join(SRC, "preload/tab.ts"), "utf8");

  it("the panel -> main mcp channels are checked against the panel's own page in window.ts", () => {
    expect(windowSource).toContain("isMcpPanelSender(");
    for (const c of ["mcp:panel-ready", "mcp:task-reply", "mcp:task-changed"]) expect(windowSource, c).toContain(`ipcMain.on("${c}"`);
  });

  it("main sends mcp:task-request to the panel's webContents only", () => {
    expect(windowSource).toContain('wc.send("mcp:task-request", message)');
  });

  it("the Settings page channels go through the Settings-tab sender rule", () => {
    const ipc = readFileSync(join(SRC, "main/mcp/mcpSettingsIpc.ts"), "utf8");
    expect(ipc).toContain("deps.isSettingsSender(event)");
    expect(tabPreload).toContain('"mcp-settings:regenerate-token"');
  });

  it("the schedules channels go through the Settings-tab sender rule", () => {
    const ipc = readFileSync(join(SRC, "main/schedules/schedulesIpc.ts"), "utf8");
    expect(ipc).toContain("deps.isSettingsSender(event)");
    for (const c of ["list", "save", "remove", "run-now", "open-chat"]) expect(tabPreload, c).toContain(`"schedules:${c}"`);
    expect(tabPreload).toContain('"schedules:changed"');
  });

  it("the MCP tools can not build the main-only panel ops", () => {
    for (const f of ["main/mcp/tools.ts", "main/mcp/toolInputs.ts"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src, f).not.toContain("schedule-start");
      expect(src, f).not.toContain('op: "open"');
    }
  });

  it("the panel preload never exposes ipcRenderer or a channel name, only onRequest and notifyChanged", () => {
    expect(panelPreload).toContain("const mcp = {");
    expect(panelPreload).toContain("onRequest(");
    expect(panelPreload).toContain("notifyChanged(");
  });
});

describe("browser:command commands", () => {
  // `browser:command` is one channel carrying many commands, so the channel scan
  // above cannot see a command added on one side only. One list
  // (src/main/browserCommands.ts) must agree with the dispatch switch in
  // window.ts, the agent panel preload, and the session planner.
  const windowSource = readFileSync(join(SRC, "main/window.ts"), "utf8");
  const handled = new Set([...windowSource.matchAll(/^\s*case "(\w+)":/gm)].map((m) => m[1]));
  const panelPreload = readFileSync(join(SRC, "preload/agentPanel.ts"), "utf8");
  const sentByPanel = new Set([...panelPreload.matchAll(/command: "(\w+)"/g)].map((m) => m[1]));
  const list = [...BROWSER_COMMANDS].sort();

  it("window.ts dispatches exactly the commands in the list", () => {
    expect([...handled].filter((c) => (list as string[]).includes(c) || c === "default").sort()).toEqual(list);
    for (const c of handled) if (c !== "default") expect(list, `${c} is dispatched but not in BROWSER_COMMANDS`).toContain(c);
  });

  it("the agent panel preload sends exactly the list plus closeSession", () => {
    expect([...sentByPanel].sort()).toEqual([...list, "closeSession"].sort());
  });

  it("the panel's bridge carries the session scope and has no desktop-app or chat-binding members", () => {
    expect(panelPreload).toContain("...scope");
    expect(panelPreload).toContain("isolated: (sessionId: string) => makeBrowser({ session: sessionId })");
    for (const gone of ["forChat", "launchApp", "releaseApp", "nativeApps"]) expect(panelPreload, gone).not.toContain(gone);
    // `capture` is back: the trace DOM snapshot (traceDomSource) needs it.
    expect(panelPreload).toContain('command: "capture"');
  });

  it("the tab preload (trace and settings pages) has no browser bridge at all", () => {
    const tabPreload = readFileSync(join(SRC, "preload/tab.ts"), "utf8");
    expect(tabPreload).not.toContain("browser:command");
    expect(tabPreload).not.toContain("makeBrowser");
  });

  it("assert (QA checks) is wired end to end: list, page-driving, dispatch, preload, shared and isolated", () => {
    expect(list).toContain("assert");
    expect(PAGE_DRIVING_COMMANDS.has("assert")).toBe(true);
    expect(windowSource).toMatch(/case "assert":\s+return await controller\.assert\(payload\.args\)/);
    expect(sentByPanel.has("assert")).toBe(true);
  });

  it("closeSession is handled in window.ts and the payload carries `session`", () => {
    expect(windowSource).toContain('payload.command === "closeSession"');
  });

  it("the page-driving commands are a subset of the list", () => {
    for (const c of PAGE_DRIVING_COMMANDS) expect(list).toContain(c);
  });

  it("only the agent panel may send browser:command", () => {
    expect(windowSource).toContain("isBrowserOwnerId(id, panelWc()?.id ?? null)");
  });
});

describe("requests is passive and wired through the run boundary", () => {
  const src = readFileSync(join(SRC, "main/window.ts"), "utf8");
  it("skips dialog sweep, in-flight bracket and run boundary, but a new run clears the request logs", () => {
    expect(src).toContain('const passive = payload.command === "requests"');
    expect(src).toMatch(/passive \? null : tabs\.currentBrowserTabId/);
    expect(src).toContain("if (!passive) commandsInFlight.inc(sessionId)");
    expect(src).toContain("if (!passive) commandsInFlight.dec(sessionId)");
    expect(src).toMatch(/!passive && runBoundary\.commandStart\(runScope\)\) \{\s+clearScopeDiagnostics\(sessionId\);\s+clearScopeRequestLogs\(sessionId\);/);
  });
  it("clearDiagnostics leaves the request log alone", () => {
    const m = src.match(/clearDiagnostics: \(\) => \{([\s\S]*?)\n        \},/);
    expect(m?.[1]).not.toContain("requestLog");
    expect(src).toContain("clearRequestLog: () => requestLog.clear()");
  });
  it("the target drains closed-tab requests, filled on destroy and on debugger detach", () => {
    expect(src).toContain("drainClosedRequests: () => closedRequestsOf(scope).drain()");
    expect(src.match(/closedRequestsOf\(sessionId\)\.add\(requestLog\.takeFinished\(\)\)/g)).toHaveLength(2);
  });
});

describe("chats:* handlers are process-level", () => {
  const windowSource = stripComments(readFileSync(join(SRC, "main/window.ts"), "utf8"));
  const closedHandler = windowSource.slice(windowSource.indexOf('win.on("closed"'));
  it("window close does not remove them (removed on will-quit instead)", () => {
    for (const c of ["list", "read", "save", "delete"]) {
      expect(closedHandler).not.toContain(`"chats:${c}"`);
      expect(windowSource).toContain(`ipcMain.removeHandler("chats:${c}")`);
    }
  });
  it("the quit hold also covers agent panels", () => {
    const indexSource = stripComments(readFileSync(join(SRC, "main/index.ts"), "utf8"));
    expect(indexSource).toContain("hasWork: hasQuitFlushWork");
    expect(indexSource).toContain("flushAll: flushAllForQuit");
  });
});

describe("the quit flush", () => {
  it("runs in before-quit, ahead of will-quit, through the pure quitFlush module", () => {
    const indexSource = stripComments(readFileSync(join(SRC, "main/index.ts"), "utf8"));
    expect(indexSource).toContain("createQuitFlush(");
    expect(indexSource.indexOf('app.on("before-quit"')).toBeGreaterThan(-1);
    expect(indexSource).not.toContain("pagehide");
  });
});

describe("removed features leave no channel behind", () => {
  it("no canvas, doc, workflow, auth, app icon or menu forwarding channel in src/", () => {
    for (const prefix of ["canvas:", "canvases:", "doc:", "docs:", "workflow:", "workflows:", "auth:", "app-icon:", "logins:", "menu:", "empty:", "editor:"]) {
      expect(source, prefix).not.toContain(`"${prefix}`);
    }
  });
});
