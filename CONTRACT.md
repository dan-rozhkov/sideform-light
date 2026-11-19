# Sideform Light — integration contract (v1)

Sideform Light is a browser-only cut of Sideform Desktop. One window: agent chat
on the left, browser tabs on the right. The agent can drive several isolated
browser sessions in parallel. There is NO canvas, NO documents, NO workflows,
NO showcase, NO accounts/sign-in, NO computer use (desktop apps), NO desktop MCP
bridge (the old `browse_*` remote-control bridge). There IS a small MCP *task* bridge, off by default: see "MCP agent bridge".

Kept: agent chat (model picker, chat history on disk), browser tabs + address
row + omnibox, browse_agent with parallel isolated sessions, saved logins
(Passwords tab, fillLogin), History tab, ad blocking, trace tabs, QA
(assert, fixtures, checkpoint journal), Settings (appearance + model + browser + mcp + schedules), MCP agent bridge (task giver for external agents), scheduled chats.

## Layout

- `app/` — Electron shell (from pen-editor-desktop 87a9d1c). CommonJS, `npm test`, `npm run lint`, `npm run build`.
- `ui/` — Vite + React app (from pen-editor 6ff39bbd), reduced to the agent panel, the trace page and a small settings page. Built into `ui/dist` and bundled into the Electron app. **No frontend is loaded from the network.**
- Backend: `pen-editor-backend` in its LOCAL mode, bundled INTO the app and run on the user's machine (see "Backend"). Light talks to it ONLY for agent requests (list below). There is no hosted backend and no built-in model provider.

## Local origin: `app://sideform`

The shell registers a privileged scheme BEFORE `app.ready`:

```ts
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
```

and serves `ui/dist` with `protocol.handle("app", ...)` on the default session:

- host must be `sideform`; any other host → 404.
- path `/api` or under `/api/` → NOT a file: proxied to the local backend (see "Backend"), any method.
- path that maps to an existing file inside the ui dist dir → that file (correct MIME). Path traversal outside the dir → 404.
- any other path (no file) → `index.html` (SPA fallback) ONLY when it is route-like: no file extension in the last segment and not under `/assets/`; otherwise 404.
- response header `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'`.

Packaged app: ui dist is copied to `app/dist/ui` by `app`'s build (`copy-static`), path resolved relative to `__dirname` of main. Dev override: env `SIDEFORM_LIGHT_UI_URL` (e.g. `http://localhost:5174`) makes the shell load pages from the Vite dev server instead; then the page origin is that URL's origin and all origin checks use it.

Pages (paths are identical on `app://sideform` and on the dev server):

| Page | URL | Preload |
|---|---|---|
| Agent panel | `app://sideform/agent` | `preload/agentPanel` (`window.penAgentPanel`) |
| Trace tab | `app://sideform/trace/<id>?src=local` | `preload/tab` (`window.penDesktop`) |
| Settings tab | `app://sideform/settings?section=<appearance|model|memory|browser|mcp|schedules>` | `preload/tab` |

Local shell HTML (tab bar, empty start, passwords, history, omnibox) stays on `file://` as today.

`ui` routing: `BrowserRouter` with basename `/` (history API works on a standard scheme). Routes: `/agent`, `/trace/:id`, `/settings`, anything else → `/agent`.

## Backend

