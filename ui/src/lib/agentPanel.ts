import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import type { UIMessage } from "ai";
import type { McpPanelReply, McpPanelRequest } from "@/lib/mcpTypes";
import type { BrowseTraceSavePayload, BrowseTraceSaveResult, DesktopBrowserBridge, DesktopSettingsApi } from "@/lib/desktopBridge";

/** Preload API of the agent panel view (`preload/agentPanel`), version 3. */
export interface PenAgentPanelApi {
  version: number;
  /** The shell's built-in browser, driven by the browse_* tools. */
  browser?: DesktopBrowserBridge & {
    /**
     * Isolated browser session for one browse_agent run (parallel runs). Same methods as `browser`, each
     * call targets the session. `sessionId` matches `^[A-Za-z0-9_-]{1,64}$`.
     */
    isolated?(sessionId: string): DesktopBrowserBridge;
    /** Closes the isolated session (tabs, fixture, storage). Idempotent. */
    closeSession?(sessionId: string): Promise<{ ok: true } | { error: string }>;
    /**
     * Makes the tab the agent drives the active one: undefined = the shared browser, a string = an
     * isolated session id. Resolves false when there is no such tab (closed).
     */
    revealAgentTab?(sessionId?: string): Promise<unknown>;
  };
  /** Opens or focuses the Settings tab. */
  settings?: DesktopSettingsApi;
  /** The shell's on-disk chat store. Feature-detect every function. */
  chats?: AgentPanelChatsBridge;
  /** The MCP agent bridge: external agents give tasks that run as chats of this panel. */
  mcp?: {
    /** Registers THE handler (a second call replaces it). Returns an unsubscribe. */
    onRequest(handler: (req: McpPanelRequest) => Promise<McpPanelReply>): () => void;
    /** Tells main that a task's state may have changed (wakes waiting get_task calls). */
    notifyChanged(taskId: string): void;
  };
  /** Local browse-run traces. */
  traces?: {
    save(payload: BrowseTraceSavePayload): Promise<BrowseTraceSaveResult>;
    /** Opens or focuses the trace tab for `id`. */
    open(id: string): Promise<{ ok: boolean; error?: string }>;
    /** Open trace tabs in strip order. */
    listTabs?(): Promise<{ tabs: { traceId: string; title: string; active: boolean }[] } | { error: string }>;
    /**
     * The stored trace. `{ frames: false }` skips the frame images: `frame.src` stays the stored asset
     * path. With `frames: true`, `frameIds` inlines only those frames.
     */
    read?(id: string, opts?: { frames?: boolean; frameIds?: number[] }): Promise<{ trace: BrowseTrace } | { error: string }>;
  };
}

/** Chat metadata the shell lists (no messages), newest first. */
export interface StoredChatMeta {
  id: string;
  title: string;
  titleIsAuto: boolean;
  model: string;
  updatedAt: number;
  rev: number;
  messageCount: number;
  /** Set only for chats started over MCP or by a schedule. Absent on older chat files. */
  source?: "mcp" | "schedule";
}

/** A chat as stored on disk: the meta fields (minus messageCount) plus the AI SDK messages as JSON. */
export interface StoredChat {
  id: string;
  title: string;
  titleIsAuto: boolean;
  model: string;
  updatedAt: number;
  rev: number;
  messages: UIMessage[];
  source?: "mcp" | "schedule";
}

/** The agent panel's chat storage (`chats:*` IPC). */
export interface AgentPanelChatsBridge {
  list(): Promise<{ chats: StoredChatMeta[] } | { error: string }>;
  read(id: string): Promise<{ chat: StoredChat | null } | { error: string }>;
  save(chat: StoredChat): Promise<{ ok: boolean; rev: number; stale?: boolean } | { error: string }>;
  remove(id: string): Promise<{ ok: boolean } | { error: string }>;
}

declare global {
  interface Window {
    /**
     * Defined by the agent page while the disk chat store is active: runs pending chat saves now and
     * resolves after their replies. Never rejects. The shell awaits it on quit and window close.
     */
    penChatsFlush?: () => Promise<void>;
    /** Exposed by the shell's preload ONLY inside the agent panel view. */
    penAgentPanel?: PenAgentPanelApi;
  }
}

type PanelTraces = NonNullable<PenAgentPanelApi["traces"]>;
/** `traces` with `listTabs` and `read` both present. */
export type TraceTabsBridge = PanelTraces & Required<Pick<PanelTraces, "listTabs" | "read">>;

/** The panel's trace-tab bridge (list + read), or undefined when the shell lacks either function. */
export function getAgentPanelTraceTabsBridge(): TraceTabsBridge | undefined {
  const traces = window.penAgentPanel?.traces;
  return typeof traces?.listTabs === "function" && typeof traces.read === "function" ? (traces as TraceTabsBridge) : undefined;
}
