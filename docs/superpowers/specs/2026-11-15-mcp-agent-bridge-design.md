# MCP agent bridge — design

Date: 2026-11-15. Status: draft for approval.

## Intent

An external agent (Hermes Agent, Claude Code, Codex, any MCP client on the same machine) gives a task in
plain words to the RUNNING Sideform Light app, follows its progress and collects the result. The Sideform
agent does all the work itself, with its own browser and tools (isolated sessions, saved logins, QA
assertions, traces). The external agent never drives the browser directly: it is a task giver, not a remote
control.

## Goals

- An MCP endpoint served by the running app that lets a client start a task, see its status, answer the
  agent's questions, stop it, and read the result.
- A task is an ordinary chat of the agent panel: it shows in the chat list, the person can open it, watch it
  work and step in (answer a question, stop, write a follow-up).
- Several tasks can run at the same time (the panel already runs several chats at once).
- A static client config works across app restarts (stable URL and token).

## Non-goals (v1)

- Direct browser tools over MCP (the old Desktop `browse_*` bridge). Not coming back in this change.
- Remote access from another machine, accounts, the cloud backend relaying tasks.
- Choosing a model per task, attaching images to a task, streaming partial tokens.
- A stdio transport or a bundled proxy binary.

## Anti-goals

- The bridge must not become a way to read secrets: no saved passwords, cookies or checkpoint data in any
  MCP result. The result is what the chat shows the person.
- A task must not hijack the panel: it never takes focus or switches the active chat.
- The app must not listen on the network by default.

## Approaches considered

- **A. MCP server in Electron main, tasks are panel chats (chosen).** Main serves MCP on loopback; a tool
  call goes over IPC to the agent panel, which uses the existing multi-chat machinery
  (`chatStore.createChat({activate:false})`, `queueLaunchPayload`, `isBusy`/`needsAnswer`, session
  `getMessages`). One agent implementation, tasks visible and steerable.
- B. Run the agent loop in main without the panel. Rejected: duplicates the chat loop, tool execution and
  `ask_user` outside React; tasks invisible.
- C. Remote MCP on pen-editor-backend relaying to the app. Rejected for v1: needs accounts and a live link the
  Light app does not have. Can be layered on A later.

## Design

### Transport and security (app/src/main/mcp/)

Restore and adapt the hand-rolled server cut in `a584548` (`httpServer.ts`, `jsonRpc.ts`, `auth.ts`, parts
of `handshake.ts`; read them with `git show a584548^:app/src/main/mcp/<file>`). It speaks MCP over HTTP POST
with a plain `application/json` answer (valid Streamable HTTP; `GET` answers 405), which current MCP clients
accept. Keep every defence it had: bind `127.0.0.1` only, loopback remote-address check, constant-time
`Authorization: Bearer <token>`, Host pinning (`127.0.0.1:<port>` / `localhost:<port>`), reject any request
with an `Origin` header, 1 MB body cap, post-listen errors never crash main. Path `/mcp`.
Server name `sideform-light`.

- **Port:** fixed default `47821`. Busy port → the server does not start and the status says so (no random
  fallback: a static client config would silently break).
- **Token:** 64 hex chars, generated once, kept in `<userData>/mcp-bridge.json` (mode 0600) with the
  on/off flag. "Regenerate token" in Settings replaces it.
- **Handshake file:** `~/.sideform-light/mcp.json` `{ url, token, port }` (dir 0700, file 0600, atomic write,
  removed on quit only if it still holds our token), so a client can discover it. Never `~/.pen-editor/`
  (Sideform Desktop owns that file).
- **Off by default.** Enabled from Settings. Turning it off stops the server and removes the handshake file.
- One app-level service created in `index.ts`, Electron-free and unit-tested like the old `service.ts`.

### MCP tools

All take/return JSON. A task id is the chat id.

| Tool | Input | What it does |
|---|---|---|
| `start_task` | `prompt: string` (1..20000 chars), `title?: string` | Creates a background chat, sends `prompt` as the first user message, returns `{ taskId, status }` at once. Refused with an error when 3 MCP-started tasks are already running (busy or waiting for an answer). |
| `get_task` | `taskId`, `waitSeconds?: number` (0..55, default 0) | Returns the task state. With `waitSeconds` it holds the call until the status leaves `running` or the time is up. |
| `answer_question` | `taskId`, `answers` | Answers the pending `ask_user` of the task; the agent continues. Error if no question is pending. |
| `send_message` | `taskId`, `text` | A follow-up message to a finished or stopped task (same as the person typing in the chat). Error while it is running. |
| `stop_task` | `taskId` | Same as the Stop button. |
| `list_tasks` | `limit?` (default 20) | Tasks started over MCP in this app, newest first: `{ taskId, title, status, updatedAt }`. |

Task state returned by `get_task`:

