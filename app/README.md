# Sideform Light

Sideform Light is a small Electron app: an AI agent chat on the left, a built-in browser on the right.
Ask the agent to open a site, read it, test it or sign in with a saved login; it drives real browser tabs,
several isolated sessions in parallel if needed. It is a browser-only cut of Sideform Desktop: no canvas,
documents, workflows, accounts or desktop-app control.

- `app/` — this Electron shell. `npm start` builds and runs it; `npm run dev` runs it against the ui dev server.
- `../ui/` — the agent panel, trace page and settings page (Vite + React). Its build (`ui/dist`) is bundled
  into the app and served from the privileged `app://sideform` scheme; nothing is loaded from the network.
- Backend: the agent talks to a `pen-editor-backend` (default `http://localhost:3001`, override with
  `SIDEFORM_LIGHT_BACKEND_URL` for the CSP and the ui build's `VITE_DESIGN_AGENT_BACKEND_URL`).

```bash
npm ci
(cd ../ui && npm ci && npm run build)   # the app bundles ../ui/dist
npm start                               # build + launch
npm test                                # unit tests
npm run test:e2e                        # Playwright against a stub ui
npm run dist                            # macOS dmg + zip (unsigned, ad-hoc signature)
npm run dist:win                        # Windows nsis installer (config only, untested)
```

Your data (saved logins, history, chats, traces, settings) lives in the `Sideform Light` user data folder and
is never shared with Sideform Desktop. See `CLAUDE.md` for the architecture and `../CONTRACT.md` for the
integration contract.