- **Bundled local backend.** The app ships pen-editor-backend's local bundle (`npm run build:local` in pen-editor-backend → `dist-local/`: `server.mjs` + its data files) at `app/dist/backend/`. The pinned backend commit is in `backend-ref.txt` at the repo root; `app`'s build copies the bundle from `SIDEFORM_LIGHT_BACKEND_BUNDLE` (a `dist-local` dir); `SIDEFORM_LIGHT_SKIP_BACKEND=1` builds without it (tests, CI). `npm run dist`/`dist:win` refuse to package without it.
- **Process.** After `app.ready` the shell starts it with `utilityProcess.fork(dist/backend/server.mjs)` and env `SIDEFORM_LOCAL=1`, `PORT=0`, `SIDEFORM_LOCAL_TOKEN=<random per launch>`, `SIDEFORM_LOCAL_DATA_DIR=<userData>/backend`. The backend answers on its `process.parentPort` with `{ type: "ready", port }` once it listens (and prints `SIDEFORM_LOCAL_READY port=<n>` to stdout outside Electron). The backend always binds `127.0.0.1` (it ignores `HOST`), refuses to start without `SIDEFORM_LOCAL_TOKEN` (except `npm run dev:local`, which sets `SIDEFORM_LOCAL_INSECURE_DEV=1`) and answers 403 to a `Host` header other than `127.0.0.1:<port>` / `localhost:<port>`. It exits when its parent process is gone. The shell kills it on quit and restarts it after a crash (backoff, at most 3 restarts per minute; after that it stays down for a cool-down of 60 s, then the next `/api` request starts it again).
- **Base URL in the ui: same origin.** The ui calls `/api/*` relative to its own origin. On `app://sideform` the shell's protocol handler forwards every `/api/*` request (method, headers, streamed body; a renderer abort cancels the response body, which closes the upstream connection) to `http://127.0.0.1:<port>` and adds `X-Sideform-Local-Token`; the response streams back. Before the backend is ready the handler waits up to 25 s, then answers 502 `{ "error": "local_backend_unavailable" }` (502, not 503: the chat client retries 503); an upstream connection error is the same 502. Dev overrides: `SIDEFORM_LIGHT_BACKEND_URL` (e.g. `http://localhost:3001`) makes the shell forward to that origin instead and NOT start the bundled backend (no token added); the Vite dev server (`SIDEFORM_LIGHT_UI_URL`) proxies `/api` to `VITE_DEV_BACKEND_URL` (default `http://localhost:3001`). `VITE_DESIGN_AGENT_BACKEND_URL` / `VITE_AI_API_URL` still force an absolute base if set: for a ui served outside the app only (the `app://` CSP allows `'self'` alone, so a bundled ui built with them cannot reach the backend). CSP `connect-src` is `'self' data: blob:` — no backend origin.
- **Local mode (pen-editor-backend `SIDEFORM_LOCAL=1`).** Only the Light routes below exist. No database (agent memory is a local file, see "Agent memory"), no auth, no PostHog, no TypeSafe, no OpenRouter key: there is NO server-side model. Every request must carry `X-Sideform-Local-Token` equal to `SIDEFORM_LOCAL_TOKEN` (else 401) when that env is set. `BYOK_ALLOW_PRIVATE_NETWORK` is on (a local Ollama / LM Studio is a valid provider). `GET /api/models` answers `{ models: [], default: null, visionFallback: false, imageOps: { removeBackground: false, vectorize: false } }`. `POST /api/chat` with a model that is not `byok/…` (or none) answers 400 `{ error: "provider_required" }`; an `agentMode` other than `browser` / `browse` answers 400 `{ error: "agent_mode_unsupported" }`. A `byok/` model is assumed to accept images: screenshots from browse tools reach it as image parts of a user message that follows the tool result. `/api/browse/{step,plan,locate}` answer 503 (browse_task / `element` lookup are off; browse_agent uses its lower-level tools). `/api/browse/judge` answers 200 `{ disabled: true }`. Helpers that need a server model (image description fallback, prompt suggestions, titles) are off.
- **No default provider.** The agent works only after the user adds their own provider in Settings > Model (see "Own model provider"). Until then the composer shows that a provider is needed, with a button that opens Settings > Model, and sending is disabled.
- Endpoints Light uses (nothing else): `POST /api/chat`, `GET /api/models`, `POST /api/browse/step`, `POST /api/browse/plan`, `POST /api/browse/locate`, `POST /api/browse/judge`, `POST /api/byok/models` (see "Own model provider"), `GET|DELETE /api/memory`, `DELETE /api/memory/entry`, `PUT /api/memory/settings`, `GET /api/memory/activity` (see "Agent memory"). No auth, no cookies (`credentials: "omit"`), no PostHog, no user skills, no Mobbin, no cloud browser, no cloud traces, no uploads.
- Identity: anonymous `pen.userId` from localStorage, sent as `userId` in the body as today.
- Agent mode: the main chat sends `agentMode: "browser"` (NEW mode in pen-editor-backend). The nested browse_agent chat keeps sending `agentMode: "browse"` as today.
- `clientCapabilities` sent by Light: `{ desktopBrowser: true, browser: "desktop", browseQa: true, browseIsolation: true, browseAssert: true, traceTabs: true, schedules: true }` (`schedules` only when `penAgentPanel.schedules` exists) and NOTHING about canvas/docs/workflows/apps/native apps (`canvasTabs`, `docTabs`, `workflowTabs`, `browseApps`, `browseNativeApps` are absent or false).