```json
{
  "taskId": "…", "title": "…",
  "status": "running | needs_answer | done | stopped | error",
  "question": { "questions": [ /* the ask_user questions as the form shows them: id, text, type, options, required */ ] },
  "result": "final assistant text of the last turn (markdown), when done",
  "error": "error text, when error",
  "traces": [ { "traceId": "…", "title": "…", "status": "…" } ],
  "updatedAt": 0
}
```

- `answers` format = what `AskUserForm` submits: `[{ id, value: string | string[], note? }]` per question;
  serialised with the existing `serializeAnswers` and applied with the session's `addToolOutput`, so the
  agent cannot tell an MCP answer from a typed one. The person can still answer in the panel; first answer
  wins, the other gets an error.
- `traces` = the browse runs of this chat that saved a local trace (ids the chat already knows). The person
  opens them in the app; the trace content itself is not sent over MCP in v1.
- Tool descriptions say what the agent can do (open sites, sign in with saved logins, test, several
  isolated browser sessions) and that it may ask questions, so the client knows to poll with `waitSeconds`
  and answer.

### Main ↔ panel

- New IPC, main → panel request / panel → main reply, one channel pair (e.g. `mcp:task-request` with a
  request id, `mcp:task-reply`). Main accepts replies only from the panel's own webContents and page (same
  checks as `chats:*`). The preload adds `penAgentPanel.mcp.onRequest(handler)`; version stays additive.
- Main routes to the panel of the most recently focused window. No window or panel not loaded → error
  "Sideform Light has no open window" (no on-demand window in v1).
- In the panel, a small module (e.g. `lib/mcpTasks.ts` + a hook mounted once in `ChatPanel`) maps the
  requests onto `chatStore` and the session actions:
  - start: `createChat({ activate: false })`, set title if given, `queueLaunchPayload(id, { text })`, mark it
    as an MCP task (`ChatSummary.source = "mcp"`, persisted with the chat). The chat list shows a small
    marker for MCP tasks and the new chat is unread; the active chat never changes.
  - status: derived from `isBusy`, `needsAnswer`, the last turn's error state, a stop, and `getMessages()`.
  - answer / message / stop: through actions each mounted `ChatSession` publishes (extend
    `ChatSessionActions` with `answerAskUser`, `sendText`, `stop`).
- A waiting `get_task` is resolved in main by re-asking the panel on each activity change pushed by the
  panel (`mcp:task-changed`), not by tight polling.

### Settings

New Settings section `mcp` ("MCP"), next to `appearance` and `browser` (update `SETTINGS_SECTIONS`,
`CONTRACT.md`, the IPC contract test). It shows: on/off switch, status (off / listening on URL / error
text),
the URL, the token (hidden, copy button), "Regenerate token", and ready-to-copy client snippets for Hermes
Agent (`mcp_servers` YAML with `url` and `headers`) and Claude Code (`claude mcp add --transport http …`).
A short note: tasks run with everything the Sideform agent can do, including saved logins.
Read and written by the Settings page only, through new `penDesktop.mcp` calls, with the same sender checks
as `browser-settings:*`.

### Errors and edge cases

- Unknown or non-MCP `taskId` → error. Chats the person started themselves are not reachable over MCP
  (`list_tasks`/`get_task` see only `source = "mcp"` chats).
- The person deletes the task's chat → `get_task` answers error "task was deleted".
- Panel reload: chats are restored from disk; the state of a task that was running is `stopped` (the turn is
  gone). Main never keeps its own copy of task state.
- App quit while tasks run: nothing special; they are stopped chats on the next start.

## Constraints

- Follow `app/CLAUDE.md` rules: pure modules with unit tests, `window.ts`/`index.ts` only wire; every new
  channel in `test/ipcContract.test.ts`; panel-only senders; no secrets in results or logs.
- No new runtime dependency unless the restored server cannot do it.
- Backend unchanged: `start_task` is a normal `/api/chat` turn in `agentMode: "browser"`.

## Tests

- Unit (app): server security checks (restored tests), token/handshake store, tool input validation,
  request routing to the panel, wait logic with fake timers.
- Unit (ui): the task module against a fake store/session (start, status mapping, answer, stop, filter of
  non-MCP chats).
- e2e (app): with the stub ui answering `mcp:task-request`, a real HTTP MCP client call goes through
  `initialize`, `tools/list`, `start_task`, `get_task` (and the auth/Host/Origin rejections).

## Left to the builder

- File and symbol names, the exact IPC payload shapes, the exact tool description wording.
- How to read the last assistant text and the trace ids from `UIMessage` parts.
- The Settings page layout within the existing settings style.

## Decisions after the builder check (the author's calls, made autonomously)

