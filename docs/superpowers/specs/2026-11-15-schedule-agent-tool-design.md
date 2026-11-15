# Agent tool: create a schedule from the chat — design

Date: 2026-11-15. Status: decided in autopilot (`/auto`); calls below are the builder's, open to correction.
Builds on `2026-11-15-scheduled-chats-design.md`.

## Intent

The person says in the chat "check these prices every weekday at 9 and tell me what changed", and the agent
sets that up itself instead of sending the person to Settings. The person still decides: a schedule is a
recurring automation that drives their browser with their saved logins, so it is created only after the
person confirms it in the chat.

## Goals

- `schedule_create`: the agent proposes a schedule (name, self-contained task, cron); the chat shows a
  confirmation card; on "Create schedule" the shell stores it (enabled) and the agent gets the result.
- `schedule_list`: the agent sees existing schedules (to avoid duplicates, to answer "what is scheduled?").

## Non-goals (v1)

- Editing, pausing or deleting schedules from the chat (Settings > Schedules does that). One-off "remind me
  tomorrow" runs: schedules are recurring cron; the agent says so.

## Anti-goals

- No schedule without an explicit click by the person (a web page or a tool result must not be able to make
  the agent create one silently).
- A background chat (an MCP task or a scheduled run) never creates schedules: nobody is there to confirm, and
  a run must not spawn more runs. The tool answers an error there.
- pen-editor (the full Sideform editor) must not see these tools: they are NOT in `penTools`, so its
  cross-repo `toolContract` test stays green.

## Approaches considered

- **A. Client-executed tools offered only to Light, confirmation card in the panel (chosen).**
- B. Tools in `penTools` with pen-editor stubs. Rejected: pen-editor gets dead tools and a contract change.
- C. No confirmation, undo in Settings. Rejected: see anti-goals.

## Design

### Backend (pen-editor-backend)

- New module `src/ai/scheduleTools.ts` exporting `scheduleTools = { schedule_create, schedule_list }`
  (zod schemas, NO `execute`: client-executed). Not part of `penTools`.
- `clientCapabilities.schedules?: boolean` in the chat body schema. In `prepareChatTurn`, when
  `agentMode === "browser"` and `clientCapabilities.schedules === true`, the two tools are added to the turn
  and allowed by the browser-mode allowlist. Every other mode/client never gets them.
- `buildBrowserModePrompt({ isolated, schedules })`: with `schedules`, the Tools list names the two tools and
  a "## Schedules" section says: use `schedule_create` only when the person asks for a task that repeats or
  runs at set times; call `schedule_list` first and do not create a duplicate; write `prompt` as a complete
  task, because each run starts a new chat that does not see this conversation (sites, URLs, what to report,
  constraints); convert the time to a 5-field cron in the person's local time; the person confirms in the
  chat; after `declined` do not ask again in the same turn; schedules repeat (no one-off runs); changing,
  pausing or deleting is done in Settings > Schedules. Constant per client (prompt cache).

Schemas:

```ts
schedule_create: { name: string /* 1..100 */; prompt: string /* 1..20000 */; cron: string /* 1..100, 5 fields, local time */ }
// -> { status: "created"; schedule: ScheduleSummary } | { status: "declined" } | { status: "error"; error: string }
schedule_list: {}  // -> { schedules: ScheduleSummary[] } | { status: "error"; error: string }
interface ScheduleSummary { id: string; name: string; cron: string; description: string; enabled: boolean;
  nextRun?: string /* local, e.g. "Mon 16 Nov 2026, 09:00" */; lastRun?: { status: string; at: string } }
```

### Shell (sideform-light app)

`penAgentPanel.schedules = { list(), create({ name, prompt, cron }) }` over `schedules:panel-list` /
`schedules:panel-create` (invoke), accepted only from the agent panel's own webContents and page (the
`chats:*` sender rule), else `{ error: "Not allowed." }`. `create` validates like `schedules:save`, always
`enabled: true`, goes through the scheduler (so Settings tabs get `schedules:changed`). Results:
`{ schedules: ScheduleView[] }`, `{ schedule: ScheduleView }`, `{ error }`.

### Panel (sideform-light ui)

- `clientCapabilities.schedules: true` only when `window.penAgentPanel.schedules` exists.
- Handlers in `toolRegistry`: `schedule_list` → bridge list → summaries. `schedule_create`: in a background
  chat (`source` `mcp` or `schedule`) → `{ status: "error", error: "Schedules can be created only in a chat
  with the person." }`; otherwise the tool call stays pending and the message list shows a confirmation card
  (like `ask_user`): name, frequency in words (`describeCron`), the task text (collapsed after a few lines),
  "Create schedule" / "Cancel". Create → bridge create → `created` (or `error` with main's message, e.g. an
  invalid cron, so the model can fix it); Cancel → `declined`. After the result the card shows the outcome
  ("Schedule created · next run …" with "Open Schedules", or "Not created").
- A pending confirmation counts as "needs the person" for the MCP task status only if it can happen there,
  which it cannot (background chats are refused), so no change to `computeTaskStatus`.

## Addendum (2026-11-15): pause, resume and delete from the chat

The person can also say "pause the price check" / "turn it back on" / "delete the morning digest".

- Backend: two more client-executed tools in `scheduleTools` (same gate: browser mode + `clientCapabilities.schedules`):
  - `schedule_set_enabled { id: string /* ^[A-Za-z0-9_-]{1,128}$ */, enabled: boolean }` — pause (`false`) or resume (`true`).
  - `schedule_delete { id: string }`.
  - Results: `{ status: "updated", schedule: ScheduleSummary }` / `{ status: "deleted", id }` / `{ status: "declined" }` / `{ status: "error", error }`.
  - The `id` comes from `schedule_list`; the prompt says to call `schedule_list` first and never guess an id. The prompt's "## Schedules" section now says that editing name, task or time is done in Settings > Schedules; pause, resume and delete can be done with the tools.
- Every tool that changes schedules waits for the person (one rule, no exceptions): the same confirmation card, with a title per action ("Pause this schedule?", "Resume this schedule?", "Delete this schedule?"), the schedule's name, frequency and task, and the buttons "Pause" / "Resume" / "Delete" (destructive style) + "Cancel". Pausing an already paused schedule (or resuming an active one) answers `{ status: "updated" }` at once without a card. An unknown id answers `{ status: "error", error: "Unknown schedule id. Call schedule_list." }` at once without a card. In a background chat it answers "Schedules can be changed only in a chat with the person." The `onToolCall` precheck alone decides whether a card is needed and records the looked-up schedule (name, cron, task, enabled) in memory, keyed by tool call id; the card is drawn only while that record exists and never resolves the call itself (no lookup on mount, no auto-resolve). The outcome line for an error shows "Schedule not changed" and, only for main's own reply, its reason.
- Shell: `penAgentPanel.schedules.setEnabled(id, enabled)` and `.remove(id)` over `schedules:panel-set-enabled` / `schedules:panel-remove` (panel sender only, like `schedules:panel-*`), going through the scheduler so Settings tabs get `schedules:changed`. Results `{ schedule: ScheduleView }` / `{ ok: true }` / `{ error }`.
