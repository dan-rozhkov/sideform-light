import { describe, it, expect } from "vitest";
import {
  APP_ORIGIN,
  DISPLAY_APP_NAME,
  SETTINGS_SECTIONS,
  isAdBlockDisabledByEnv,
  isOnUiOrigin,
  isSettingsPageOn,
  isValidSettingsSection,
  resolveDevDockIconPath,
  resolveMcpPort,
  isValidTraceId,
  originOf,
  resolveAgentPanelUrl,
  resolveBackendOverride,
  resolveBrowserCursorEnabled,
  resolveSettingsTabUrl,
  resolveTraceTabUrl,
  resolveUiOrigin,
  resolveUserDataDir,
  traceIdOfUrl,
} from "../src/main/config";

describe("branding", () => {
  it("is Sideform Light on the app://sideform origin", () => {
    expect(DISPLAY_APP_NAME).toBe("Sideform Light");
    expect(APP_ORIGIN).toBe("app://sideform");
  });
});

describe("originOf / isOnUiOrigin", () => {
  it("reads protocol//host, also for the standard app: scheme (new URL().origin is \"null\" there)", () => {
    expect(originOf("app://sideform/agent?x=1")).toBe("app://sideform");
    expect(originOf("http://localhost:5174/trace/a")).toBe("http://localhost:5174");
    expect(originOf("not a url")).toBeNull();
    expect(originOf(undefined)).toBeNull();
    expect(originOf("about:blank")).toBeNull();
  });
  it("compares against one ui origin", () => {
    expect(isOnUiOrigin("app://sideform/settings", "app://sideform")).toBe(true);
    expect(isOnUiOrigin("app://other/settings", "app://sideform")).toBe(false);
    expect(isOnUiOrigin("https://sideform/settings", "app://sideform")).toBe(false);
  });
});

describe("resolveUiOrigin", () => {
  it("defaults to the bundled ui", () => {
    expect(resolveUiOrigin({})).toBe("app://sideform");
    expect(resolveUiOrigin({ SIDEFORM_LIGHT_UI_URL: "" })).toBe("app://sideform");
  });
  it("SIDEFORM_LIGHT_UI_URL replaces the origin (http/https only, path ignored)", () => {
    expect(resolveUiOrigin({ SIDEFORM_LIGHT_UI_URL: "http://localhost:5174" })).toBe("http://localhost:5174");
    expect(resolveUiOrigin({ SIDEFORM_LIGHT_UI_URL: "https://ui.example.com/agent?x=1" })).toBe("https://ui.example.com");
  });
  it("ignores a non-http override", () => {
    expect(resolveUiOrigin({ SIDEFORM_LIGHT_UI_URL: "file:///etc/passwd" })).toBe("app://sideform");
    expect(resolveUiOrigin({ SIDEFORM_LIGHT_UI_URL: "app://evil" })).toBe("app://sideform");
    expect(resolveUiOrigin({ SIDEFORM_LIGHT_UI_URL: "not a url" })).toBe("app://sideform");
  });
});

describe("resolveBackendOverride", () => {
  it("is null without the env var: the bundled backend is used", () => {
    expect(resolveBackendOverride({})).toBeNull();
    expect(resolveBackendOverride({ SIDEFORM_LIGHT_BACKEND_URL: "" })).toBeNull();
  });
  it("reads the origin of SIDEFORM_LIGHT_BACKEND_URL (http/https only)", () => {
    expect(resolveBackendOverride({ SIDEFORM_LIGHT_BACKEND_URL: "http://localhost:3001/some/path" })).toBe("http://localhost:3001");
    expect(resolveBackendOverride({ SIDEFORM_LIGHT_BACKEND_URL: "http://127.0.0.1:4000" })).toBe("http://127.0.0.1:4000");
    expect(resolveBackendOverride({ SIDEFORM_LIGHT_BACKEND_URL: "ftp://x" })).toBeNull();
    expect(resolveBackendOverride({ SIDEFORM_LIGHT_BACKEND_URL: "nope" })).toBeNull();
  });
});

