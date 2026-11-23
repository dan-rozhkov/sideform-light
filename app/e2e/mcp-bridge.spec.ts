import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { launchShell, type Shell } from "./launch";
import { startStubUi } from "./stubUi";

// The MCP agent bridge end to end: the real app with the bridge switched on in its own userData dir, a stub agent page
// that answers `mcp:task-request` with canned replies, and real HTTP calls. HOME points at a temp dir so the
// connection file never touches the developer's ~/.sideform-light.

let stub: Awaited<ReturnType<typeof startStubUi>>;
let app: Shell;
let userData: string;
let home: string;
let port: number;
const token = randomBytes(32).toString("hex");

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function raw(opts: { method?: string; path?: string; host?: string; origin?: string; token?: string | null; body?: string }): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: opts.host ?? `127.0.0.1:${port}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? token}`;
    if (opts.origin !== undefined) headers.Origin = opts.origin;
    const req = http.request({ host: "127.0.0.1", port, path: opts.path ?? "/mcp", method: opts.method ?? "POST", headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(opts.body ?? "");
  });
}

let nextId = 1;
async function rpc(method: string, params?: unknown): Promise<{ result?: any; error?: { code: number; message: string } }> {
  const res = await raw({ body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) });
  expect(res.status).toBe(200);
  return JSON.parse(res.body);
}
async function tool(name: string, args: Record<string, unknown> = {}): Promise<{ isError?: boolean; json: any; text: string }> {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r.result.content[0].text as string;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: r.result.isError, json, text };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  stub = await startStubUi();
  port = await freePort();
  userData = mkdtempSync(path.join(tmpdir(), "sideform-mcp-ud-"));
  home = mkdtempSync(path.join(tmpdir(), "sideform-mcp-home-"));
  writeFileSync(path.join(userData, "mcp-bridge.json"), JSON.stringify({ enabled: true, token }));
  app = await launchShell({
    args: ["."],
    env: {
      ...process.env,
      SIDEFORM_LIGHT_UI_URL: stub.url,
      SIDEFORM_LIGHT_USER_DATA_DIR: userData,
      SIDEFORM_LIGHT_MCP_PORT: String(port),
      HOME: home,
      USERPROFILE: home,
    },
  });
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await stub?.close();
  for (const dir of [userData, home]) if (dir) rmSync(dir, { recursive: true, force: true });
});

test("the connection file is written with the url, token and port (0600)", async () => {
  const file = path.join(home, ".sideform-light", "mcp.json");
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ url: `http://127.0.0.1:${port}/mcp`, token, port });
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("initialize and tools/list: server sideform-light with the ten tools", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  expect(init.result.serverInfo.name).toBe("sideform-light");
  expect(init.result.capabilities).toEqual({ tools: {} });
  const note = await raw({ body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  expect(note.status).toBe(202);
  const list = await rpc("tools/list");
  expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["start_task", "get_task", "answer_question", "send_message", "stop_task", "list_tasks", "memory_list", "memory_add", "memory_replace", "memory_remove"]);
});

test("start_task and get_task go through the panel's handler", async () => {
  // The panel registers once its page loaded; until then the call says there is no window.
  await expect
    .poll(async () => (await tool("list_tasks")).isError ?? false, { timeout: 15_000 })
    .toBe(false);

  const started = await tool("start_task", { prompt: "Open example.com and tell me the title", title: "Title task" });
  expect(started.isError).toBeUndefined();
  expect(started.json).toEqual({ taskId: "task-1", status: "running" });

  const got = await tool("get_task", { taskId: "task-1" });
  expect(got.json).toMatchObject({ taskId: "task-1", status: "done", result: "canned result", traces: [] });

  const requests = await app.agentPage.evaluate(() => (window as unknown as { __mcpRequests: unknown[] }).__mcpRequests);
  expect(requests).toContainEqual({ op: "start", prompt: "Open example.com and tell me the title", title: "Title task" });
  expect(requests).toContainEqual({ op: "get", taskId: "task-1" });
});

test("a pending question, answer_question, send_message, stop_task and list_tasks", async () => {
  await app.agentPage.evaluate(() => ((window as unknown as { __mcpMode: string }).__mcpMode = "question"));
  const q = await tool("get_task", { taskId: "task-1", waitSeconds: 3 });
  expect(q.json.status).toBe("needs_answer");
  expect(q.json.question.questions[0].id).toBe("q1");
  expect((await tool("answer_question", { taskId: "task-1", answers: [{ id: "q1", value: "Pro" }] })).json).toEqual({ ok: true });
  expect((await tool("send_message", { taskId: "task-1", text: "and the price?" })).json).toEqual({ ok: true });
  expect((await tool("stop_task", { taskId: "task-1" })).json).toEqual({ ok: true });
  expect((await tool("list_tasks", { limit: 5 })).json.tasks[0].taskId).toBe("task-1");
  await app.agentPage.evaluate(() => ((window as unknown as { __mcpMode: string }).__mcpMode = "done"));
});

