// Shapes shared by the MCP bridge modules. `McpPanelRequest` / `McpPanelReply` are the contract with the ui's
// agent panel (CONTRACT.md "MCP agent bridge"); the ui declares the same types on its side.

export type McpTaskStatus = "running" | "needs_answer" | "done" | "stopped" | "error";

export interface McpAnswer {
  id: string;
  value: string | string[];
  note?: string;
}

export type McpMemoryTarget = "memory" | "user";

export type McpMemoryOperation =
  | { action: "add"; content: string }
  | { action: "replace"; old_text: string; content: string }
  | { action: "remove"; old_text: string };

/** The agent memory as the panel read it from the backend (after a write: the state after it). */
export interface McpMemorySnapshot {
  enabled: boolean;
  memory: string[];
  user: string[];
  limits: { memory: number; user: number };
}

export type McpPanelRequest =
  | { op: "start"; prompt: string; title?: string }
  | { op: "get"; taskId: string }
  | { op: "answer"; taskId: string; answers: McpAnswer[] }
  | { op: "message"; taskId: string; text: string }
  | { op: "stop"; taskId: string }
  | { op: "list"; limit: number }
  | { op: "memory-list" }
  | { op: "memory-apply"; target: McpMemoryTarget; operations: McpMemoryOperation[] }
  // Main-only op (the scheduler); the MCP tools never build it.
  | { op: "schedule-start"; scheduleId: string; prompt: string; title: string; previousChatId?: string };

export interface McpTaskState {
  taskId: string;
  title: string;
  status: McpTaskStatus;
  updatedAt: number;
  question?: { questions: unknown[] };
  result?: string;
  error?: string;
  traces: { traceId: string; title?: string; status?: string }[];
}

export type McpPanelReply =
  | { error: string; code?: "busy" }
  | { task: McpTaskState }
  | { ok: true }
  | { memory: McpMemorySnapshot }
  | { tasks: Pick<McpTaskState, "taskId" | "title" | "status" | "updatedAt">[] };

export interface McpToolContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  isError?: true;
}

/** The slice of the panel bridge the tools use. */
export interface McpPanelPort {
  request(request: McpPanelRequest): Promise<McpPanelReply>;
  /** Subscribes to "a task may have changed" pushes from the panel. Returns the unsubscribe. */
  onChanged(cb: (taskId: string) => void): () => void;
}

export const MCP_DEFAULT_PORT = 47821;
export const MCP_PATH = "/mcp";
export const MCP_SERVER_NAME = "sideform-light";
/** The shape of a task id (the panel generates them; main validates before forwarding). One definition. */
export const TASK_ID_PATTERN = "^[A-Za-z0-9_-]{1,128}$";
export const TASK_ID_RE = new RegExp(TASK_ID_PATTERN);