describe("page URLs", () => {
  it("agent panel: /agent on the ui origin", () => {
    expect(resolveAgentPanelUrl("app://sideform")).toBe("app://sideform/agent");
    expect(resolveAgentPanelUrl("http://localhost:5174")).toBe("http://localhost:5174/agent");
  });
  it("trace tab: /trace/<id>?src=local, id encoded", () => {
    expect(resolveTraceTabUrl("app://sideform", "abc_1")).toBe("app://sideform/trace/abc_1?src=local");
    expect(resolveTraceTabUrl("http://localhost:5174", "a b")).toBe("http://localhost:5174/trace/a%20b?src=local");
  });
  it("settings tab: /settings with a valid section only", () => {
    expect(resolveSettingsTabUrl("app://sideform")).toBe("app://sideform/settings");
    expect(resolveSettingsTabUrl("app://sideform", "browser")).toBe("app://sideform/settings?section=browser");
    expect(resolveSettingsTabUrl("app://sideform", "appearance")).toBe("app://sideform/settings?section=appearance");
    expect(resolveSettingsTabUrl("app://sideform", "mcp")).toBe("app://sideform/settings?section=mcp");
    expect(resolveSettingsTabUrl("app://sideform", "schedules")).toBe("app://sideform/settings?section=schedules");
    expect(resolveSettingsTabUrl("app://sideform", "memory")).toBe("app://sideform/settings?section=memory");
    expect(resolveSettingsTabUrl("app://sideform", "account")).toBe("app://sideform/settings");
    expect(resolveSettingsTabUrl("app://sideform", 5)).toBe("app://sideform/settings");
  });
});

describe("settings sections", () => {
  it("are appearance, model, memory, browser, mcp and schedules only", () => {
    expect([...SETTINGS_SECTIONS]).toEqual(["appearance", "model", "memory", "browser", "mcp", "schedules"]);
    expect(isValidSettingsSection("model")).toBe(true);
    expect(isValidSettingsSection("memory")).toBe(true);
    expect(isValidSettingsSection("schedules")).toBe(true);
    expect(isValidSettingsSection("browser")).toBe(true);
    expect(isValidSettingsSection("mcp")).toBe(true);
    expect(isValidSettingsSection("MCP")).toBe(false);
    expect(isValidSettingsSection("advanced")).toBe(false);
    expect(isValidSettingsSection(undefined)).toBe(false);
  });
  it("isSettingsPageOn checks the origin and the last path segment", () => {
    expect(isSettingsPageOn("app://sideform/settings?section=browser", "app://sideform")).toBe(true);
    expect(isSettingsPageOn("app://sideform/settings/", "app://sideform")).toBe(true);
    expect(isSettingsPageOn("app://sideform/agent", "app://sideform")).toBe(false);
    expect(isSettingsPageOn("https://evil.example/settings", "app://sideform")).toBe(false);
    expect(isSettingsPageOn(undefined, "app://sideform")).toBe(false);
  });
});

describe("resolveBrowserCursorEnabled", () => {
  it("defaults to enabled when unset", () => {
    expect(resolveBrowserCursorEnabled({})).toBe(true);
  });

  it("is disabled by off/0/false, case-insensitively", () => {
    expect(resolveBrowserCursorEnabled({ SIDEFORM_LIGHT_BROWSER_CURSOR: "off" })).toBe(false);
    expect(resolveBrowserCursorEnabled({ SIDEFORM_LIGHT_BROWSER_CURSOR: "OFF" })).toBe(false);
    expect(resolveBrowserCursorEnabled({ SIDEFORM_LIGHT_BROWSER_CURSOR: "0" })).toBe(false);
    expect(resolveBrowserCursorEnabled({ SIDEFORM_LIGHT_BROWSER_CURSOR: "false" })).toBe(false);
    expect(resolveBrowserCursorEnabled({ SIDEFORM_LIGHT_BROWSER_CURSOR: "False" })).toBe(false);
  });

  it("stays enabled for any other value", () => {
    expect(resolveBrowserCursorEnabled({ SIDEFORM_LIGHT_BROWSER_CURSOR: "on" })).toBe(true);
    expect(resolveBrowserCursorEnabled({ SIDEFORM_LIGHT_BROWSER_CURSOR: "1" })).toBe(true);
    expect(resolveBrowserCursorEnabled({ SIDEFORM_LIGHT_BROWSER_CURSOR: "" })).toBe(true);
  });
});

