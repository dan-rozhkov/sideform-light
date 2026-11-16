# Sideform Light

Sideform Light is a small Electron app: an AI agent chat on the left, a built-in browser on the right.
Ask the agent to open a site, read it, test it or sign in with a saved login; it drives real browser tabs,
several isolated sessions in parallel if needed. It is a browser-only cut of Sideform Desktop: no canvas,
documents, workflows, accounts or desktop-app control.

- `app/` — this Electron shell. `npm start` builds and runs it; `npm run dev` runs it against the ui dev server.
- `../ui/` — the agent panel, trace page and settings page (Vite + React). Its build (`ui/dist`) is bundled
  into the app and served from the privileged `app://sideform` scheme; nothing is loaded from the network.
- Backend: the app bundles and runs the `pen-editor-backend` local build as a child process
  (`dist/backend/server.mjs`); the ui calls `/api/*` on its own origin and the shell proxies it. Build the bundle
  in the backend (`npm run build:local`) and pass its `dist-local` dir as `SIDEFORM_LIGHT_BACKEND_BUNDLE`.
  For development set `SIDEFORM_LIGHT_BACKEND_URL=http://localhost:3001` (backend `npm run dev:local`): the shell
  then forwards `/api/*` there and starts no backend. `SIDEFORM_LIGHT_SKIP_BACKEND=1` builds without a bundle.

```bash
npm ci
(cd ../ui && npm ci && npm run build)   # the app bundles ../ui/dist
npm start                               # build + launch
npm test                                # unit tests
npm run test:e2e                        # Playwright against a stub ui
npm run dist                            # macOS dmg + zip (unsigned, ad-hoc signature)
npm run dist:win                        # Windows nsis installer (built on CI, see ../.github/workflows)
```

Your data (saved logins, history, chats, traces, settings) lives in the `Sideform Light` user data folder and
is never shared with Sideform Desktop. See `CLAUDE.md` for the architecture and `../CONTRACT.md` for the
integration contract.