### Backend mode `browser` (pen-editor-backend)

- Added to `AGENT_MODES`. A system prompt for a browser assistant (no design/canvas wording): it uses `browse_agent` for web tasks, may run several `browse_agent` calls in parallel with isolated sessions, uses `ask_user` when it must ask, `analyze_image` for images, `trace_*` to read past runs.
- Tool set for the main model: `browse_agent`, `ask_user`, `analyze_image`, `trace_list`, `trace_read`, plus `schedule_list`, `schedule_create`, `schedule_set_enabled` and `schedule_delete` when `clientCapabilities.schedules` is true (see "Scheduled chats") (and `trace_frame` if it exists and needs no canvas). Exactly the browse tools the existing "edits" mode would offer for these capabilities — but NO canvas/design/doc/workflow/prototype/image-generation/vector/repo/showcase tools, no `get_guidelines`/style guides, no canvasContext.
- canvasContext is ignored in this mode. Memory: ON (see "Agent memory"); the nested `browse` turn has none. User/learned skills: OFF.
- Model: the normal chat model (`CHAT_MODEL` / the picked model), NOT the browse subagent model.

### Own model provider (BYOK)

The user may run the agent on their own OpenAI-compatible provider — in Light this is the ONLY provider (pen-editor-backend spec `docs/specs/2026-11-13-byok-custom-provider-design.md`). Settings > Model keeps `{ baseUrl, apiKey, models[] }` in the ui's localStorage `pen.byok.v1` (shared by the panel and the Settings tab on `app://sideform`; the shell never reads it). Such models appear in the picker as `byok/<modelId>`.

- `POST /api/chat` with a `byok/` model carries `X-BYOK-Base-URL` and `X-BYOK-Key` headers; never in the body, never on other turns. Without them the backend answers 400 `byok_key_required`; a private/non-https URL is 400 `byok_base_url_invalid` (unless the backend runs with `BYOK_ALLOW_PRIVATE_NETWORK=true`).
- The nested `browse_agent` chat (`agentMode: "browse"`) sends the parent chat's `model` and the same headers when that model is `byok/`; the backend then runs the browsing subagent on it. Otherwise it sends no `model` and the backend pins its own.
- `POST /api/byok/models` (same headers) loads the provider's model list: `{ ok: true, models: [{ id, contextWindow? }] }` or `{ ok: false, reason: "invalid_key" | "no_model_list" | "upstream_error" }`.
- Helper calls (`/api/browse/{step,plan,locate,judge}`, image description) need the backend's own models, which the local backend does not have: they are off (see "Local mode").

### Agent memory