describe("resolveUserDataDir", () => {
  it("is undefined when unset or blank, trimmed otherwise", () => {
    expect(resolveUserDataDir({})).toBeUndefined();
    expect(resolveUserDataDir({ SIDEFORM_LIGHT_USER_DATA_DIR: "  " })).toBeUndefined();
    expect(resolveUserDataDir({ SIDEFORM_LIGHT_USER_DATA_DIR: " /tmp/x " })).toBe("/tmp/x");
  });
});

describe("isValidTraceId / traceIdOfUrl", () => {
  it("accepts 1-64 of A-Za-z0-9_- only", () => {
    expect(isValidTraceId("a")).toBe(true);
    expect(isValidTraceId("a".repeat(64))).toBe(true);
    for (const bad of ["", "a".repeat(65), "a b", "a/b", "..", "../x", "a?b", 5, null, undefined]) expect(isValidTraceId(bad)).toBe(false);
  });
  it("reads the id from the path of a trace URL", () => {
    expect(traceIdOfUrl("app://sideform/trace/abc?src=local")).toBe("abc");
    expect(traceIdOfUrl("https://h/pen/trace/abc")).toBe("abc");
    expect(traceIdOfUrl("https://h/settings?id=abc")).toBeNull();
    expect(traceIdOfUrl("https://h/trace/")).toBeNull();
    expect(traceIdOfUrl("https://h/trace/a%20b")).toBeNull();
    expect(traceIdOfUrl("not a url")).toBeNull();
  });
});


describe("isAdBlockDisabledByEnv", () => {
  it("is true only for an explicit on value", () => {
    expect(isAdBlockDisabledByEnv({ SIDEFORM_LIGHT_NO_ADBLOCK: "1" })).toBe(true);
    expect(isAdBlockDisabledByEnv({ SIDEFORM_LIGHT_NO_ADBLOCK: " TRUE " })).toBe(true);
    expect(isAdBlockDisabledByEnv({ SIDEFORM_LIGHT_NO_ADBLOCK: "0" })).toBe(false);
    expect(isAdBlockDisabledByEnv({ SIDEFORM_LIGHT_NO_ADBLOCK: "" })).toBe(false);
    expect(isAdBlockDisabledByEnv({})).toBe(false);
  });
});


describe("resolveMcpPort", () => {
  it("defaults to 47821", () => {
    expect(resolveMcpPort({})).toBe(47821);
    expect(resolveMcpPort({ SIDEFORM_LIGHT_MCP_PORT: "" })).toBe(47821);
    expect(resolveMcpPort({ SIDEFORM_LIGHT_MCP_PORT: "  " })).toBe(47821);
  });
  it("takes a whole port number 1..65535 from SIDEFORM_LIGHT_MCP_PORT", () => {
    expect(resolveMcpPort({ SIDEFORM_LIGHT_MCP_PORT: "50123" })).toBe(50123);
    expect(resolveMcpPort({ SIDEFORM_LIGHT_MCP_PORT: " 80 " })).toBe(80);
    expect(resolveMcpPort({ SIDEFORM_LIGHT_MCP_PORT: "65535" })).toBe(65535);
  });
  it("anything else falls back to the default", () => {
    for (const v of ["0", "65536", "-1", "1.5", "abc", "47821x", "1e3", "123456"]) expect(resolveMcpPort({ SIDEFORM_LIGHT_MCP_PORT: v }), v).toBe(47821);
  });
});

describe("resolveDevDockIconPath", () => {
  it("points an unpackaged macOS run at the black app icon", () => {
    expect(resolveDevDockIconPath({ platform: "darwin", isPackaged: false, appPath: "/repo/app" })).toBe("/repo/app/assets/app-icons/black.png");
    expect(resolveDevDockIconPath({ platform: "darwin", isPackaged: false, appPath: "/repo/app/" })).toBe("/repo/app/assets/app-icons/black.png");
  });

  it("leaves a packaged app and other platforms alone", () => {
    expect(resolveDevDockIconPath({ platform: "darwin", isPackaged: true, appPath: "/Applications/x.app/Contents/Resources/app.asar" })).toBeNull();
    expect(resolveDevDockIconPath({ platform: "win32", isPackaged: false, appPath: "C:\\repo\\app" })).toBeNull();
    expect(resolveDevDockIconPath({ platform: "linux", isPackaged: false, appPath: "/repo/app" })).toBeNull();
  });

  it("names an icon that exists in the repo", async () => {
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");
    expect(existsSync(path.join(__dirname, "..", "assets", "app-icons", "black.png"))).toBe(true);
  });
});
