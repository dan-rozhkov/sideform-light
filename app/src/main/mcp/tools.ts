// The MCP tools of the bridge: manifest (names, descriptions, JSON Schemas) and the dispatcher that validates
// the input, asks the agent panel over `McpPanelPort` and turns the reply into an MCP tool result.
// Results are JSON text; failures are `isError` results. Pure: no Electron.

import type { ToolManifestEntry } from "./jsonRpc";
import {
  MAX_ANSWERS,
  MAX_LIST_LIMIT,
  MAX_MEMORY_TEXT_CHARS,
  MAX_PROMPT_CHARS,
  MAX_TEXT_CHARS,
  MAX_TITLE_CHARS,
  MAX_WAIT_SECONDS,
  parseAnswerQuestion,
  parseGetTask,
  parseListTasks,
  parseMemoryAdd,
  parseMemoryRemove,
  parseMemoryReplace,
  parseSendMessage,
  parseStartTask,
  parseStopTask,
} from "./toolInputs";
import { TASK_ID_PATTERN, type McpPanelPort, type McpPanelReply, type McpPanelRequest, type McpToolResult } from "./types";
import { getTaskWaiting } from "./waitTask";

const TASK_ID_SCHEMA = { type: "string", pattern: TASK_ID_PATTERN, description: "The task id returned by start_task." };

const MEMORY_TARGET_SCHEMA = {
  type: "string",
  enum: ["memory", "user"],
  description: 'Which store: "user" = who the person is (preferences, role, communication style); "memory" = the agent\'s own notes (environment, conventions, lessons learned).',
};
const MEMORY_ABOUT =
  "Sideform Light keeps a small persistent agent memory on this device in two stores: \"user\" (who the person is: preferences, role, communication style) and \"memory\" (the agent's own notes: environment, conventions, lessons learned). " +
  "Both are injected into every turn of the in-app agent, so keep entries short, durable and factual; never store secrets, passwords or one-off task details. ";

const WHAT_IT_DOES =
  "Sideform Light is a desktop browser with a built-in AI agent. The agent opens websites, reads them, clicks and types, tests web pages (assertions, request logs, screenshots), " +
  "signs in with logins the person saved in the app, and can run several isolated browser sessions in parallel. It never exposes passwords or cookies.";