The same persistent memory as in Pen Editor (pen-editor-backend `src/ai/memory/`): two always-in-prompt stores, `user` (who the user is, 1375 chars) and `memory` (the agent's own notes, 2200 chars), the `memory` tool (add / replace / remove in one atomic batch), the snapshot in the system prompt of every `browser` turn, and a background review of the chat every `MEMORY_REVIEW_INTERVAL` user turns.

- **Stored on the device only.** The local backend keeps it in `<userData>/backend/agent-memory.json` (`SIDEFORM_LOCAL_DATA_DIR`, atomic write, 0600), keyed by the anonymous `pen.userId`; nothing goes to a server of ours. The entries reach the user's model provider only as part of the agent's prompt.
- **The user's model.** The turn and the background review both run on the chat's `byok/` model with its `X-BYOK-*` headers. No `byok/` model or no headers → no review (there is no server model to fall back to).
- **Endpoints** (`userId` in the query, same shapes as Pen Editor): `GET /api/memory` → `{ available, enabled, memory: string[], user: string[], limits: { memory, user } }`; `DELETE /api/memory/entry` `{ target, text }` → `{ removed: true }` | 404; `DELETE /api/memory` → `{ cleared: { memory, user } }`; `PUT /api/memory/settings` `{ enabled }` → `{ enabled }`; `GET /api/memory/activity?sinceId=` → `{ events, latestId }` (no `sinceId` = baseline, `latestId` only). No data dir → `available: false` / 503.
- **ui.** Settings > Memory (`?section=memory`): switch "agent remembers", the entries of both stores with delete, clear all. The chat shows a "memory updated" row for writes of the turn and of the background review. The shell itself never reads the file.

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
  settings,           // open(section?: "appearance" | "model" | "memory" | "browser" | "mcp" | "schedules")
  mcp,                // onRequest(handler), notifyChanged(taskId): the MCP agent bridge, see below
  schedules,          // list(), create({ name, prompt, cron }), setEnabled(id, enabled), remove(id): for the schedule_* agent tools, see "Scheduled chats"
}
```

`window.penDesktop` (preload/tab.ts, trace + settings tabs only): theme and language reporting (`tab:theme`, `tab:language`; the agent panel reports `panel:theme` and `panel:language`), `traces` (read), `settings.open`/`onSection`, `browserSettings` (`get`/`set` of `{ adBlock }`), `mcp` (`get`/`set`/`regenerateToken`, below), `schedules` (below). No canvas, docs, workflows, logins (doc @mention), appIcon, auth, browser bridge.

Settings sections: `"appearance" | "model" | "memory" | "browser" | "mcp" | "schedules"` only. Browser settings shape: `{ adBlock: boolean }` (`mcpBrowser` and `askAppAccess` removed). The Browser section also has "Record traces", a ui-only three-value `localStorage` setting (`pen.browseTraces`: `qa` = QA tests only, absent = `mcp` = QA tests and MCP tasks (default), `all` = every run), not part of the bridge; QA runs keep a trace in every mode.

## Interface language (en, ru, de, it, fr)

The Electron shell (native menus, dialogs, notifications, tab bar, empty start, suggestion popover, Passwords and History pages) speaks the language of the ui. **The ui is the source of truth; `<html lang>` is the signal.**

- The ui ALWAYS sets `document.documentElement.lang` to its active language code (`en|ru|de|it|fr`; the Settings value `ui-language` in localStorage, absent = the system language, fallback `en`) at start and on every change.
- The preloads observe that attribute and report it over **`panel:language`** (agent panel, `preload/agentPanel`) and **`tab:language`** (trace and Settings tabs, `preload/tab`): the bare code as the one argument, only a supported code, only when it changes. They are NEW channels, not members of `penAgentPanel` / `penDesktop` (those shapes do not change); a ui needs no code for this beyond setting `<html lang>`.
- Main accepts `panel:language` only from the panel's own webContents while it shows the panel page, and `tab:language` only from the TOP frame of a ui tab on the ui origin; anything else, and any unsupported code, is ignored.
- On a change main persists `<userData>/ui-language.json` `{ "language": "<code>" }` (atomic write), rebuilds the application menu and sends every local shell page its dictionary (`shell:i18n` `{ lang, strings }`, only the keys that page needs). Initial language: that file, else env `SIDEFORM_LIGHT_LANGUAGE` (tests), else the system language (`app.getLocale()`, `app.getPreferredSystemLanguages()`), else `en`.
- The shell never changes the ui's language; the persisted file only makes the next start paint the shell right before the ui has loaded.

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

Chat meta gains the optional field `source?: "mcp" | "schedule"` (`chats:save|read|list`; absent, `"mcp"` or `"schedule"`, anything else is rejected as `invalid source`). MCP ops (`start`, `get`, `list`, …) see only `source: "mcp"` chats.

## Scheduled chats (v1)

A schedule = name + prompt + 5-field cron (local time). While the app runs, main fires it: a new chat with `source: "schedule"` opens in the panel (not activated, marked unread) and the ordinary browser agent does the work. No catch-up of runs missed while the app was closed or asleep; a run is skipped while the previous run of the same schedule is still open. Design: `docs/superpowers/specs/2026-11-15-scheduled-chats-design.md`. Code: `app/src/main/schedules/`.

**Store.** `<userData>/schedules.json` (0600, atomic) `{ version: 1, schedules: Schedule[] }`, max 50.

```ts
interface Schedule { id: string; name: string /* 1..100 */; prompt: string /* 1..20000 */; cron: string /* <= 100 */;
  enabled: boolean; createdAt: number; updatedAt: number;
  lastRun?: { at: number; status: "started" | "skipped" | "failed"; chatId?: string; error?: string } }
