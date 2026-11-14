import { describe, it, expect } from "vitest";
import {
  APP_ORIGIN,
  DEFAULT_BACKEND_URL,
  DISPLAY_APP_NAME,
  SETTINGS_SECTIONS,
  isAdBlockDisabledByEnv,
  isOnUiOrigin,
  isSettingsPageOn,
  isValidSettingsSection,
  isValidTraceId,
  originOf,
  resolveAgentPanelUrl,
  resolveBackendOrigin,
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

describe("resolveBackendOrigin", () => {
  it("defaults to the local backend", () => {
    expect(resolveBackendOrigin({})).toBe("http://localhost:3001");
    expect(DEFAULT_BACKEND_URL).toBe("http://localhost:3001");
  });
  it("reads the origin of SIDEFORM_LIGHT_BACKEND_URL (http/https only)", () => {
    expect(resolveBackendOrigin({ SIDEFORM_LIGHT_BACKEND_URL: "https://api.sideform.pro/some/path" })).toBe("https://api.sideform.pro");
    expect(resolveBackendOrigin({ SIDEFORM_LIGHT_BACKEND_URL: "http://127.0.0.1:4000" })).toBe("http://127.0.0.1:4000");
    expect(resolveBackendOrigin({ SIDEFORM_LIGHT_BACKEND_URL: "ftp://x" })).toBe("http://localhost:3001");
    expect(resolveBackendOrigin({ SIDEFORM_LIGHT_BACKEND_URL: "nope" })).toBe("http://localhost:3001");
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
    expect(resolveSettingsTabUrl("app://sideform", "account")).toBe("app://sideform/settings");
    expect(resolveSettingsTabUrl("app://sideform", 5)).toBe("app://sideform/settings");
  });
});

describe("settings sections", () => {
  it("are appearance and browser only", () => {
    expect([...SETTINGS_SECTIONS]).toEqual(["appearance", "browser"]);
    expect(isValidSettingsSection("browser")).toBe(true);
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

