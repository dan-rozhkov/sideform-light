# CLAUDE.md — sideform-light-ui

The frontend of Sideform Light: a small Vite + React 19 + Zustand + Tailwind v4 app that the Electron shell (`../app`) loads from `app://sideform` (packaged) or from the dev server (`SIDEFORM_LIGHT_UI_URL=http://localhost:5174`). It is the agent chat panel, the browse-run trace viewer and a small settings page. There is no canvas, no documents, no workflows, no accounts, no showcase. The integration contract (origin, CSP, `penAgentPanel` shape, backend endpoints, `clientCapabilities`) is `../CONTRACT.md`; read it before changing anything that crosses the shell or backend boundary.

## Routes (`src/AppRouter.tsx`, `BrowserRouter` with basename `/`)

| Path | Page | Shell preload |
|---|---|---|
| `/agent` | `routes/AgentPage.tsx` renders `ChatPanelContent variant="standalone"` | `window.penAgentPanel` |
| `/trace/:id` | `routes/TracePage.tsx` (local traces only, `?step=N` deep link) | `window.penDesktop` |
| `/settings?section=appearance\|model\|browser\|mcp\|schedules` (Model: own OpenAI-compatible provider; Schedules: list + modal `ScheduleDialog`) | `routes/SettingsPage.tsx` | `window.penDesktop` |

Anything else redirects to `/agent`. Each page is its own lazy chunk.

## Commands

```bash
npm run dev      # Vite on :5174 (strict port)
npm run build    # tsc -b && vite build -> dist/
npm run lint     # ESLint, 0 errors expected
npm test         # Vitest + happy-dom (Node 26: NODE_OPTIONS=--no-experimental-webstorage)
```

## How the agent runs (split execution)

Tool schemas live on the backend (`pen-editor-backend`); tool execution happens here, in the panel. `hooks/useDesignChat.ts` sends the chat to `POST /api/chat` with `agentMode: "browser"`, `model`, `userId` (anonymous `pen.userId`) and `clientCapabilities` (`lib/chatTransport.ts`, exactly the contract object). Each tool call is dispatched through `lib/toolRegistry.ts`, which handles only `ask_user`, `schedule_*` (`schedule_create` waits for an in-chat confirmation card like `ask_user`; both are listed in `components/chat/waitingForPerson.ts`), `analyze_image`, `browse_*`, `qa_*` and `trace_*`. The browse handlers drive the shell's browser through `window.penAgentPanel.browser` (`lib/tools/browser/bridge.ts`); `browse_agent` runs a nested headless chat with `agentMode: "browse"` (`lib/tools/browser/browseAgent.ts`). Adding or removing a tool means changing the backend schema and this registry together.

## Rules that keep Light small

- Backend base URL: `lib/apiBase.ts`, default SAME ORIGIN (relative `/api/...`): on `app://sideform` the shell proxies `/api/*` to the bundled local backend, and the Vite dev server proxies `/api` to `VITE_DEV_BACKEND_URL` (default `http://localhost:3001`, `vite.config.ts`). `VITE_DESIGN_AGENT_BACKEND_URL` / `VITE_AI_API_URL` force an absolute base for a ui served OUTSIDE the app only (Vite dev, a browser): the bundled `app://` CSP is `'self'` only (plus data:/blob:), so an absolute base is blocked there. Every request goes through `apiFetch` with `credentials: "omit"`.
- Only these endpoints: `POST /api/chat`, `GET /api/models`, `POST /api/byok/models`, `POST /api/browse/{step,plan,locate,judge}`. No auth, uploads, memory, user skills, Mobbin, cloud browser, cloud traces or analytics.
- Own provider (BYOK): `lib/byokProvider.ts` keeps base URL, key and model list in localStorage `pen.byok.v1` (synced across the agent panel and Settings by `storage` events). This is the ONLY provider: the local backend has no model (`GET /api/models` answers `models: []`, `default: null`), so nothing is ever preselected. Models appear as `byok/<id>` (`lib/chatModels.ts`, usable only while URL + key are set; `reconcileModels` resets an unusable selection to the first `byok/` model, or `""`). With no usable model the composer shows the provider-required state (`components/chat/ProviderRequiredNotice.tsx`, "Add a model provider to start" + "Open Settings" -> `openSettings("model")`), and `ChatInput` blocks sending (`sendBlocked`, Enter included). A 400 `provider_required` / `byok_key_required` and a `local_backend_unavailable` (502) become readable chat errors, keyed on the JSON code not the status (`lib/chatErrors.ts`). Sending is never gated on `navigator.onLine`: the backend is local and the provider may be too (Ollama, LM Studio); a real network failure to a remote provider is the normal chat error. `hasUsableModel()` and `getDefaultModel()` share one rule (`canUseModel`; default = first usable, `byok/` preferred). Presets include local Ollama and LM Studio; the backend still requires a non-empty key, so Settings hints "any value, e.g. ollama" for them. `X-BYOK-Base-URL` / `X-BYOK-Key` ride as headers only on a `byok/` turn (`lib/chatTransport.ts`, never in the body); `browse_agent`'s nested chat sends the parent's `model` only when it is `byok/…`. "Load models" calls `POST /api/byok/models` through `apiFetch`.
- `lib/auth/authState.ts` is a stub: `getRequestUserId()` returns the anonymous id.
- Types of the shell bridges: `lib/agentPanel.ts` (`penAgentPanel`, version 3) and `lib/desktopBridge.ts` (`penDesktop`: traces, settings, browserSettings). Keep them equal to CONTRACT.md.
- Never LOAD anything from the network in `index.html` or the bundle assets (no remote scripts, styles, fonts or images): the page is served from the local origin only. Plain data strings that are not fetched by the page, such as the BYOK provider presets' base URLs, are allowed.
- Imports use the `@/` alias for `src/`. TypeScript is strict with `noUnusedLocals`.
