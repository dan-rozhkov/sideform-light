# Sideform Light — integration contract (v1)

Sideform Light is a browser-only cut of Sideform Desktop. One window: agent chat
on the left, browser tabs on the right. The agent can drive several isolated
browser sessions in parallel. There is NO canvas, NO documents, NO workflows,
NO showcase, NO accounts/sign-in, NO computer use (desktop apps), NO desktop MCP
bridge (the old `browse_*` remote-control bridge). There IS a small MCP *task* bridge, off by default: see "MCP agent bridge".

Kept: agent chat (model picker, chat history on disk), browser tabs + address
row + omnibox, browse_agent with parallel isolated sessions, saved logins
(Passwords tab, fillLogin), History tab, ad blocking, trace tabs, QA
(assert, fixtures, checkpoint journal), Settings (appearance + browser + mcp), MCP agent bridge (task giver for external agents).

## Layout

- `app/` — Electron shell (from pen-editor-desktop 87a9d1c). CommonJS, `npm test`, `npm run lint`, `npm run build`.
- `ui/` — Vite + React app (from pen-editor 6ff39bbd), reduced to the agent panel, the trace page and a small settings page. Built into `ui/dist` and bundled into the Electron app. **No frontend is loaded from the network.**
- Backend: the existing `pen-editor-backend`. Light talks to it ONLY for agent requests (list below).

## Local origin: `app://sideform`

The shell registers a privileged scheme BEFORE `app.ready`:

```ts
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
```

and serves `ui/dist` with `protocol.handle("app", ...)` on the default session:

- host must be `sideform`; any other host → 404.
- path that maps to an existing file inside the ui dist dir → that file (correct MIME). Path traversal outside the dir → 404.
- any other path (no file) → `index.html` (SPA fallback) ONLY when it is route-like: no file extension in the last segment and not under `/assets/`; otherwise 404.
- response header `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' data: blob: <backend origin>; frame-src 'none'; object-src 'none'; base-uri 'none'`.

Packaged app: ui dist is copied to `app/dist/ui` by `app`'s build (`copy-static`), path resolved relative to `__dirname` of main. Dev override: env `SIDEFORM_LIGHT_UI_URL` (e.g. `http://localhost:5174`) makes the shell load pages from the Vite dev server instead; then the page origin is that URL's origin and all origin checks use it.

Pages (paths are identical on `app://sideform` and on the dev server):

| Page | URL | Preload |
|---|---|---|
| Agent panel | `app://sideform/agent` | `preload/agentPanel` (`window.penAgentPanel`) |
| Trace tab | `app://sideform/trace/<id>?src=local` | `preload/tab` (`window.penDesktop`) |
| Settings tab | `app://sideform/settings?section=<appearance|browser|mcp>` | `preload/tab` |

Local shell HTML (tab bar, empty start, passwords, history, omnibox) stays on `file://` as today.

`ui` routing: `BrowserRouter` with basename `/` (history API works on a standard scheme). Routes: `/agent`, `/trace/:id`, `/settings`, anything else → `/agent`.

## Backend

- Base URL: build-time `VITE_DESIGN_AGENT_BACKEND_URL`, default `http://localhost:3001` (the local backend). The shell's CSP `connect-src` uses the same origin; the shell reads it from env `SIDEFORM_LIGHT_BACKEND_URL` (default `http://localhost:3001`). Both must agree; the ui build and the app build read the same value.
- Endpoints Light uses (nothing else): `POST /api/chat`, `GET /api/models`, `POST /api/browse/step`, `POST /api/browse/plan`, `POST /api/browse/locate`, `POST /api/browse/judge`. No auth, no cookies (`credentials: "omit"`), no PostHog, no memory, no user skills, no Mobbin, no cloud browser, no cloud traces, no uploads.
- Identity: anonymous `pen.userId` from localStorage, sent as `userId` in the body as today.
- Agent mode: the main chat sends `agentMode: "browser"` (NEW mode in pen-editor-backend). The nested browse_agent chat keeps sending `agentMode: "browse"` as today.
- `clientCapabilities` sent by Light: `{ desktopBrowser: true, browser: "desktop", browseQa: true, browseIsolation: true, browseAssert: true, traceTabs: true }` and NOTHING about canvas/docs/workflows/apps/native apps (`canvasTabs`, `docTabs`, `workflowTabs`, `browseApps`, `browseNativeApps` are absent or false).

### Backend mode `browser` (pen-editor-backend)

- Added to `AGENT_MODES`. A system prompt for a browser assistant (no design/canvas wording): it uses `browse_agent` for web tasks, may run several `browse_agent` calls in parallel with isolated sessions, uses `ask_user` when it must ask, `analyze_image` for images, `trace_*` to read past runs.
- Tool set for the main model: `browse_agent`, `ask_user`, `analyze_image`, `trace_list`, `trace_read` (and `trace_frame` if it exists and needs no canvas). Exactly the browse tools the existing "edits" mode would offer for these capabilities — but NO canvas/design/doc/workflow/prototype/image-generation/vector/repo/showcase tools, no `get_guidelines`/style guides, no canvasContext.
- canvasContext is ignored in this mode. Memory and user skills: OFF in v1 (behave as in `browse`).
- Model: the normal chat model (`CHAT_MODEL` / the picked model), NOT the browse subagent model.

## penAgentPanel API (preload/agentPanel.ts) — v1 shape