test("a panel error and a bad input come back as isError results; bad input never reaches the panel", async () => {
  const before = (await app.agentPage.evaluate(() => (window as unknown as { __mcpRequests: unknown[] }).__mcpRequests)).length;
  const missing = await tool("get_task", { taskId: "nope" });
  expect(missing).toMatchObject({ isError: true, text: "task not found" });
  for (const [name, args] of [["start_task", { prompt: "" }], ["get_task", { taskId: "x y" }], ["get_task", { taskId: "t", waitSeconds: 99 }], ["answer_question", { taskId: "t", answers: [] }], ["bogus", {}]] as const) {
    expect((await tool(name, args as Record<string, unknown>)).isError, name).toBe(true);
  }
  const after = (await app.agentPage.evaluate(() => (window as unknown as { __mcpRequests: unknown[] }).__mcpRequests)).length;
  expect(after - before).toBe(1); // only the "nope" lookup was forwarded
});

test("memory tools round-trip through the panel; a backend rejection is an isError result", async () => {
  const listed = await tool("memory_list");
  expect(listed.json).toEqual({ enabled: true, memory: ["note"], user: ["person"], limits: { memory: 2200, user: 1375 }, usage: { memory: "4/2200 chars", user: "6/1375 chars" } });
  const added = await tool("memory_add", { target: "user", text: "prefers tea" });
  expect(added.isError).toBeUndefined();
  expect(added.json.user).toEqual(["prefers tea"]);
  const rejected = await tool("memory_remove", { target: "memory", oldText: "zzz" });
  expect(rejected).toMatchObject({ isError: true, text: "old_text matches no entry" });
  const requests = await app.agentPage.evaluate(() => (window as unknown as { __mcpRequests: unknown[] }).__mcpRequests);
  expect(requests).toContainEqual({ op: "memory-apply", target: "user", operations: [{ action: "add", content: "prefers tea" }] });
  expect((await tool("memory_add", { target: "bad", text: "x" })).isError).toBe(true);
});

test("rejections: no token, wrong token, Origin, bad Host, wrong path, GET", async () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  expect((await raw({ body, token: null })).status).toBe(401);
  expect((await raw({ body, token: "b".repeat(64) })).status).toBe(401);
  expect((await raw({ body, origin: "https://evil.test" })).status).toBe(403);
  expect((await raw({ body, host: "attacker.test" })).status).toBe(403);
  expect((await raw({ body, path: "/" })).status).toBe(404);
  const get = await raw({ method: "GET" });
  expect(get.status).toBe(405);
  expect(get.headers.allow).toBe("POST");
  expect((await raw({ body, host: `localhost:${port}` })).status).toBe(200);
});

test("the Settings page reads the bridge over penDesktop.mcp; the panel has no such bridge", async () => {
  expect(await app.agentPage.evaluate(() => typeof (window as unknown as { penDesktop?: unknown }).penDesktop)).toBe("undefined");
  await app.agentPage.evaluate(() => (window as unknown as { penAgentPanel: { settings: { open(s: string): Promise<unknown> } } }).penAgentPanel.settings.open("mcp"));
  const settingsPage = app.windows().find((p) => new URL(p.url()).pathname === "/settings") ?? (await app.waitForEvent("window", { predicate: (p) => new URL(p.url()).pathname === "/settings" }));
  await settingsPage.waitForLoadState();
  const view = await settingsPage.evaluate(() => (window as any).penDesktop.mcp.get());
  expect(view).toEqual({ enabled: true, port, url: `http://127.0.0.1:${port}/mcp`, token, status: { state: "listening" } });
  expect(await settingsPage.evaluate(() => (window as any).penDesktop.mcp.set({ enabled: "yes" }))).toEqual({ error: "Invalid settings." });

  // New token: the old one stops working at once, the new one works, the file follows.
  const regenerated = await settingsPage.evaluate(() => (window as any).penDesktop.mcp.regenerateToken());
  expect(regenerated.token).toMatch(/^[0-9a-f]{64}$/);
  expect(regenerated.token).not.toBe(token);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  expect((await raw({ body })).status).toBe(401);
  expect((await raw({ body, token: regenerated.token })).status).toBe(200);
  expect(JSON.parse(readFileSync(path.join(home, ".sideform-light", "mcp.json"), "utf8")).token).toBe(regenerated.token);
  expect(JSON.parse(readFileSync(path.join(userData, "mcp-bridge.json"), "utf8"))).toEqual({ enabled: true, token: regenerated.token });

  // Off: the server stops and the connection file goes.
  const off = await settingsPage.evaluate(() => (window as any).penDesktop.mcp.set({ enabled: false }));
  expect(off).toMatchObject({ enabled: false, status: { state: "off" } });
  await expect(raw({ body, token: regenerated.token })).rejects.toMatchObject({ code: "ECONNREFUSED" });
  expect(existsSync(path.join(home, ".sideform-light", "mcp.json"))).toBe(false);

  // On again: back up on the same port.
  const on = await settingsPage.evaluate(() => (window as any).penDesktop.mcp.set({ enabled: true }));
  expect(on).toMatchObject({ enabled: true, status: { state: "listening" } });
  expect((await raw({ body, token: regenerated.token })).status).toBe(200);
});
