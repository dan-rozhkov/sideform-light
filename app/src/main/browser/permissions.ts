// Deny-by-default permission policy for the built-in browser's dedicated
// "persist:penbrowser" session (design doc `2026-09-18-builtin-browser-design.md`
// §1). Electron grants permission requests by default, and this browser has
// no chrome (no address-bar padlock, no per-site settings UI) to ever
// reveal or revoke a granted permission, so any page the user browses to
// could otherwise silently pick up geolocation, notifications,
// clipboard-read, or media devices with no prompt at all (finding 6).
//
// Electron-free and injected, like @sideform/browser-agent/controller —
// `target` stands in for the real `Session` so this is unit-testable under
// plain Node/vitest. index.ts wires the real `session.fromPartition("persist:penbrowser")`
// into it exactly once (not per tab), and the DEFAULT session (the ui pages:
// agent panel, trace, settings) into `restrictPermissions` with the one
// permission those pages need.

export interface PermissionHandlerTarget {
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details: unknown,
    ) => void,
  ): void;
  setPermissionCheckHandler(
    handler: (webContents: unknown, permission: string, requestingOrigin: string, details: unknown) => boolean,
  ): void;
}

/** Grants only the permissions in `allowed`; denies every other request and check, regardless of requesting origin. */
export function restrictPermissions(target: PermissionHandlerTarget, allowed: readonly string[]): void {
  target.setPermissionRequestHandler((_webContents, permission, callback) => callback(allowed.includes(permission)));
  target.setPermissionCheckHandler((_webContents, permission) => allowed.includes(permission));
}

/** Denies every permission request and check outright, regardless of
 * permission type or requesting origin. */
export function denyAllPermissions(target: PermissionHandlerTarget): void {
  restrictPermissions(target, []);
}

/** The only permission the ui pages (default session) may use: a sanitized clipboard write (the copy buttons). */
export const UI_ALLOWED_PERMISSIONS = ["clipboard-sanitized-write"] as const;
