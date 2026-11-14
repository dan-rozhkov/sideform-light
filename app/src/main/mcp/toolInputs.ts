// Validation of the MCP tool inputs. Pure. Main validates BEFORE a request reaches the panel (the panel validates
// again). Limits are the contract of CONTRACT.md "MCP agent bridge"; extra keys are dropped.

import { TASK_ID_RE as TASK_ID, type McpAnswer, type McpPanelRequest } from "./types";

export const MAX_PROMPT_CHARS = 20_000;
export const MAX_TITLE_CHARS = 200;
export const MAX_TEXT_CHARS = 20_000;
export const MAX_ANSWERS = 50;
export const MAX_ANSWER_VALUES = 100;
export const MAX_ANSWER_TEXT_CHARS = 20_000;
export const MAX_ANSWER_ID_CHARS = 200;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_WAIT_SECONDS = 55;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

function taskIdOf(args: Record<string, unknown>): Parsed<string> {
  const { taskId } = args;
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) return bad("taskId must be a task id returned by start_task or list_tasks.");
  return { ok: true, value: taskId };
}

function textOf(v: unknown, name: string, max: number): Parsed<string> {
  if (typeof v !== "string" || v.trim().length === 0) return bad(`${name} must be a non-empty string.`);
  if (v.length > max) return bad(`${name} is too long (at most ${max} characters).`);
  return { ok: true, value: v };
}

export function parseAnswers(raw: unknown): Parsed<McpAnswer[]> {
  if (!Array.isArray(raw)) return bad("answers must be an array of { id, value, note? }.");
  if (raw.length === 0) return bad("answers must not be empty.");
  if (raw.length > MAX_ANSWERS) return bad(`answers has too many entries (at most ${MAX_ANSWERS}).`);
  const out: McpAnswer[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return bad("Each answer must be an object { id, value, note? }.");
    const { id, value, note } = item as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ANSWER_ID_CHARS) return bad("Each answer needs the question id as a string.");
    if (seen.has(id)) return bad(`Question ${id} is answered twice.`);
    seen.add(id);
    let v: string | string[];
    if (typeof value === "string") {
      if (value.length > MAX_ANSWER_TEXT_CHARS) return bad("An answer value is too long.");
      v = value;
    } else if (Array.isArray(value)) {
      if (value.length > MAX_ANSWER_VALUES) return bad("An answer has too many values.");
      if (!value.every((x) => typeof x === "string" && x.length <= MAX_ANSWER_TEXT_CHARS)) return bad("An answer value list must hold strings.");
      v = [...(value as string[])];
    } else {
      return bad("An answer value must be a string or an array of strings.");
    }
    const answer: McpAnswer = { id, value: v };
    if (note !== undefined) {
      if (typeof note !== "string" || note.length > MAX_ANSWER_TEXT_CHARS) return bad("An answer note must be a string.");
      answer.note = note;
    }
    out.push(answer);
  }
  return { ok: true, value: out };
}

export function parseStartTask(args: Record<string, unknown>): Parsed<Extract<McpPanelRequest, { op: "start" }>> {
  const prompt = textOf(args.prompt, "prompt", MAX_PROMPT_CHARS);
  if (!prompt.ok) return prompt;
  const req: Extract<McpPanelRequest, { op: "start" }> = { op: "start", prompt: prompt.value };
  if (args.title !== undefined) {
    if (typeof args.title !== "string" || args.title.length > MAX_TITLE_CHARS) return bad(`title must be a string of at most ${MAX_TITLE_CHARS} characters.`);
    if (args.title.trim().length > 0) req.title = args.title;
  }
  return { ok: true, value: req };
}

/** `get_task`: the request plus the wait in seconds (0 = answer at once). */
export function parseGetTask(args: Record<string, unknown>): Parsed<{ taskId: string; waitSeconds: number }> {
  const id = taskIdOf(args);
  if (!id.ok) return id;
  let waitSeconds = 0;
  if (args.waitSeconds !== undefined) {
    const w = args.waitSeconds;
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > MAX_WAIT_SECONDS) return bad(`waitSeconds must be a number from 0 to ${MAX_WAIT_SECONDS}.`);
    waitSeconds = w;
  }
  return { ok: true, value: { taskId: id.value, waitSeconds } };
}

export function parseAnswerQuestion(args: Record<string, unknown>): Parsed<Extract<McpPanelRequest, { op: "answer" }>> {
  const id = taskIdOf(args);
  if (!id.ok) return id;
  const answers = parseAnswers(args.answers);
  if (!answers.ok) return answers;
  return { ok: true, value: { op: "answer", taskId: id.value, answers: answers.value } };
}

export function parseSendMessage(args: Record<string, unknown>): Parsed<Extract<McpPanelRequest, { op: "message" }>> {
  const id = taskIdOf(args);
  if (!id.ok) return id;
  const text = textOf(args.text, "text", MAX_TEXT_CHARS);
  if (!text.ok) return text;
  return { ok: true, value: { op: "message", taskId: id.value, text: text.value } };
}

export function parseStopTask(args: Record<string, unknown>): Parsed<Extract<McpPanelRequest, { op: "stop" }>> {
  const id = taskIdOf(args);
  if (!id.ok) return id;
  return { ok: true, value: { op: "stop", taskId: id.value } };
}

export function parseListTasks(args: Record<string, unknown>): Parsed<Extract<McpPanelRequest, { op: "list" }>> {
  let limit = DEFAULT_LIST_LIMIT;
  if (args.limit !== undefined) {
    const l = args.limit;
    if (typeof l !== "number" || !Number.isInteger(l) || l < 1 || l > MAX_LIST_LIMIT) return bad(`limit must be a whole number from 1 to ${MAX_LIST_LIMIT}.`);
    limit = l;
  }
  return { ok: true, value: { op: "list", limit } };
}
