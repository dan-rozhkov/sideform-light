// Decisions about who owns browser state and when it is orphaned (pure; window.ts
// only wires Electron events to these).

/**
 * Who may send `browser:command` and own fixtures / journals / sessions: this
 * window's agent panel. `panelId` is null when there is no panel or it is destroyed.
 */
export function isBrowserOwner(id: number, panelId: number | null): boolean {
  return panelId !== null && id === panelId;
}

export type OrphanEvent =
  | { type: "render-process-gone" }
  | { type: "did-navigate"; isMainFrame: boolean; isSameDocument: boolean };

/**
 * Whether an event on the agent panel orphans what it owned (its shared
 * fixture, journals, isolated sessions). The
 * panel is never destroyed on its own; it reloads and can crash, and either
 * skips its renderer cleanup. Only a COMMITTED main-frame navigation counts
 * (`did-frame-navigate`, which carries `isMainFrame`; it never fires for
 * same-document navigations): `did-start-navigation` also fires for navigations that never
 * commit (denied by the navigation policy, 204, downloads), which must not close
 * anything. Renderer death always counts.
 */
export function isOrphaningEvent(e: OrphanEvent): boolean {
  if (e.type === "render-process-gone") return true;
  return e.isMainFrame && !e.isSameDocument;
}