```ts
window.penAgentPanel = {
  version: 3,
  browser,            // makeBrowser(): open, act, findImages, snapshot, perform, assert, read, screenshot, tabs,
                      // applyFixture, releaseFixture, clearActEmulation, fillLogin, startJournal, stopJournal,
                      // captureCheckpoint, requests, capture, isolated(sessionId), closeSession(sessionId), revealAgentTab
                      // `capture({ forTrace: true })` is used only for trace DOM snapshots of failed steps.
                      // REMOVED: launchApp, releaseApp, nativeApps, forChat
  chats,              // list, read, save, remove
  traces,             // save, open, listTabs, read
  settings,           // open(section?: "appearance" | "browser" | "mcp")
  mcp,                // onRequest(handler), notifyChanged(taskId): the MCP agent bridge, see below
}
```

`window.penDesktop` (preload/tab.ts, trace + settings tabs only): theme reporting, `traces` (read), `settings.open`/`onSection`, `browserSettings` (`get`/`set` of `{ adBlock }`), `mcp` (`get`/`set`/`regenerateToken`, below). No canvas, docs, workflows, logins (doc @mention), appIcon, auth, browser bridge.

Settings sections: `"appearance" | "browser" | "mcp"` only. Browser settings shape: `{ adBlock: boolean }` (`mcpBrowser` and `askAppAccess` removed). The Browser section also has "Record traces", a ui-only three-value `localStorage` setting (`pen.browseTraces`: `qa` = QA tests only, absent = `mcp` = QA tests and MCP tasks (default), `all` = every run), not part of the bridge; QA runs keep a trace in every mode.

## MCP agent bridge (v1)

An external agent (Hermes Agent, Claude Code, Codex, any MCP client on the same machine) gives a task in plain words to the RUNNING app, follows it and collects the result. It is a task giver, not a remote control: no browser tools over MCP. Design: `docs/superpowers/specs/2026-11-15-mcp-agent-bridge-design.md`. Code: `app/src/main/mcp/`.

**Endpoint.** `POST http://127.0.0.1:47821/mcp` (default port 47821; override for tests `SIDEFORM_LIGHT_MCP_PORT`; a busy port is a status error, never a fallback). JSON-RPC 2.0 with a plain `application/json` answer, server name `sideform-light`; methods `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/initialized` (202). `GET` and any other method on `/mcp` answer 405, other paths 404. Loopback only; `Authorization: Bearer <token>` (constant-time); the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`; any `Origin` header is rejected; 1 MB body cap. OFF by default. Settings file `<userData>/mcp-bridge.json` `{ enabled, token }` (0600, token = 64 hex, generated once). Connection file `~/.sideform-light/mcp.json` `{ url, token, port }` (dir 0700, file 0600), written on start and removed on stop/quit only while it still holds our token.

**Tools:** `start_task{prompt, title?}`, `get_task{taskId, waitSeconds?}`, `answer_question{taskId, answers}`, `send_message{taskId, text}`, `stop_task{taskId}`, `list_tasks{limit?}`. Inputs are validated in main (prompt 1..20000, title <= 200, text 1..20000, taskId `^[A-Za-z0-9_-]{1,128}$`, answers <= 50, limit 1..100, waitSeconds 0..55) and again in the panel. Results are JSON text; failures are `isError` results.

**Main <-> panel.** `penAgentPanel.mcp = { onRequest(handler) -> unsubscribe, notifyChanged(taskId) }`. `onRequest` registers THE handler (a second call replaces it) and sends `mcp:panel-ready`; main sends `mcp:task-request` `{ requestId, request }`, the page answers `mcp:task-reply` `{ requestId, reply }` (the preload does this from the handler's resolved value; a rejected handler gives `{ error }`); `notifyChanged` sends `mcp:task-changed` `{ taskId }` and wakes waiting `get_task` calls. All three panel -> main channels are accepted only from the panel's own webContents and panel page. Main routes to the ONE panel that registered last; none (or a reload in progress) -> `{ error: "Sideform Light has no open window" }`; no reply within 15 s -> `{ error: "Sideform Light did not answer" }`.

```ts
type McpPanelRequest =
  | { op: "start"; prompt: string; title?: string }
  | { op: "get"; taskId: string }
  | { op: "answer"; taskId: string; answers: { id: string; value: string | string[]; note?: string }[] }
  | { op: "message"; taskId: string; text: string }
  | { op: "stop"; taskId: string }
  | { op: "list"; limit: number };
type TaskStatus = "running" | "needs_answer" | "done" | "stopped" | "error";
interface TaskState { taskId: string; title: string; status: TaskStatus; updatedAt: number;
  question?: { questions: unknown[] }; result?: string; error?: string;
  traces: { traceId: string; title?: string; status?: string }[] }
type McpPanelReply = { error: string } | { task: TaskState } | { ok: true }
  | { tasks: Pick<TaskState, "taskId" | "title" | "status" | "updatedAt">[] };
```

`get_task` with `waitSeconds` re-reads the task (op `get`) on each `mcp:task-changed` for it (and at least every 5 s) and returns early only when the status is not `running` in two reads one second apart.

**Settings page (`penDesktop.mcp`).** Channels `mcp-settings:get|set|regenerate-token`, answered only to the top frame of a Settings tab on the settings page (like `browser-settings:*`), everything else gets `{ error: "Not allowed." }`.

```ts
interface McpSettingsView { enabled: boolean; port: number; url: string; token: string;
  status: { state: "off" | "starting" | "listening" | "error"; error?: string } }
mcp: { get(): Promise<McpSettingsView>;
       set(p: { enabled: boolean }): Promise<McpSettingsView | { error: string }>;
       regenerateToken(): Promise<McpSettingsView | { error: string }> }
```

Chat meta gains the optional field `source?: "mcp"` (`chats:save|read|list`; absent or exactly `"mcp"`, anything else is rejected as `invalid source`).

## Branding

Product name `Sideform Light`, appId `com.sideform.light`, userData dir name `Sideform Light` (must not collide with Sideform Desktop's data). Package names: `sideform-light` (app), `sideform-light-ui` (ui). Version 0.1.0 for both.
