import { describe, it, expect, vi } from "vitest";
import { UI_ALLOWED_PERMISSIONS, denyAllPermissions, restrictPermissions, type PermissionHandlerTarget } from "../src/main/browser/permissions";

function makeFakeSession(): PermissionHandlerTarget & {
  requestHandler?: (webContents: unknown, permission: string, callback: (granted: boolean) => void, details: unknown) => void;
  checkHandler?: (webContents: unknown, permission: string, requestingOrigin: string, details: unknown) => boolean;
} {
  const target: ReturnType<typeof makeFakeSession> = {
    setPermissionRequestHandler(handler) {
      target.requestHandler = handler;
    },
    setPermissionCheckHandler(handler) {
      target.checkHandler = handler;
    },
  };
  return target;
}

// Finding 6: the built-in browser's dedicated "persist:penbrowser" session
// has no chrome to ever reveal or revoke a granted permission, so every
// permission request/check must be denied outright, regardless of
// permission type or origin.
describe("denyAllPermissions", () => {
  it("installs both a request handler and a check handler", () => {
    const target = makeFakeSession();
    denyAllPermissions(target);
    expect(target.requestHandler).toBeTypeOf("function");
    expect(target.checkHandler).toBeTypeOf("function");
  });

  it("the request handler always calls back with false, for any permission", () => {
    const target = makeFakeSession();
    denyAllPermissions(target);
    for (const permission of ["geolocation", "notifications", "clipboard-read", "media"]) {
      const callback = vi.fn();
      target.requestHandler?.({}, permission, callback, {});
      expect(callback).toHaveBeenCalledWith(false);
    }
  });

  it("the check handler always returns false, for any permission/origin", () => {
    const target = makeFakeSession();
    denyAllPermissions(target);
    expect(target.checkHandler?.({}, "geolocation", "https://pinterest.com", {})).toBe(false);
    expect(target.checkHandler?.({}, "notifications", "https://evil.example", {})).toBe(false);
  });
});

// The default session (the ui pages: agent panel, trace, settings) used to grant everything. It now allows
// only what the pages need.
describe("restrictPermissions (default session)", () => {
  it("the ui may use exactly one permission: a sanitized clipboard write", () => {
    expect([...UI_ALLOWED_PERMISSIONS]).toEqual(["clipboard-sanitized-write"]);
  });

  it("grants the allowed permissions and denies every other request", () => {
    const target = makeFakeSession();
    restrictPermissions(target, UI_ALLOWED_PERMISSIONS);
    const answer = (permission: string) => {
      const callback = vi.fn();
      target.requestHandler?.({}, permission, callback, {});
      return callback.mock.calls[0][0];
    };
    expect(answer("clipboard-sanitized-write")).toBe(true);
    for (const permission of ["geolocation", "notifications", "clipboard-read", "media", "midi", "openExternal"]) {
      expect(answer(permission), permission).toBe(false);
    }
  });

  it("the check handler follows the same list", () => {
    const target = makeFakeSession();
    restrictPermissions(target, UI_ALLOWED_PERMISSIONS);
    expect(target.checkHandler?.({}, "clipboard-sanitized-write", "app://sideform", {})).toBe(true);
    expect(target.checkHandler?.({}, "geolocation", "app://sideform", {})).toBe(false);
  });

  it("an empty list is deny-all", () => {
    const target = makeFakeSession();
    restrictPermissions(target, []);
    expect(target.checkHandler?.({}, "clipboard-sanitized-write", "app://sideform", {})).toBe(false);
  });
});
