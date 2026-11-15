// Routes MCP requests to THE agent panel and matches its replies. Pure (Electron-free): the panel is a port
// (`deliver`), ids and timers are injectable. One live panel at a time: the last one to register wins; when it is
// destroyed (or reloads) the bridge has no panel and answers "Sideform Light has no open window".

import { randomUUID } from "node:crypto";
import { isObject } from "../storeUtils";
import { TASK_ID_RE as TASK_ID, type McpPanelPort, type McpPanelReply, type McpPanelRequest, type McpTaskState } from "./types";

export const PANEL_REPLY_TIMEOUT_MS = 15_000;
export const NO_WINDOW_ERROR = "Sideform Light has no open window";
export const NO_ANSWER_ERROR = "Sideform Light did not answer";

export interface PanelEndpoint {
  /** The webContents id: replies and change pushes are accepted only from it. */
  id: number;
  /** Delivers `{ requestId, request }` to the panel page (`mcp:task-request`). May throw when the panel is gone. */
  deliver(message: { requestId: string; request: McpPanelRequest }): void;
}

export interface PanelBridgeOptions {
  timeoutMs?: number;
  newId?: () => string;
}

export interface PanelBridge extends McpPanelPort {
  /** Makes `endpoint` THE panel (a later one replaces it). Returns the unregister: a no-op if it was replaced since. */
  registerPanel(endpoint: PanelEndpoint): () => void;
  /** True while a panel is registered. */
  hasPanel(): boolean;
  /** The webContents id of the registered panel, or null. */
  panelId(): number | null;
  /** A `mcp:task-reply` from webContents `senderId`. Ignored unless it is the registered panel and the request is pending. */
  handleReply(senderId: number, payload: unknown): void;
  /** A `mcp:task-changed` from webContents `senderId`. Ignored unless it is the registered panel. */
  handleChanged(senderId: number, payload: unknown): void;
}

interface Pending {
  panelId: number;
  resolve: (reply: McpPanelReply) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A reply must be exactly one of the contract shapes; anything else is dropped as an error. */
export function parsePanelReply(raw: unknown): McpPanelReply {
  if (!isObject(raw)) return { error: "Sideform Light answered in an unexpected way." };
  if (typeof raw.error === "string") return { error: raw.error.slice(0, 2000), ...(raw.code === "busy" ? { code: "busy" as const } : {}) };
  if (isObject(raw.task) && typeof raw.task.taskId === "string") return { task: raw.task as unknown as McpTaskState };
  if (raw.ok === true) return { ok: true };
  if (Array.isArray(raw.tasks)) return { tasks: raw.tasks as Extract<McpPanelReply, { tasks: unknown }>["tasks"] };
  return { error: "Sideform Light answered in an unexpected way." };
}

export function createPanelBridge(opts: PanelBridgeOptions = {}): PanelBridge {
  const timeoutMs = opts.timeoutMs ?? PANEL_REPLY_TIMEOUT_MS;
  const newId = opts.newId ?? randomUUID;
  let panel: PanelEndpoint | null = null;
  const pending = new Map<string, Pending>();
  const listeners = new Set<(taskId: string) => void>();

  const settle = (requestId: string, reply: McpPanelReply) => {
    const p = pending.get(requestId);
    if (!p) return;
    pending.delete(requestId);
    clearTimeout(p.timer);
    p.resolve(reply);
  };
  /** Fails every request that waits on `panelId` (the panel is gone). */
  const failPending = (panelId: number) => {
    for (const [id, p] of [...pending]) if (p.panelId === panelId) settle(id, { error: NO_WINDOW_ERROR });
  };

  return {
    registerPanel(endpoint) {
      if (panel && panel.id !== endpoint.id) failPending(panel.id);
      panel = endpoint;
      return () => {
        if (panel !== endpoint) return;
        panel = null;
        failPending(endpoint.id);
      };
    },
    hasPanel: () => panel !== null,
    panelId: () => panel?.id ?? null,
    request(request) {
      const target = panel;
      if (!target) return Promise.resolve({ error: NO_WINDOW_ERROR });
      const requestId = newId();
      return new Promise<McpPanelReply>((resolve) => {
        const timer = setTimeout(() => settle(requestId, { error: NO_ANSWER_ERROR }), timeoutMs);
        (timer as { unref?: () => void }).unref?.();
        pending.set(requestId, { panelId: target.id, resolve, timer });
        try {
          target.deliver({ requestId, request });
        } catch {
          settle(requestId, { error: NO_WINDOW_ERROR });
        }
      });
    },
    handleReply(senderId, payload) {
      if (!panel || panel.id !== senderId || !isObject(payload) || typeof payload.requestId !== "string") return;
      const p = pending.get(payload.requestId);
      if (!p || p.panelId !== senderId) return;
      settle(payload.requestId, parsePanelReply(payload.reply));
    },
    handleChanged(senderId, payload) {
      if (!panel || panel.id !== senderId || !isObject(payload) || typeof payload.taskId !== "string" || !TASK_ID.test(payload.taskId)) return;
      for (const cb of [...listeners]) {
        try {
          cb(payload.taskId);
        } catch (err) {
          console.error("[mcp] change listener failed", err);
        }
      }
    },
    onChanged(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