interface ScheduleView extends Schedule { nextRunAt: number | null }
interface ScheduleInput { id?: string; name: string; prompt: string; cron: string; enabled: boolean }
```

**Main -> panel.** One more op on the MCP panel channel (`mcp:task-request` / `mcp:task-reply`; the panel registers it always, not only when the MCP server is on):

```ts
| { op: "schedule-start"; scheduleId: string; prompt: string; title: string; previousChatId?: string } // -> { task } | { error, code?: "busy" }
```

`schedule-start` answers `{ error, code: "busy" }` when `previousChatId` is still `running`/`needs_answer`, or when 3 schedule runs are already executing (busy or launch queued; chats waiting for an answer or finished do not count). Main records a busy answer as `skipped`, any other error as `failed`, and keeps the chat id of the last started run in `lastRun.chatId` either way.

**Settings page (`penDesktop.schedules`).** Channels `schedules:list|save|remove|run-now` (invoke), answered only to the top frame of a Settings tab on the settings page (like `mcp-settings:*`), else `{ error: "Not allowed." }`. Main pushes `schedules:changed` (no payload) to Settings tabs after any change or run.

```ts
schedules: {
  list(): Promise<{ schedules: ScheduleView[] } | { error: string }>;
  save(input: ScheduleInput): Promise<{ schedule: ScheduleView } | { error: string }>;   // no id = create
  remove(id: string): Promise<{ ok: true } | { error: string }>;
  runNow(id: string): Promise<{ schedule: ScheduleView } | { error: string }>;
  onChanged(cb: () => void): () => void;
}
```

**Agent tools (`schedule_list`, `schedule_create`, `schedule_set_enabled`, `schedule_delete`).** Design: `docs/superpowers/specs/2026-11-15-schedule-agent-tool-design.md`. Client-executed, NOT in the backend's `penTools` (pen-editor never sees them): the backend adds them only to an `agentMode: "browser"` turn whose `clientCapabilities.schedules` is true.

```ts
schedule_create: { name: string /* 1..100 */; prompt: string /* 1..20000 */; cron: string /* 1..100 */ }
  // -> { status: "created"; schedule: ScheduleSummary } | { status: "declined" } | { status: "error"; error: string }
schedule_list: {} // -> { schedules: ScheduleSummary[] } | { status: "error"; error: string }
schedule_set_enabled: { id: string; enabled: boolean } // pause/resume -> { status: "updated"; schedule: ScheduleSummary } | { status: "declined" } | { status: "error"; error: string }
schedule_delete: { id: string } // -> { status: "deleted"; id: string } | { status: "declined" } | { status: "error"; error: string }
interface ScheduleSummary { id: string; name: string; cron: string; description: string; enabled: boolean;
  nextRun?: string; lastRun?: { status: string; at: string } }   // times as local readable strings
```

`schedule_create`, `schedule_set_enabled` and `schedule_delete` wait for the person: the chat shows a confirmation card, and only its confirm button (Create schedule / Pause / Resume / Delete) acts. An unknown id, or a pause/resume that changes nothing, answers at once without a card. In a background chat (`source` `mcp` or `schedule`) it answers `{ status: "error" }` without a card (`create`: "Schedules can be created only in a chat with the person."; `set_enabled` / `delete`: "Schedules can be changed only in a chat with the person."). The `onToolCall` precheck alone decides whether a card is needed (for `set_enabled` / `delete` it records the looked-up schedule in memory before leaving the part pending); the card never resolves a call on its own, only Confirm / Cancel do, and without that record (precheck still running, or after a reload) no card is drawn and the composer is not blocked. The panel acts through `penAgentPanel.schedules`: `create` = `schedules:panel-create`, `list` = `schedules:panel-list`, `setEnabled(id, enabled)` = `schedules:panel-set-enabled`, `remove(id)` = `schedules:panel-remove`, invoke channels accepted only from the agent panel's own webContents and page (the `chats:*` rule), else `{ error: "Not allowed." }`; `create` validates like `schedules:save`, stores the schedule enabled and pushes `schedules:changed`.

## Branding

Product name `Sideform Light`, appId `com.sideform.light`, userData dir name `Sideform Light` (must not collide with Sideform Desktop's data). Package names: `sideform-light` (app), `sideform-light-ui` (ui). Version 0.1.0 for both.