export const MCP_TOOL_MANIFEST: ToolManifestEntry[] = [
  {
    name: "start_task",
    title: "Start a browser task",
    description:
      `Give a task in plain words to the Sideform Light agent and return at once with a taskId. ${WHAT_IT_DOES} ` +
      "Describe the goal and what you want back (for example: \"Open example.com/pricing, sign in with the saved login, and list the plan names and prices\"). " +
      "The task runs in the background as a chat the person can open in the app. The agent may ask a question when it needs information or a choice: then the status becomes needs_answer. " +
      "Poll get_task with waitSeconds until the status is done, and answer questions with answer_question. At most 3 tasks started over MCP run at the same time.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: MAX_PROMPT_CHARS, description: "The task, in plain words." },
        title: { type: "string", maxLength: MAX_TITLE_CHARS, description: "Optional short title for the chat list." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "get_task",
    title: "Get a task's state",
    description:
      "Return the state of a task: status (running, needs_answer, done, stopped or error), the pending question when status is needs_answer, the final result text when done, the error text when error, " +
      "and traces (saved browser run recordings that the person can open in the app; empty when no browser run was recorded, as when the person set Sideform Light to record traces for QA tests only). " +
      `Pass waitSeconds (0 to ${MAX_WAIT_SECONDS}) to hold the call until the status leaves running or the time is up, instead of polling in a tight loop. ` +
      "If the status is still running after the wait, call get_task again. When status is needs_answer, reply with answer_question.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: TASK_ID_SCHEMA,
        waitSeconds: { type: "number", minimum: 0, maximum: MAX_WAIT_SECONDS, description: "How long to wait for the status to change. Default 0 (answer at once)." },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "answer_question",
    title: "Answer the agent's question",
    description:
      "Answer the question the agent asked (a task with status needs_answer; get_task shows it in question.questions with id, text, type, options and required). " +
      "Send one answer per question: { id, value, note? }, where value is a string, or an array of strings for a multiple choice. The agent then continues. " +
      "It is an error when no question is pending, or when the person already answered it in the app.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: TASK_ID_SCHEMA,
        answers: {
          type: "array",
          minItems: 1,
          maxItems: MAX_ANSWERS,
          description: "One entry per question of the pending form.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "The question id from get_task." },
              value: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "The answer; an array for a multiple choice." },
              note: { type: "string", description: "Optional extra remark." },
            },
            required: ["id", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["taskId", "answers"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "send_message",
    title: "Send a follow-up message",
    description:
      "Send a follow-up message to a task that is done or stopped (the same as the person typing in that chat), for example to ask for a correction or the next step. The agent works on it and the status becomes running again. " +
      "It is an error while the task is running or waiting for an answer: use answer_question or stop_task then.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: TASK_ID_SCHEMA,
        text: { type: "string", minLength: 1, maxLength: MAX_TEXT_CHARS, description: "The follow-up message." },
      },
      required: ["taskId", "text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "stop_task",
    title: "Stop a task",
    description: "Stop a running task (the same as the Stop button in the app). The chat stays; its status becomes stopped, and send_message can continue it later.",
    inputSchema: { type: "object", properties: { taskId: TASK_ID_SCHEMA }, required: ["taskId"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description: "List the tasks started over MCP in this app, newest first: taskId, title, status and updatedAt. Chats the person started in the app are not listed.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT, description: "How many tasks to return. Default 20." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "memory_list",
    title: "List agent memory",
    description:
      `${MEMORY_ABOUT}Return the current entries of both stores, the character limits and the usage, as { enabled, memory, user, limits, usage }. ` +
      "enabled is false when the person turned memory off in Settings > Memory (writes then fail). Call it before memory_add, to avoid duplicates and to copy the exact text you want to replace or remove.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "memory_add",
    title: "Add a memory entry",
    description:
      `${MEMORY_ABOUT}Add one entry to a store and return the stores after the write. It fails when the store would go over its limit (remove or replace an entry first) or when memory is turned off.`,
    inputSchema: {
      type: "object",
      properties: {
        target: MEMORY_TARGET_SCHEMA,
        text: { type: "string", minLength: 1, maxLength: MAX_MEMORY_TEXT_CHARS, description: "The entry, one short fact or note." },
      },
      required: ["target", "text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "memory_replace",
    title: "Replace a memory entry",
    description:
      `${MEMORY_ABOUT}Replace the entry that contains oldText with text and return the stores after the write. ` +
      "oldText is a substring that identifies exactly one entry; it fails when it matches none or several entries (use a longer substring).",
    inputSchema: {
      type: "object",
      properties: {
        target: MEMORY_TARGET_SCHEMA,
        oldText: { type: "string", minLength: 1, maxLength: MAX_MEMORY_TEXT_CHARS, description: "A substring that matches exactly one existing entry." },
        text: { type: "string", minLength: 1, maxLength: MAX_MEMORY_TEXT_CHARS, description: "The new full text of that entry." },
      },
      required: ["target", "oldText", "text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "memory_remove",
    title: "Remove a memory entry",
    description:
      `${MEMORY_ABOUT}Remove the entry that contains oldText and return the stores after the write. ` +
      "oldText is a substring that identifies exactly one entry; it fails when it matches none or several entries.",
    inputSchema: {
      type: "object",
      properties: {
        target: MEMORY_TARGET_SCHEMA,
        oldText: { type: "string", minLength: 1, maxLength: MAX_MEMORY_TEXT_CHARS, description: "A substring that matches exactly one existing entry." },
      },
      required: ["target", "oldText"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

/** The backend counts a store as its entries joined with this separator. */
const MEMORY_SEPARATOR = "\n§\n";
const used = (entries: string[]) => entries.join(MEMORY_SEPARATOR).length;

const json = (value: unknown): McpToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const fail = (message: string): McpToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** The reply of one op as a tool result. A reply of the wrong kind is an internal error (never forwarded raw). */
function resultOf(reply: McpPanelReply, shape: "task" | "started" | "ok" | "tasks" | "memory"): McpToolResult {
  if ("error" in reply) return fail(typeof reply.error === "string" ? reply.error : "Unknown error.");
  if (shape === "task" && "task" in reply) return json(reply.task);
  if (shape === "started" && "task" in reply) return json({ taskId: reply.task.taskId, status: reply.task.status });
  if (shape === "ok" && "ok" in reply) return json({ ok: true });
  if (shape === "tasks" && "tasks" in reply) return json({ tasks: reply.tasks });
  if (shape === "memory" && "memory" in reply) {
    const m = reply.memory;
    return json({
      enabled: m.enabled,
      memory: m.memory,
      user: m.user,
      limits: m.limits,
      usage: { memory: `${used(m.memory)}/${m.limits.memory} chars`, user: `${used(m.user)}/${m.limits.user} chars` },
    });
  }
  return fail("Sideform Light answered in an unexpected way.");
}

export interface ToolDispatcherDeps {
  panel: McpPanelPort;
  now?: () => number;
}

/** `callTool` for the JSON-RPC layer. Never throws. */
export function createToolDispatcher(deps: ToolDispatcherDeps): (name: string, args: Record<string, unknown>) => Promise<McpToolResult> {
  const ask = (req: McpPanelRequest) => deps.panel.request(req);
  return async (name, args) => {
    try {
      switch (name) {
        case "start_task": {
          const p = parseStartTask(args);
          return p.ok ? resultOf(await ask(p.value), "started") : fail(p.error);
        }
        case "get_task": {
          const p = parseGetTask(args);
          if (!p.ok) return fail(p.error);
          const reply = await getTaskWaiting({ request: ask, onChanged: (cb) => deps.panel.onChanged(cb), now: deps.now }, p.value.taskId, p.value.waitSeconds);
          return resultOf(reply, "task");
        }
        case "answer_question": {
          const p = parseAnswerQuestion(args);
          return p.ok ? resultOf(await ask(p.value), "ok") : fail(p.error);
        }
        case "send_message": {
          const p = parseSendMessage(args);
          return p.ok ? resultOf(await ask(p.value), "ok") : fail(p.error);
        }
        case "stop_task": {
          const p = parseStopTask(args);
          return p.ok ? resultOf(await ask(p.value), "ok") : fail(p.error);
        }
        case "list_tasks": {
          const p = parseListTasks(args);
          return p.ok ? resultOf(await ask(p.value), "tasks") : fail(p.error);
        }
        case "memory_list":
          return resultOf(await ask({ op: "memory-list" }), "memory");
        case "memory_add": {
          const p = parseMemoryAdd(args);
          return p.ok ? resultOf(await ask(p.value), "memory") : fail(p.error);
        }
        case "memory_replace": {
          const p = parseMemoryReplace(args);
          return p.ok ? resultOf(await ask(p.value), "memory") : fail(p.error);
        }
        case "memory_remove": {
          const p = parseMemoryRemove(args);
          return p.ok ? resultOf(await ask(p.value), "memory") : fail(p.error);
        }
        default:
          return fail(`Unknown tool: ${name}`);
      }
    } catch {
      return fail("Internal error.");
    }
  };
}