1. **One window.** The app holds a single-instance lock and has no "New Window"; a second window only
   appears after the first closed (macOS `activate`). Main routes MCP requests to the ONE live panel that
   registered the bridge handler (the last one to register wins; on its `destroyed` the bridge has no
   panel). No panel → error `Sideform Light has no open window`. Tasks of a closed window are gone (their
   chats are restored as `stopped`).
2. **Status rule** (computed in the panel, pure function over the chat summary + messages + a per-panel
   "stopped by Stop" set + the session error):
   - `needs_answer`: a pending `ask_user` (`hasPendingAskUser`);
   - `running`: `isBusy`, OR the last assistant message still has unresolved tool calls and the chat was not
     stopped in this panel lifetime and the panel was not reloaded since (a just-started chat whose launch
     payload is still queued is `running` too);
   - `error`: the session's last turn ended with an error (`error` of `useDesignChat`);
   - `done`: the last message is an assistant message with no unresolved tool calls;
   - `stopped`: everything else (Stop, a reload mid-turn, no assistant reply).
   `get_task` with `waitSeconds` returns early only when the status is not `running` in two reads 1 s apart
   (guards the short gap between auto-continuations).
3. **`source` is persisted** as an optional additive meta field `source?: "mcp"` (`app/src/main/chatStore.ts`
   `parseChatMeta`: absent or exactly `"mcp"`, anything else → invalid). Old chat files keep parsing.
4. **The cap** (3 tasks in `running` or `needs_answer`) is checked and the chat created in one synchronous
   step in the panel module, so concurrent `start_task` calls cannot both pass.
5. **Collapsed panel** keeps running (it is only hidden). No window → error as in 1.
6. **Offline:** `start_task` fails fast with an error when the panel is offline. Backend failures surface as
   status `error` with the error text.
7. **Model:** a task uses the model a new chat gets right now (the panel's current default), like the person
   clicking "New chat".

## IPC and API contract (fixed for both sides)

Panel preload (`app/src/preload/agentPanel.ts`, `window.penAgentPanel.mcp`, additive, `version` stays 3):

```ts
mcp: {
  // Registers THE handler (a second call replaces it). Returns an unsubscribe.
  onRequest(handler: (req: McpPanelRequest) => Promise<McpPanelReply>): () => void;
  // Tells main that a task's state may have changed (wakes waiting get_task calls).
  notifyChanged(taskId: string): void;
}
```

Channels: `mcp:panel-ready` (panel → main, sent by `onRequest` registration), `mcp:task-request`
(main → panel, `{ requestId: string, request: McpPanelRequest }`), `mcp:task-reply` (panel → main,
`{ requestId, reply }`), `mcp:task-changed` (panel → main, `{ taskId }`). Main accepts the three panel →
main channels only from the panel's own webContents and panel page (same check as `chats:*`). A request
with no reply within 15 s → error `Sideform Light did not answer`.

```ts
type McpPanelRequest =
  | { op: "start"; prompt: string; title?: string }
  | { op: "get"; taskId: string }
  | { op: "answer"; taskId: string; answers: { id: string; value: string | string[]; note?: string }[] }
  | { op: "message"; taskId: string; text: string }
  | { op: "stop"; taskId: string }
  | { op: "list"; limit: number };

type TaskStatus = "running" | "needs_answer" | "done" | "stopped" | "error";
interface TaskState {
  taskId: string; title: string; status: TaskStatus; updatedAt: number;
  question?: { questions: unknown[] };   // the pending ask_user input's questions, as the form shows them
  result?: string;                        // last assistant text, when done
  error?: string;                         // when error
  traces: { traceId: string; title?: string; status?: string }[];
}
type McpPanelReply =
  | { error: string }
  | { task: TaskState }                   // start (status running), get
  | { ok: true }                          // answer, message, stop
  | { tasks: Pick<TaskState, "taskId" | "title" | "status" | "updatedAt">[] };  // list
```

Main validates every MCP tool input BEFORE it reaches the panel (types, lengths: prompt 1..20000, title
≤ 200, text 1..20000, taskId `^[A-Za-z0-9_-]{1,128}$`, answers ≤ 50 entries, limit 1..100), and the
panel validates again.

Settings (`app/src/preload/tab.ts`, `window.penDesktop.mcp`, Settings page only, same sender check as
`browser-settings:*`), channels `mcp-settings:get`, `mcp-settings:set`, `mcp-settings:regenerate-token`:

```ts
interface McpSettingsView {
  enabled: boolean;
  port: number;
  url: string;          // http://127.0.0.1:<port>/mcp
  token: string;        // shown hidden by the page, copyable
  status: { state: "off" | "starting" | "listening" | "error"; error?: string };
}
mcp: { get(): Promise<McpSettingsView>; set(p: { enabled: boolean }): Promise<McpSettingsView | { error: string }>;
       regenerateToken(): Promise<McpSettingsView | { error: string }> }
```
Settings section id: `mcp`.
