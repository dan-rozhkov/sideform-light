import http from "node:http";
import type { AddressInfo } from "node:net";

/** A page of the stub ui: `#ready` carries `marker`. */
const page = (title: string, marker: string): string => `<!doctype html><title>${title}</title><h1 id="ready">${marker}</h1>`;

/**
 * The stub agent page: besides the `#ready` marker it registers the MCP bridge handler of the real panel
 * (`penAgentPanel.mcp.onRequest`) and answers with canned replies. `window.__mcpRequests` records every request
 * the app forwarded, so a spec can read what main validated and sent.
 */
const AGENT_MCP_SCRIPT = `
window.__mcpRequests = [];
window.__mcpMode = "done";
const task = (taskId, status, extra) => Object.assign({ taskId, title: "Stub task", status, updatedAt: 1, traces: [] }, extra || {});
window.penAgentPanel.mcp.onRequest(async (req) => {
  window.__mcpRequests.push(req);
  switch (req.op) {
    case "start": return { task: task("task-1", "running", { title: req.title || "Stub task" }) };
    case "get":
      if (req.taskId !== "task-1") return { error: "task not found" };
      if (window.__mcpMode === "question") return { task: task("task-1", "needs_answer", { question: { questions: [{ id: "q1", text: "Which plan?", type: "single", options: ["Free", "Pro"], required: true }] } }) };
      return { task: task("task-1", "done", { result: "canned result" }) };
    case "answer": case "message": case "stop": return { ok: true };
    case "list": return { tasks: [{ taskId: "task-1", title: "Stub task", status: "done", updatedAt: 1 }] };
    case "memory-list": return { memory: { enabled: true, memory: ["note"], user: ["person"], limits: { memory: 2200, user: 1375 } } };
    case "memory-apply":
      if (req.operations[0].action === "remove") return { error: "old_text matches no entry" };
      return { memory: { enabled: true, memory: req.target === "memory" ? [req.operations[0].content] : ["note"], user: req.target === "user" ? [req.operations[0].content] : ["person"], limits: { memory: 2200, user: 1375 } } };
    default: return { error: "unknown op" };
  }
});
`;

const agentPage = (): string =>
  `<!doctype html><title>Stub Agent</title><h1 id="ready">stub-agent</h1><script>${AGENT_MCP_SCRIPT}</script>`;

/**
 * An http server that stands in for the bundled ui in e2e (the shell's SIDEFORM_LIGHT_UI_URL points at it, so
 * no ui/dist is needed): `/agent`, `/settings` and `/trace/<id>` each answer a tiny page.
 */
export async function startStubUi(): Promise<{ url: string; server: http.Server; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    res.setHeader("content-type", "text/html");
    if (path.startsWith("/settings")) res.end(page("Stub Settings", "stub-settings"));
    else if (path.startsWith("/trace/")) res.end(page("Stub Trace", "stub-trace"));
    else res.end(agentPage());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, server, close: () => new Promise<void>((r) => server.close(() => r())) };
}
