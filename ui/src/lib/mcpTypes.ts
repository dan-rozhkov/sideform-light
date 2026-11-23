// The panel side of the MCP agent bridge contract (see docs/superpowers/specs/2026-11-15-mcp-agent-bridge-design.md).

export type McpAnswer = { id: string; value: string | string[]; note?: string };

export type McpMemoryTarget = "memory" | "user";
export type McpMemoryOperation =
  | { action: "add"; content: string }
  | { action: "replace"; old_text: string; content: string }
  | { action: "remove"; old_text: string };
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
  | { op: "schedule-start"; scheduleId: string; prompt: string; title: string; previousChatId?: string };

export type TaskStatus = "running" | "needs_answer" | "done" | "stopped" | "error";

export interface TaskTrace {
  traceId: string;
  title?: string;
  status?: string;
}

export interface TaskState {
  taskId: string;
  title: string;
  status: TaskStatus;
  updatedAt: number;
  /** The pending ask_user input's questions, as the form shows them. */
  question?: { questions: unknown[] };
  /** Last assistant text, when done. */
  result?: string;
  /** When error. */
  error?: string;
  traces: TaskTrace[];
}

export type McpPanelReply =
  | { error: string; code?: "busy" }
  | { task: TaskState }
  | { ok: true }
  | { memory: McpMemorySnapshot }
  | { tasks: Pick<TaskState, "taskId" | "title" | "status" | "updatedAt">[] };
