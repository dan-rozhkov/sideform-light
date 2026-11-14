// `get_task` with `waitSeconds`: holds the call until the task leaves `running` or the time is up. Pure: the clock,
// the sleep and the panel are injected, so it is tested with fake timers.
//
// It re-reads the task whenever the panel pushes `mcp:task-changed` for it (no tight polling) and returns early only
// when the status is not `running` in TWO reads one second apart: between two auto-continuations of the agent the
// chat is briefly idle and would read as done.

import type { McpPanelReply, McpPanelRequest } from "./types";

export const CONFIRM_DELAY_MS = 1000;
/** A running task is re-read at least this often, so a missed change push never stalls a wait. */
export const MAX_IDLE_MS = 5000;

export interface WaitDeps {
  request(req: McpPanelRequest): Promise<McpPanelReply>;
  onChanged(cb: (taskId: string) => void): () => void;
  now?: () => number;
}

const stateOf = (reply: McpPanelReply): "error" | "running" | "settled" => {
  if ("error" in reply) return "error";
  if ("task" in reply && reply.task.status === "running") return "running";
  return "settled";
};

/** Resolves after `ms`, or earlier when the task changes. Cleans up both. */
function sleepOrChange(deps: WaitDeps, taskId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let off: (() => void) | undefined;
    const done = () => {
      if (timer !== undefined) clearTimeout(timer);
      off?.();
      resolve();
    };
    timer = setTimeout(done, Math.max(0, ms));
    off = deps.onChanged((id) => {
      if (id === taskId) done();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getTaskWaiting(deps: WaitDeps, taskId: string, waitSeconds: number): Promise<McpPanelReply> {
  const now = deps.now ?? Date.now;
  const deadline = now() + waitSeconds * 1000;
  const read = () => deps.request({ op: "get", taskId });
  let reply = await read();
  while (waitSeconds > 0) {
    const state = stateOf(reply);
    if (state === "error") return reply;
    if (state === "settled") {
      // Confirm: the same non-running status one second later (only if the wait leaves room for it).
      if (now() + CONFIRM_DELAY_MS > deadline) return reply;
      await sleep(CONFIRM_DELAY_MS);
      reply = await read();
      if (stateOf(reply) !== "running") return reply;
      continue;
    }
    const left = deadline - now();
    if (left <= 0) return reply;
    await sleepOrChange(deps, taskId, Math.min(left, MAX_IDLE_MS));
    reply = await read();
  }
  return reply;
}
