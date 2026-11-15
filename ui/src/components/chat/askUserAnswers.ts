import { t } from "@/i18n";
import {
  DECIDE_FOR_ME,
  type AskUserAnswer,
  type AskUserOutput,
  type AskUserQuestion,
} from "@/types/askUser";

export interface AnswerValue {
  value: string | string[];
  note: string;
}
export type AnswerState = Record<string, AnswerValue>;

export function initAnswerState(questions: AskUserQuestion[]): AnswerState {
  const state: AnswerState = {};
  for (const q of questions) {
    state[q.id] = { value: q.type === "multi" ? [] : "", note: "" };
  }
  return state;
}

export function isAnswered(q: AskUserQuestion, a: AnswerValue): boolean {
  if (a.note.trim() !== "") return true;
  if (q.type === "multi") return Array.isArray(a.value) && a.value.length > 0;
  return typeof a.value === "string" && a.value.trim() !== "";
}

export function allRequiredAnswered(
  questions: AskUserQuestion[],
  state: AnswerState,
): boolean {
  return questions.every((q) => !q.required || isAnswered(q, state[q.id]));
}

export function serializeAnswers(
  questions: AskUserQuestion[],
  state: AnswerState,
): string {
  const answers: AskUserAnswer[] = questions.map((q) => {
    const a = state[q.id];
    const answer: AskUserAnswer = { id: q.id, value: a.value };
    if (a.note.trim() !== "") answer.note = a.note.trim();
    return answer;
  });
  const out: AskUserOutput = { answers };
  return JSON.stringify(out);
}

function labelFor(q: AskUserQuestion, value: string): string {
  if (value === DECIDE_FOR_ME) return t("tools.ask.decideForMe");
  return q.options?.find((o) => o.value === value)?.label ?? value;
}

export function summarizeAnswers(
  questions: AskUserQuestion[],
  state: AnswerState,
): { label: string; display: string }[] {
  return questions.map((q) => {
    const a = state[q.id];
    let display: string;
    if (Array.isArray(a.value)) {
      display = a.value.map((v) => labelFor(q, v)).join(", ");
    } else {
      display = a.value ? labelFor(q, a.value) : "";
    }
    if (a.note.trim() !== "") {
      display = display ? `${display} — ${a.note.trim()}` : a.note.trim();
    }
    return { label: q.label, display };
  });
}

/**
 * Turns answers given from outside the form (the MCP bridge) into the form's state, with the form's
 * rules: ids must be questions of the form, a multi question takes a list (a single string is wrapped),
 * the other types take one string, and every required question needs an answer.
 */
export function buildAnswerState(
  questions: AskUserQuestion[],
  answers: { id: string; value: string | string[]; note?: string }[],
): { state: AnswerState } | { error: string } {
  const state = initAnswerState(questions);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  for (const a of answers) {
    const q = byId.get(a.id);
    if (!q) return { error: `Unknown question id: ${a.id}` };
    if (seen.has(a.id)) return { error: `Question answered twice: ${a.id}` };
    seen.add(a.id);
    let value: string | string[];
    if (q.type === "multi") {
      value = Array.isArray(a.value) ? a.value.filter((v) => typeof v === "string") : typeof a.value === "string" && a.value ? [a.value] : [];
    } else {
      if (typeof a.value !== "string") return { error: `Question ${a.id} takes one text value` };
      value = a.value;
    }
    state[a.id] = { value, note: typeof a.note === "string" ? a.note : "" };
  }
  const missing = questions.find((q) => q.required && !isAnswered(q, state[q.id]));
  if (missing) return { error: `Question ${missing.id} needs an answer` };
  return { state };
}
