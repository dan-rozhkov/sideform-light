# CLAUDE.md — sideform-light (app/)

Sideform Light is a browser-only cut of Sideform Desktop: ONE window with the agent chat on the left and
browser tabs on the right. The agent can drive several isolated browser sessions in parallel. There is no
canvas, no documents, no workflows, no showcase, no accounts or sign-in, no computer use (external desktop
apps) and no desktop `browse_*` MCP bridge (a small, off-by-default MCP *task* bridge exists: see "MCP agent bridge"). `app/` is the Electron shell; the sibling `../ui/` (Vite + React) is the
agent panel, the trace page and the settings page, bundled into the app. The integration contract between
`app/`, `ui/` and the backend is `../CONTRACT.md` — read it before changing the `app://` protocol, the
`penAgentPanel` / `penDesktop` shapes or the backend endpoints.

Imported from `pen-editor-desktop` 87a9d1c and cut down (see `git log`). The browser engine
(`BrowserController` wiring in `window.ts`, sessions, passwords, history, ad blocking, QA, journal) is
unchanged; the sections below that describe it were written for Desktop and are still true.

## Commands

```bash
npm run build     # tsc + scripts/copy-static.mjs → dist/ (copies ../ui/dist → dist/ui; fails if it is missing)
npm start         # build + launch Electron (the bundled ui)
npm run dev       # SIDEFORM_LIGHT_UI_URL=http://localhost:5174 against the ui's Vite dev server (skips bundling the ui)
npm test          # Vitest unit tests (test/)
npm run test:e2e  # build (SIDEFORM_LIGHT_SKIP_UI=1) + Playwright _electron specs against a stub ui (no ui/dist, no network)
npm run lint      # tsc --noEmit (src) + tsc -p tsconfig.e2e.json (e2e/ + configs + test/)
npm run dist      # electron-builder --mac → release/ (dmg + zip, ad-hoc "-" identity, unsigned)
npm run dist:win  # electron-builder --win → release/ (nsis). Config only: not built or tested on CI or on the Mac
```

`npm run dist` must run with a real `node_modules` directory, not a symlink. A symlinked `node_modules` with a stale hidden lockfile makes the electron-builder collector keep only the direct dependencies. The build still exits 0, and the app crashes at launch with `ERR_MODULE_NOT_FOUND`. The `afterPack` hook `scripts/verify-packaged-deps.cjs` fails a build with a symlinked `node_modules` or with a missing production package (macOS target only). To fix a worktree, run `rm node_modules`, then `npm ci`. Do not run `npm ci` through the symlink: it follows the link and erases the target.

**The ui is part of the build.** `scripts/copy-static.mjs` copies `../ui/dist` to `dist/ui` and exits 1 with a clear message when `../ui/dist/index.html` is missing. `SIDEFORM_LIGHT_SKIP_UI=1` is the explicit, loud opt-out for tests and for running against a ui dev server; it is never implied.

Versioning: `package.json` is `sideform-light` 0.1.0. There is no release automation (release-please and Renovate were dropped with the fork); bump by hand with `npm version`.

## Environment variables

| Variable | Meaning |
|---|---|
| `SIDEFORM_LIGHT_UI_URL` | Dev override: http(s) URL of the ui dev server. Only its origin is used; it replaces `app://sideform` for every page and every origin check. Also switches chats to `chats-dev/`. |
| `SIDEFORM_LIGHT_BACKEND_URL` | Backend origin for the CSP `connect-src` of the bundled ui (default `http://localhost:3001`). Must agree with the ui build's `VITE_DESIGN_AGENT_BACKEND_URL`. |
| `SIDEFORM_LIGHT_SKIP_UI` | `1`: `copy-static` does not bundle the ui (build-time only). |
| `SIDEFORM_LIGHT_USER_DATA_DIR` | Overrides `userData` (e2e; fresh dir per Playwright run). |
| `SIDEFORM_LIGHT_NO_ADBLOCK` | `1`: never load the ad-block engine (no network; e2e sets it). |
| `SIDEFORM_LIGHT_NO_ANIMATIONS` | `1`: no shell motion (panel slide, tab strip). |
| `SIDEFORM_LIGHT_BROWSER_CURSOR` | `off`/`0`/`false`: kill switch of the in-page agent cursor. |
| `SIDEFORM_LIGHT_BROWSER_CURSOR_MOTION` | Cursor motion override (see `cursorSettings.ts`). |
| `SIDEFORM_LIGHT_MCP_PORT` | Port of the MCP agent bridge (default 47821; whole number 1..65535, else the default). Tests/e2e use a free port. The bridge itself is switched on in Settings (`<userData>/mcp-bridge.json`). `~/.sideform-light/mcp.json` follows `$HOME` (e2e points `HOME` at a temp dir). |
| `SIDEFORM_LIGHT_LANGUAGE` | `en\|ru\|de\|it\|fr`: the initial interface language when `<userData>/ui-language.json` holds none (e2e pins `en`; else the system language is used). |
| `SIDEFORM_LIGHT_SESSION_SLOT_WAIT_MS` | How long an isolated-session command waits for a free partition slot (tests). |

The `PEN_DESKTOP_*` names of Sideform Desktop were renamed to `SIDEFORM_LIGHT_*` (a plain prefix swap; `PEN_DESKTOP_URL`, `PEN_DESKTOP_REGISTER_PROTOCOL` and the editor-URL logic are gone). Names inside tests and e2e helpers (`SIDEFORM_LIGHT_E2E_OWNED_USER_DATA_DIR`) follow the same prefix.

## Architecture

`src/main/window.ts` wires one `BaseWindow`: a tab-bar `WebContentsView` (local HTML, `src/tabbar/`) on top, the agent panel `WebContentsView` (the ui's `/agent`), an address-suggestion popover view, the empty-start view and one `WebContentsView` per tab. All logic lives in pure, unit-tested modules — `tabManager.ts` (tab lifecycle; Electron views injected as `TabViewHandle`), `menu.ts` (template), `navigation.ts` (origin clamp → `shell.openExternal`), `config.ts` (URL resolution and env flags), `localProtocol.ts` (the `app://` file decision, MIME, CSP), `windowTheme.ts`, `layout.ts`, `panelSenders.ts` / `chatFlush.ts` / `quitFlush.ts` (chat flush on close and quit). Keep `window.ts` and `index.ts` free of decisions; put logic in the pure modules and test it.

Tab kinds (`TabKind`): `browser` (the built-in browser), `trace` and `settings` (pages of the bundled ui, tab preload), `passwords` and `history` (local shell pages with their own preloads). Every view runs `contextIsolation: true, sandbox: true, nodeIntegration: false` (`secureWebPreferences`). The whole package compiles as CommonJS (sandboxed preloads can't be ESM) — no `.js` import-extension rule here. `src/tabbar/renderer.ts` must compile to a plain script (no `exports`/`require` in the output — it runs in a CSP'd `<script src>`).

## The `app://sideform` protocol

`src/main/index.ts` registers the scheme `app` as privileged BEFORE `app.ready` (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`; `APP_SCHEME_PRIVILEGES`) and, after ready, serves `dist/ui` with `session.defaultSession.protocol.handle("app", …)`. The decision is the pure `resolveAppRequest(url, distDir, isFile)` in `localProtocol.ts`:

- host must be exactly `sideform`, scheme `app:`; anything else → 404;
- the percent-decoded path (NUL, backslash, `..` out of the dist dir → 404) maps to an existing file inside the dist dir → that file with its MIME type (`mimeTypeFor`);
- any other path (no such file, a directory, the root) → `index.html` (SPA fallback) only if it is route-like (no file extension in the last segment, not under `/assets/`); a missing `.js`/`.css`/… or anything under `/assets/` → 404.

Every response carries `Content-Security-Policy` from `buildCsp(backendOrigin)` (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' data: blob: <backend origin>; frame-src 'none'; object-src 'none'; base-uri 'none'`) and `X-Content-Type-Options: nosniff`. `new URL("app://x").origin` is `"null"` in Node, so every origin check compares `protocol//host` (`originOf`, `isOnUiOrigin` in `config.ts`) against the ONE ui origin (`resolveUiOrigin`: `app://sideform`, or the origin of `SIDEFORM_LIGHT_UI_URL`).

| Page | URL | Preload | View |
|---|---|---|---|
| Agent panel | `<ui origin>/agent` | `preload/agentPanel` (`window.penAgentPanel`) | left island |
| Trace tab | `<ui origin>/trace/<id>?src=local` | `preload/tab` (`window.penDesktop`) | tab |
| Settings tab | `<ui origin>/settings?section=<appearance\|browser>` | `preload/tab` | tab (singleton) |

The shell's own HTML (tab bar, empty start, passwords, history, omnibox) stays on `file://` (`attachLocalOnlyPolicy`). All ui pages use the DEFAULT session, whose permission handler denies everything except `clipboard-sanitized-write` (`restrictPermissions`, `UI_ALLOWED_PERMISSIONS`). The backend must allow the CORS origin `app://sideform` for the ui's `fetch` calls (the shell does not proxy them).

## Preload APIs

`window.penAgentPanel` (`preload/agentPanel.ts`) is `{ version: 3, browser, chats, traces, settings, mcp, schedules }` (`schedules` = `{ list, create }` for the agent tools `schedule_list` / `schedule_create`):
`browser` = `open, act, findImages, snapshot, perform, assert, read, screenshot, tabs, applyFixture, releaseFixture, clearActEmulation, fillLogin, startJournal, stopJournal, captureCheckpoint, requests, capture (trace DOM snapshots only), isolated(sessionId), closeSession(sessionId), revealAgentTab(sessionId?)`; `chats` = `list, read, save, remove`; `traces` = `save, open, listTabs, read`; `settings` = `open(section?)`; `mcp` = `onRequest(handler)`, `notifyChanged(taskId)` (the MCP agent bridge, below). Removed from the Desktop shape: `launchApp`, `releaseApp`, `nativeApps`, `forChat`.

`window.penDesktop` (`preload/tab.ts`, trace and settings pages only) is `{ traces: { read }, browserSettings: { get, set }, mcp: { get, set, regenerateToken }, settings: { open, onSection } }`, plus invisible theme and language reporters (`tab:theme`, `tab:language`). No browser bridge, no storage.

`test/preloadTab.test.ts`, `test/preloadBrowserBridge.test.ts` and `test/ipcContract.test.ts` pin both shapes.

## Window layout, panel and theme

The window is the agent layout: a chat panel on the left, tabs on the right, glass + islands. There is no other layout and the window starts with ZERO tabs. The main window has a left panel, a separate `WebContentsView` loading the ui's `/agent` page (`resolveAgentPanelUrl(uiOrigin)`).

Geometry is the pure `src/main/layout.ts` (`computeWindowLayout`, always in islands mode).
The tab bar view spans the FULL window width, so the traffic lights stay where they are. The panel
sits BELOW the tab bar on the left; tab views get `tabArea`, to the right of the panel.
`TabManager.layout(rect)` just applies that rect; it computes nothing. Panel width is a
parameter (`clampAgentPanelWidth`: min 300, max 50% of the window; default 380); drag-resize
is not built; collapse is the sidebar toggle below.

Inside the tab bar the strip starts at the panel's right edge: `window.ts`
adds `tabStripLeft` to the existing `tabbar:state` snapshot (during the panel slide a per-frame `tabbar:strip-left` also carries it);
`renderer.ts` writes it to the CSS var `--tab-strip-left`; the tab row's left
padding is `max(--controls-end, --tab-strip-left)`, where `--controls-end` is the sidebar toggle's right edge (after the macOS traffic lights); the address
row margin uses `--tab-strip-left`. The row stays a window drag region, so the part of
the bar above the panel is an empty draggable title area. Popup anchors (new
tab, browser tools) are tab-bar CSS px = window coords (tab bar at x=0): no
offset.

**Glass + islands.** `computeWindowLayout` gets
`islands: { gap: ISLAND_GAP (8), radius: ISLAND_RADIUS (12) }` (`layout.ts`, unit-tested):
the tab bar full width at the top (it
also holds the traffic lights); below it two rounded islands, the panel at `x = gap`, then
`gap`, then the tab area (active tab view + empty-state view), then `gap` to the right
edge and `gap` to the bottom edge. The panel island starts at the tab ROW height (38,
`tabRowHeight`) whatever the address row does; only the tab area starts below the address
row. Default 1440x900: panel `{x:8, y:38, w:380}`, tab area `{x:396, w:1036}` (y 38, or 79
with an address row). `tabStripLeft` = the tab area's left edge. Radius: `ISLAND_RADIUS`
(12) is set ONCE per view with `WebContentsView.setBorderRadius` (Electron 43) at creation
(panel, empty view, every tab view); `layout()` only places views. There is no window rim
view and no 1px edge (`WINDOW_EDGE` and `WindowLayout.rim` are gone).

*Glass.* macOS `vibrancy: "under-window"` + `visualEffectState: "active"` on the BaseWindow;
the tab bar view is `#00000000` and `tabbar.css` makes body/rows
transparent. Non-macOS: no vibrancy, `win.setBackgroundColor(GLASS_SOLID[theme])`. `tabbar.css` has plain selectors (one layout): a transparent body, tabs on the glass, the address row as the island top.

*Controls (match the ui ghost IconButton).* Nav buttons and the URL field (the island row) share tokens in `tokens.css`: the radius scale `--radius-control-xs|sm|(base)|lg|xl` = 6/8/9/10/12px by control height (20/24/28/32/36-40px; the ui's `rounded-control*`), `--btn-hover` = the ui `--secondary` in light and `--color-surface-hover` (#4a4a4a) in dark, disabled opacity 0.5. **Icon colors** (`--icon` / `--icon-subtle`, the glyph counterparts of `--text-active` / `--glass-text`): in light they are the menu icon gray `oklch(0.52 0 0)` (opaque / alpha 0.8, so idle icons on the glass keep about 3:1 contrast); in dark they equal `--text-active` / `--glass-text`. Nav buttons, the sidebar toggle, "+", the tab glyph and the close "x" use them, and so do History (the remove "x" on hover; idle it stays `--muted`) and Passwords (buttons, rows; Passwords has its own token block, not `tokens.css`, so it carries `--icon` / `--icon-secondary` copies, the light value pinned to `tokens.css` by `test/windowTheme.test.ts`); titles and the URL field keep the text tokens. The sidebar toggle and "+" sit on the glass like the tabs, so they keep `--glass-tab-hover`; like the nav buttons they use `--radius-control` (9px), the tabs keep 8px. Focus ring everywhere (tabs, close "x", "+", nav buttons, URL field, sidebar toggle, empty-start card): `outline: none; box-shadow: 0 0 0 2px var(--focus-ring)`, where `--focus-ring` = the ui `--ring` = the accent `#0d99ff` in both themes (a grey ring failed the 3:1 contrast rule). Header icons are pen-set icons (SidebarSimple, Plus, ArrowLeft, ArrowRight, ArrowClockwise), built at startup by `renderer.ts` from `glyphs.ts` into the empty `<button>`s of `tabbar.html`; the Browser tools "⋮" is the BOLD DotsThreeVertical, as in the ui (`tabbar.css` enlarges the dots: `[data-pen-icon^="Dots"][data-weight="bold"] circle { r: 1.35px }`). All 16px inline SVGs. Tooltips stay native `title` and the menus stay native (an HTML popup would be clipped to the tab bar view's height).

*Font.* The tab bar and the empty start use the system UI font, like the ui (its body is `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`; on macOS both are SF). No font file is bundled. Sizes: tab labels 12px, URL field 14px, empty start 13px.

*Colours: one place each.* TS: `windowTheme.ts` (`ISLAND_BG` light `#ffffff` / dark
`#2a2a2a` = the ui's `--color-surface-panel`, `GLASS_SOLID`, `contentBackground`,
`FALLBACK_THEME`, `glassTint`). CSS: `tokens.css` (`--island-bg`, same values, pinned equal by
`test/windowTheme.test.ts`). Islands (panel, tab views,
empty view, address row) use the island colour, so in dark the chat and the tab island match.
The active
tab pill keeps its own translucent `--glass-tab-active` (unchanged).

*Address row.* Painted in the island colour as the top of the tab island: inset to the tab
area's x-range, rounded top corners, and it mirrors the agent chat header row of the ui
(pen-editor `ChatPanel` `OpenChatHeader`: `px-2 py-1.5 gap-1 border-b border-border-default`, 28px
icon buttons, title `text-sm text-text-primary` (regular weight)): height `ADDRESS_ROW_HEIGHT` = 41
(28 + 2*6 + 1px border; `layout.ts`, sent as `addressRowHeight` -> CSS `--address-row-height`),
padding 0 8px, gap 4px, `border-bottom: 1px solid var(--border)` (#e0e0e0 / #404040), URL text 14px/400, left-aligned right after the reload button (a normal flex item, `flex: 1`; the Browser tools button sits at the far end), in a field shaped like the nav buttons (28px high, `--radius-control`, `--btn-hover` fill on hover/focus)
in `--text-active`. Panel header and address row both start at the tab row height (38), so their
bottom borders share one line (y = 78). Gap and radius are NOT hardcoded in CSS: `layout.ts`
returns them (`gap`, `radius`), `window.ts` sends them on `tabbar:state` (`islandGap`,
`islandRadius`) and `renderer.ts` writes `--island-gap` / `--island-radius` (pinned by
`layout.test.ts`). The tab VIEW starts exactly below the row (`tabArea`): no page content is
hidden. A parent View's radius does not clip child WebContentsViews in Electron 43, so browser pages keep all-corner rounding; the page's rounded top corners show small wedges against the tail (which starts 1px below the row, `top: calc(100% + 1px)`, so it does not cover the border). The tail is painted in the ACTIVE browser page's own background, not `--island-bg` (dark wedges on a white page in dark theme): main runs a sampling script in the page after `dom-ready`/`did-finish-load`/`did-navigate-in-page` (NOT `did-navigate`: the new document is still empty and would flash white; the old colour is kept until dom-ready). The script reads `getComputedStyle` of `<html>`/`<body>` and converts the colour through a 1x1 canvas, because Chromium returns oklch()/lab()/color() in their authored space; both transparent -> Chromium's canvas (`rgb(18,18,18)` when `color-scheme` (CSS, else the `<meta name="color-scheme">` tag) is dark under a dark OS appearance, else white); failure -> `#ffffff` (`pageBackground.ts`) and sends it on `tabbar:tail`; the renderer sets `--tail-bg`. Blank and canvas tabs send null -> `--island-bg`.

*Theme and tint.* The app/OS appearance is NEVER changed (it is
app-wide and would flip `prefers-color-scheme` for browser tabs, isolated sessions and QA
runs). The vibrancy follows the OS; a plain `View` (`glassTintView`, bottom-most, macOS only,
no page/IPC) paints `glassTint(theme, osDark)` over it: `rgba(244,245,248,a)` light /
`rgba(28,28,30,a)` dark, `a = 0.35` when the theme matches the OS appearance and `0.85`
when it differs; re-applied on each `pushState` and on `nativeTheme` `updated`. The ui
ignores the OS (stored `ui-theme`, default light): fallback "light" (`FALLBACK_THEME`). The panel page paints its
theme as the class `dark` on `<html>`; its preload (`preload/agentPanel.ts`) reads it on
DOMContentLoaded and observes the class with a MutationObserver, sending `panel:theme`
("light" | "dark") on change (no polling). Main (`onPanelTheme`) accepts it only from the panel's
own webContents AND its own page (`isPanelDocument` on the sender frame), and the window chrome follows it (`resolveWindowTheme(panelTheme, FALLBACK_THEME)`): the panel's theme always wins. Trace and Settings pages share the panel's storage, so they paint the same theme; each reports its own (`tab:theme`, tab preload) only to colour its own view background. Vibrancy material stays `under-window` (`sidebar` renders
identically; `menu` ~3 levels darker; `header` near opaque); `screencapture -l` does not include
the blurred wallpaper, so that effect needs a real-screen check.

**Sidebar toggle.** A button right after the traffic lights (before the tab
strip) hides/shows the agent panel; also View > "Show/Hide Agent Panel" with
`CmdOrCtrl+Alt+B`.
State: `panelCollapsed` in `window.ts`, persisted in `agent-panel-settings.json` in userData
(`agentPanelSettings.ts`, like cursor-settings.json). Geometry: `agentPanelWidthFor(collapsed)`
-> 0; `computeWindowLayout` with `panelWidth: 0` in islands mode gives `panelVisible: false`,
`tabArea.x = gap` (left gap 8) and the panel view is `setVisible(false)` (hidden, not
destroyed: the chat keeps running and keeps its state). The strip then starts right after the
button (CSS `--controls-end`). `pushState` computes the layout BEFORE it builds the snapshot, so
`tabStripLeft` (and the island numbers) the tab bar gets always match what is applied; a resize
that moves the offset re-pushes (e2e checks the row padding / address row margin after toggling).
The toggle is animated (240ms, easeOutCubic). `src/main/panelAnimation.ts` is pure and tested: the
motion decision (`shellMotionEnabled(env SIDEFORM_LIGHT_NO_ANIMATIONS, reducedMotion)`), the maths
(`panelAnimationFrame`) and the state machine (`createPanelAnimator`: start / retarget from the CURRENT
progress / stop / `tick(now)` -> frame or done). `window.ts` only owns the `setInterval`
(`startPanelAnimation`) and applies the results. The panel keeps its full width and slides off to the left
while the tab area's left edge interpolates (right edge fixed); the panel is `setVisible(false)` only when
the collapse finishes (a frame's own `panelVisible`), and made visible at the start of an expand. The
expanded and collapsed layouts are computed ONCE per animation (again only if the active tab's kind
changes mid-flight), and each frame moves only the ACTIVE tab view (`TabManager.layoutActive`); one full
`tabs.layout` (all views) plus one `pushState` run when the slide finishes. `applyLayout` applies the
interpolated frame while the animator runs, so a mid-flight `pushState` never snaps it; a second toggle
retargets from the current progress; a window `resize` finishes it at once. ONE clock for views and strip:
on every frame main also sends the interpolated tab-area x over `tabbar:strip-left` and the renderer writes
`--tab-strip-left` from it (there are no CSS transitions on the strip padding / margin); a `tabbar:state`
push mid-slide carries the current interpolated `tabStripLeft`, the final value comes with the push at the
end. Opt-outs: OS reduced motion (`systemPreferences.getAnimationSettings().prefersReducedMotion`) and env
`SIDEFORM_LIGHT_NO_ANIMATIONS=1` both give the instant jump AND turn off the tab strip motion: `tabbar:state`
carries `motion: boolean` (the same decision) and `renderer.ts` skips its tab enter/exit/progress animations
when it is false. e2e polls until bounds settle (and polls the panel's visibility together with the bounds:
the last frames already round to the final x). Focus never goes to the hidden panel: `emptyView.ts` `resolveFocusTarget` sends it to the
placeholder or the active tab, and collapsing while the panel has focus hands it over
(`focusAfterCollapse`). IPC: `tabbar:toggle-panel` tabbar->main (sender-checked,
`fromOurTabbar`), state back on `tabbar:state` as `panelCollapsed`; the menu action
`toggleAgentPanel` is a local action. A tab opened by the agent never auto-expands a collapsed panel: only the user's toggle changes it.
Tests: `layout.test.ts`, `agentPanelSettings.test.ts`, `menu.test.ts`, `e2e/agent-panel-toggle.spec.ts`.

**Tab icons.** Every tab has a leading glyph keyed by `TabState.kind` in
`tabbar/renderer.ts` (one mapping of tab kind to pen icon name): trace "FilmStrip", Settings "Gear", Passwords "Key", History "ClockCounterClockwise", browser tabs
"Globe" ALWAYS, never the site favicon. **Icon set.** Every icon in the shell (tab bar, header buttons, address suggestions, History, Passwords) is a copy of the pen icon set (`src/tabbar/glyphs.ts`; the file still carries a few glyphs no page uses): 16x16 grid, outline strokes, `stroke-width` 1.25 kept at screen width by `vector-effect: non-scaling-stroke`, round caps and joins, `fill: none` (1.5 stroke at 22px and up: the Passwords hero tile and empty glyph set it in CSS). The one source is `src/tabbar/glyphs.ts`: strict-JSON `PEN_GLYPHS` (outline) and `PEN_GLYPHS_FILL` (the solid Globe, fixed mask id `pen-fill-mask-Globe`) mapping icon name to element trees, plus `penIcon(name, cls, weight)` (createElementNS, root attributes as the ui's `createIcon`) and `penMountSlots()` (swaps static `<span data-pen-slot="Name">` placeholders for the svg: History and Passwords use it, they have no sprite). Pages that draw icons load `glyphs.js` first (`../tabbar/glyphs.js` from history/passwords) and carry `[data-pen-icon] * { vector-effect: non-scaling-stroke }` in their CSS. Never hand-draw a glyph or add a path here: copy the markup of the pen icon (the ui carries the same set). The agent cursor arrow (`agentCursorIcon`) is an illustration, not an icon, and stays hand-drawn. The notices file `THIRD_PARTY_NOTICES.md` has no entries now. Just the glyph,
monochrome `currentColor`, no background square; the tab sets that color from `--icon` (active) / `--icon-subtle` (inactive), not from its title color (see Controls). The tab bar CSP has no `img-src`:
the tab bar draws no images. The agent's
cursor arrow replaces the icon while the agent drives a browser tab. Compact paddings, no
separators, the close "x" only on the active tab and on hover; it reserves no room in the row (absolutely positioned over the end of the title, which fades out under it with a mask).
Tab strip motion (`tabbar/renderer.ts`, `tabbar.css`): tabs are rendered keyed by id (elements are reused,
never rebuilt per `tabbar:state`). `TabState.loading` (via `TabViewHandle.onLoadingChanged`, pushed on change only) follows the MAIN-FRAME
document, not every resource (decision in `src/main/tabLoading.ts`, `window.ts` only feeds it raw events): the fill is OWNED by the
navigation that started it (its url, followed through `did-redirect-navigation`). It starts on a main-frame cross-document
`did-start-navigation` (a reload too; never a subframe, same-document or the commit gate's placeholder navigation, `commitGate.isPlaceholderNavigation()`)
and ends at the first of: main-frame `dom-ready` AFTER the owning navigation committed (`did-navigate`; the old document's or the
placeholder's dom-ready does not count), an idle `did-stop-loading`, a main-frame `did-fail-load` of the OWNING navigation (`validatedURL`, any code
including -3 aborted; a failure of an older navigation is ignored), `render-process-gone`. `createTabLoading` alone owns "reported on change only". A page whose subresource never completes (`webContents.isLoading()`
stays true) therefore does not hold the fill at 80%. It drives `span.tab-progress`: a fake-progress fill
behind the content, 0->80% over ~7s, then 100% in 180ms and a 220ms fade (Web Animations API). New tabs
animate in; a closed tab becomes a `.tab-ghost` (NOT `.tab`, so e2e `.tab` counts ignore it; aria-hidden,
inert) that collapses and is removed; ghost rules in `tabbar.css` use `:is(.tab, .tab-ghost)` so a closing
tab keeps its look. The first render never animates. The hidden `about:blank` placeholder of browser tabs never
shows the loading fill (the gate knows its navigation: `isPlaceholderNavigation()`). The strip follows the panel slide through `tabbar:strip-left` (see "Sidebar toggle"). All tab motion is off when
`tabbar:state` `motion` is false (env `SIDEFORM_LIGHT_NO_ANIMATIONS=1` or OS reduced motion) or under
`prefers-reduced-motion: reduce` in the tab bar page (the loading fill becomes a static full-width fill). The empty
view's fade is CSS-only (`empty.css`, `prefers-reduced-motion`) and ignores the env opt-out. The agent cursor stays static.
Reordering: a `.tab` can be dragged along X (pointer events + pointer capture in `renderer.ts`). A drag starts only after >= 4px of horizontal movement (and a quiet strip: no ghost or entering tab, else it stays armed and starts on a later move), so a click still activates on mousedown as before; `.close` and ghosts never start one, and a move with the button up ends a stale gesture. The dragged tab follows the pointer (translateX, clamped to the strip, `.dragging`), the others shift via transforms (150ms ease-out, none when motion is off). `pointercancel` or lost pointer capture cancel and send nothing. There is NO Escape or window-blur cancel on purpose: mousedown activates the tab and main then focuses the tab's page, so the tab bar has no keyboard focus and blurs right after pointerdown. A drop at another slot applies the DOM order at once and sends `tabbar:reorder` `{id, beforeId}` (`penTabbar.reorderTab`); `TabManager.moveTab` reorders the list (the snapshot order, background session tabs included) without touching activation or pins. The optimistic order is kept until a `tabbar:state` confirms it (or the id set changes; 3s safety timeout). A `tabbar:state` mid-drag updates titles/active state but defers DOM reordering until the drag ends. Ctrl+Tab cycles the list, so it follows the new order.

The panel is NOT a tab: not in `TabManager`, not in the tab bar. Its
`webPreferences` come from `secureWebPreferences` (`webPreferences.ts`, shared
with the tab bar and the tab views); its preload `src/preload/agentPanel.ts`
exposes only `window.penAgentPanel = { version: 3, browser, chats, traces, settings }`. Navigation
(`decidePanelNavigation`, `attachPanelNavigationPolicy` in `navigation.ts`):
same origin (the ui origin, see "The app://sideform protocol") AND the panel path or a subpath stays; any other
URL on the ui origin is denied; other http(s) origins go to the
system browser. Its background is theme-matched
like tab views (system theme at creation, tab-bar theme in `pushState`). It is
closed in the window's `closed` handler next to the tab bar view, after a chat flush (`flushThenClose`). Test:
`e2e/agent-layout.spec.ts` (set `AGENT_LAYOUT_SHOT=<png>` to save a composite
screenshot of the views).


**Settings tab (`TabKind` `"settings"`).** The ui's `/settings` page, a SINGLETON per window (`TabManager.openSettingsTab(section?, {focus})`, `findSettingsTab`). Sections: `appearance` and `browser` only (`SETTINGS_SECTIONS`, `isValidSettingsSection`; anything else is ignored and the tab still opens). Opened by the panel or a trace/Settings page over `settings:open` (`settingsOpen.ts`: `isPanel || isPageTab`), by File ▸ Settings… (`CmdOrCtrl+,`; in the app menu on macOS). An existing tab is never reloaded: a valid section goes to it over `settings:section` (`penDesktop.settings.onSection`). The page reads and writes the Browser switches through `penDesktop.browserSettings` (`browser-settings:get|set`, answered only to the top frame of a Settings tab on the settings page of the ui origin: `TabManager.isSettingsViewer` checks the view URL AND the sender frame URL). The only switch is `adBlock` (`{ adBlock: boolean }` in `browser-settings.json`; the `mcpBrowser` and `askAppAccess` keys of Desktop are gone and ignored in an old file). Appearance (theme) is the ui's own localStorage; the panel and the Settings tab share the `app://sideform` origin, hence the same storage.

**Chat storage.** The agent panel's chats are kept on disk (`<userData>/chats/<id>.json`, `chats-dev` while a valid `SIDEFORM_LIGHT_UI_URL` is in effect, i.e. whenever the resolved ui origin is not `app://sideform` (`chatDirForUiOrigin`); `chatStore.ts`, newer-rev-wins, per-id serialization) so a panel reload or an app restart does not lose them. `chats:list|read|save|delete` are registered ONCE per process (`ensureChatIpc` in `window.ts`; removed on `will-quit`, not on window close) and answered only to the panel's own page (`chatIpc.ts` `isChatSender`: the webContents id must be a known panel — `panelSenders.ts` keeps an id valid for 10 s after `destroyed`, so a last save from a closing panel still lands — and the sender frame URL must be the panel page, or gone). The panel page defines `window.penChatsFlush()`; main runs it (`flushThenClose`, bounded 3 s) before closing the panel, and the quit hold (`quitFlush.ts` + `chatFlush.ts`) flushes every panel before `app.quit()` continues.

**Trace tabs (`TabKind` `"trace"`).** The ui's viewer for a recorded browse run, `<ui origin>/trace/<id>?src=local` (`resolveTraceTabUrl`). The panel stores a finished run over `traces:save` (`traceStore.ts`, `<userData>/browse-traces/<id>/trace.json` + frame files; panel only), opens its tab over `traces:open` (`traceOpen.ts`: panel only, no keyboard focus; an open tab for the id is activated instead), lists open trace tabs over `traces:list-tabs` and reads over `traces:read` (the panel, and a trace tab itself). Title follows the page title. A trace tab has the origin clamp (`attachNavigationPolicy`): other http(s) origins go to the system browser.

**Empty start (zero tabs).** With no active tab the window shows ONLY the agent panel and the empty-start view (`src/tabbar/empty.html`, preload `preload/empty.ts`): a headline and one card, "New browser tab". Its button sends `tabbar:new-browser` (the "+" button sends the same); the page also shows a note while only background session tabs remain. A browser tab created FOR THE AGENT while this view is showing becomes the active tab (so the work is visible): a session tab (`newTab(..., { forAgent: true })`, decided by `planNewTab`) without keyboard focus and without the address-bar auto-focus (`TabsSnapshot.activeQuiet`, honoured by `shouldFocusAddressBar`; set ONLY by the `planNewTab` quiet path, never by other `focus:false` activations such as trace/settings or a promoted `activate:false` tab); a shared agent tab with focus, as it always did. The view is shown and hidden by `planEmptyViewUpdate` (`emptyView.ts`); focus goes to the placeholder only when the PERSON closed the last tab, otherwise to the chat. When a QUIET activation (the agent session tab) hides the view while it held focus, or the panel is collapsed, focus goes to the visible agent panel, else to the new active tab (`decideQuietFocus`). Cmd/Ctrl+T is File ▸ New Browser Tab.

**Reveal in Finder.** A trace tab has a folder on disk: File ▸ Reveal in Finder (Show in Explorer / Show in Folder; enabled only while the active tab is a trace tab) and the tab's right-click menu (`tabbar:tab-menu`, native `buildTabContextMenuTemplate`) call `revealInFolder` (`revealInFolder.ts`; the target is `{kind: "trace", id}`, the id validated by `isValidTraceId`; file missing → the folder is opened). Right-clicking a tab does not activate it.

## Interface language

The shell is multilingual: `en` (default), `ru`, `de`, `it`, `fr`. **The ui is the source of truth** (its Language setting); `<html lang>` is the signal (`../CONTRACT.md` "Interface language").

- **Reporting.** `preload/agentPanel.ts` (`panel:language`) and `preload/tab.ts` (`tab:language`) observe the `lang` attribute next to their theme reporters and send the bare code, only a supported one and only when it changes. The static `<html lang="en">` of the ui's index.html is NOT reported on its own (tab.ts reads at DOMContentLoaded and on mutations only). These are channels, not members of `penAgentPanel` / `penDesktop`. Senders: `i18n/languageIpc.ts` (`isPanelLanguageSender`: panel webContents + panel page; `isTabLanguageSender`: top frame of a ui tab, ui origin), unit-tested.
- **State.** `src/main/i18n/`: `languages.ts` (`LANGUAGES`, `parseLanguage`, `detectLanguage(tags)`), `locales/{en,ru,de,it,fr}.ts` (flat `{ key: string }`; `en` defines the keys, the others are `Record<MessageKey, string>` so tsc fails on a missing or extra key), `index.ts` (`t(lang, key, params?)`, `{name}` placeholders), `pages.ts` (`pagePayload(lang, page)`: the keys of a page by prefix), `languageState.ts` (process-level state: persisted `<userData>/ui-language.json`, else `SIDEFORM_LIGHT_LANGUAGE`, else the system language; `set` ignores unsupported codes and repeats, persists, notifies), `languageInstance.ts` (`getLanguageState()`, created on first call like `getBrowserSettings`). `window.ts` subscribes per window: it rebuilds the menu and re-sends `shell:i18n` to every local page.
- **Strings in main** (`menu.ts`, `browserToolsMenu.ts`, `revealMenuLabel.ts`, `agentPanelMenuLabel`, `savePromptCopy`, `minimizedAgentNotice`, the clear-history dialog) take an optional `lang` argument that defaults to `en`; role items (Edit, View, Window, app menu) keep their roles and get explicit translated labels, except `services` and `togglefullscreen` (the OS changes their label by itself). Popups and dialogs read the language when they open. Main keeps English tab titles ("New Tab", "Trace", "Settings", "Passwords", "History": the agent reads them too); the tab bar shows them translated (`displayTitle`).
- **Delivery.** One channel, `shell:i18n` (main to a local page): `{ lang, strings }`, `strings` = only the keys of that page (prefixes in `pages.ts`: `tabbar.`, `empty.`, `omnibox.` + `time.`, `passwords.`, `history.`). Sent on the page's `did-finish-load` and on every change; the preloads of the tab bar, empty start, omnibox, Passwords and History pages expose `onI18n(cb)`. Renderers compile to plain scripts and cannot import: `src/tabbar/i18nClient.ts` is a global script (`penI18n`, loaded first by every page, also from `../tabbar/`). The HTML keeps English and carries `data-i18n` / `data-i18n-title` / `data-i18n-aria-label` / `data-i18n-placeholder` (the value is the key); dynamic text uses `penI18n.tr(key, englishFallback, params)` / `tn` (plural) and re-renders in `penI18n.onChange`. `set` also sets `<html lang>`. Dates use the language as the Intl locale (`en` keeps `en-GB` / `en-US` as before).
- **Adding a string.** Add the key to `locales/en.ts` and to the four other files (tsc fails otherwise), use it with the same English text as the fallback or in the markup; `test/i18n.test.ts` pins locale key sets, placeholders, plural categories, that every `data-i18n` key and `tr` fallback equals the English locale and that each page only uses its own prefixes.
- **e2e.** `e2e/userDataIsolation.ts` sets `SIDEFORM_LIGHT_LANGUAGE=en` for every launch (the machine's locale must not change the labels the specs assert); `e2e/language.spec.ts` sets the stub agent page's `<html lang>` and checks the tab bar, the empty start, the menu and persistence.

## MCP agent bridge

An external agent (Hermes Agent, Claude Code, Codex: any MCP client on this machine) gives a task to the RUNNING app, polls it, answers the agent's questions and reads the result. It is a task giver, not a remote control: no browser tools over MCP. Spec: `../docs/superpowers/specs/2026-11-15-mcp-agent-bridge-design.md`; wire shapes: `../CONTRACT.md` "MCP agent bridge". OFF by default; switched on in Settings > MCP.

- **Code** (`src/main/mcp/`, all Electron-free and unit-tested except the wiring): `httpServer.ts` + `jsonRpc.ts` + `auth.ts` (hand-rolled MCP over HTTP POST at `/mcp` on `127.0.0.1`, fixed port 47821; loopback remote-address check, constant-time bearer, Host pinning, any `Origin` rejected, 1 MB cap, post-listen errors never crash main, GET → 405), `tools.ts` (the six tools: manifest + dispatcher) with `toolInputs.ts` (validation, runs BEFORE the panel is asked) and `waitTask.ts` (`get_task` + `waitSeconds`), `panelBridge.ts` (request ids, 15 s reply timeout, one live panel, last registered wins), `settingsStore.ts` (`<userData>/mcp-bridge.json`), `handshake.ts` (`~/.sideform-light/mcp.json`), `service.ts` (lifecycle, serialized), `mcpSettingsIpc.ts`, `mcpPanelIpc.ts` (sender check).
- **Wiring.** `index.ts` creates ONE `PanelBridge` and ONE `McpService` per process (`start()` after ready only when enabled; `disposeSync()` on `will-quit`) and registers `mcp-settings:*` once. `window.ts` registers the window's panel on `mcp:panel-ready`, drops it on navigation / destroy / window close, and forwards `mcp:task-reply` / `mcp:task-changed` to the bridge after `isMcpPanelSender`. No decisions live there.
- **Security.** Port busy → status `error`, no random fallback (a static client config would silently break). The token (64 hex) is shown to the Settings page only; it never appears in a log, a status text or an MCP result. Closing the window or a panel reload makes the bridge answer "Sideform Light has no open window". Tasks are ordinary panel chats; the panel marks them `source: "mcp"` in the chat meta (`chatStore.ts`), and an MCP client can only reach those.
- **e2e** (`e2e/mcp-bridge.spec.ts`): the stub ui's agent page registers a fake `penAgentPanel.mcp.onRequest` handler with canned replies (`stubUi.ts`); the spec enables the bridge through `mcp-bridge.json` in its own userData dir, uses `SIDEFORM_LIGHT_MCP_PORT` (a free port) and `HOME` (a temp dir), and makes real HTTP calls.

## IPC channels

Channel names are plain strings; `test/ipcContract.test.ts` scans `src/` and pins every channel with its direction (and that every `ipcMain` listener is torn down again). Keep this table and that test in sync.

| Channel | Direction | Notes |
|---|---|---|
| `tabbar:state`, `tabbar:theme`, `tabbar:tail`, `tabbar:strip-left` | main → tab bar | snapshot, resolved theme, address-row tail colour, per-frame strip offset |
| `tabbar:new-browser`, `tabbar:tools-menu`, `tabbar:tab-menu`, `tabbar:activate`, `tabbar:close`, `tabbar:reorder`, `tabbar:toggle-panel`, `tabbar:navigate` | tab bar (and the empty start for `new-browser`) → main | sender-checked (`fromOurTabbar`) |
| `tabbar:omnibox-show`, `tabbar:omnibox-hide`, `history:remove-suggestion`, `history:suggest` | tab bar → main | address-bar suggestions |
| `tabbar:omnibox-picked`, `tabbar:omnibox-refresh`, `omnibox:render` | main → tab bar / popover | |
| `omnibox:pick`, `omnibox:remove`, `omnibox:open-history` | popover → main | |
| `panel:theme` | panel → main | the panel's theme; the window chrome follows it |
| `tab:theme` | trace/settings page → main | colours that tab's own view only |
| `panel:language` | panel → main | the ui language (`<html lang>`), panel webContents and panel page only |
| `tab:language` | trace/settings page → main | same, top frame of a ui tab on the ui origin only |
| `shell:i18n` | main → tab bar, empty start, omnibox popover, Passwords, History | `{ lang, strings }`: the page's own keys; on load and on every language change |
| `browser:command`, `browser:reveal-agent-tab` | panel → main | the ONLY browser owner is the panel |
| `passwords:list\|add\|update\|remove\|never-remove`, `passwords:theme`, `passwords:changed` | Passwords tab ↔ main | attached webContents only |
| `history:list\|remove\|clear\|open`, `history:theme`, `history:changed` | History tab ↔ main | |
| `settings:open` | panel / trace / settings → main | `settings:section` goes back to an open Settings page |
| `browser-settings:get`, `browser-settings:set` | Settings page → main | top frame of the Settings tab only |
| `mcp-settings:get`, `mcp-settings:set`, `mcp-settings:regenerate-token` | Settings page → main | same sender rule (`browserSettingsIpc.isSender`) |
| `schedules:list`, `schedules:save`, `schedules:remove`, `schedules:run-now`, `schedules:open-chat` | Settings page → main | same sender rule; scheduled chats (`src/main/schedules/`: cron, store, scheduler, IPC), fires over the MCP panel bridge (`schedule-start`, `open`); `open` expands only the window that owns the registered panel. Known limitation: if the panel answers a schedule-start after the 15 s bridge timeout, the run is recorded as failed and main loses its chat id |
| `schedules:changed` | main → Settings page | after any change or run |
| `schedules:panel-list`, `schedules:panel-create` | agent panel → main | `penAgentPanel.schedules` (agent tools `schedule_list` / `schedule_create`); panel sender only, `create` is called after the person confirms the in-chat card |
| `mcp:panel-ready`, `mcp:task-reply`, `mcp:task-changed` | panel → main | panel webContents AND panel page only (`isMcpPanelSender`, the `chats:*` check without the vanished-frame allowance) |
| `mcp:task-request` | main → panel | `{ requestId, request }`, to the one registered panel |
| `chats:list\|read\|save\|delete` | panel → main | panel page only, process-level |
| `traces:save\|read\|open\|list-tabs` | panel (and trace tab for `read`) → main | |

Removed with the cut (the contract test fails if one comes back): every `canvas:*`, `canvases:*`, `doc:*`, `docs:*`, `workflow:*`, `workflows:*`, `auth:*`, `app-icon:*`, `logins:*`, `menu:command`, `empty:*`, `editor:*`, `tabbar:new`, `tabbar:new-doc`, `tabbar:new-menu`, `traces:list`.

## Testing

- Unit tests (`test/`, Vitest, plain Node, no Electron): every pure module has one. `localProtocol.test.ts` pins traversal safety, the host check, the SPA fallback, MIME types and the CSP (backend origin included); `config.test.ts` pins the URL resolution; `ipcContract.test.ts` pins the channel table and the browser-command list.
- e2e (`e2e/`, Playwright `_electron`): a stub http server (`e2e/stubUi.ts`) plays the ui; the shell is pointed at it with `SIDEFORM_LIGHT_UI_URL`, so no `ui/dist` and no backend are needed. `npm run test:e2e` runs them all. The big `browser-tab.spec.ts` drives the built-in browser end to end through `window.penAgentPanel.browser`.
- Live checks against the real ui (`../ui/dist` bundled) are manual: `npm start` with the backend running locally.

## Built-in browser tab

> **Controller moved to a package.** `BrowserController`, the injected page
> scripts, key parsing, `decideBrowserNavigation` and `BrowserTabInfo` come from
> `@sideform/browser-agent/controller` (runtime dependency, pinned in `package.json`). Minor bumps are breaking in 0.x. Their design notes and fix history
> are in the package: `browser-agent/docs/controller-notes.md` (path mapping in
> its header). This repo keeps the Electron side, described below: `window.ts`
> (`BrowserTarget`/`BrowserPageHandle` over `WebContentsView`), `navigation.ts`,
> `browser/permissions.ts`, `tabManager.ts`, IPC and e2e. The package is
> ESM-only; the CommonJS main process loads it with `require()` (Electron 43 /
> Node 24), types via its `typesVersions`.

The `"browser"` `TabKind` (`tabManager.ts`) — a real browser tab the agent can drive on the open web.

**Agent-activity icon.** While the agent drives a browser tab, the tab strip
shows the agent's cursor arrow before that tab's title (blue on the active
tab, pale grey on an inactive one, no animation; page tabs never). Only
page-driving `browser:command`s count (`isAgentPageCommand` in
`src/main/agentActivity.ts`: not journal/checkpoint/`releaseFixture`, not
`tabs` `list`, not unknown commands). `window.ts` calls `begin(tabId)`/`end(tabId)` on the
pure per-tab tracker (`createTabAgentActivity`) with the tab the command
started on, and `pulse(tabId)` on the tab it landed on if that differs
(`tabs new`/`switch`, popups). Each tab has its own in-flight count and holds
"working" for `AGENT_ACTIVITY_IDLE_MS` (4s) so the icon does not flicker while
the LLM thinks between steps, so parallel isolated sessions light their own
tabs and one finishing never clears another's; a session with no tab yet marks
nothing. `TabManager.setAgentTabWorking` turns this into
`TabsSnapshot.agentTabIds`: the marked tabs that are still live browser tabs.
There is no fallback: closing a tab clears its icon, and user tab switches
do not move it until the next agent command. It rides on `tabbar:state` (no
extra IPC channel). The renderer draws the same arrow geometry as the in-page
cursor from `@sideform/browser-agent`, plus a visually hidden "Agent is
working" label.

**Awake agent tabs.** A `WebContentsView` with `setVisible(false)` gets
`document.visibilityState = "hidden"`: `requestAnimationFrame` never fires,
timers run at 1/s and `capturePage` returns an empty image. Sites that hydrate
on rAF then hang and agent screenshots fail. So `TabManager` gives each tab a
view mode (`resolveViewMode`): `shown` (the active tab), `awake` (a browser tab
the agent drove, not active) or `hidden`. An awake view stays visible but sits at
the BOTTOM of the window's view z-order (`setViewMode` in `window.ts`'s handle,
`addChildView(view, 0)`), under the active tab with the same bounds and radius,
so it is fully covered and never shows. It renders at full speed. Going back to
`shown` re-adds it on top. A tab that was never awake is never reordered.
`layoutActive` moves awake tabs too. A second `createTabAgentActivity` in
`window.ts` (`AGENT_AWAKE_HOLD_MS` = 60 s, called in the same places as the icon
tracker) feeds `TabManager.setAgentTabAwake`; the 60 s hold covers the LLM
thinking between steps. Awake is not tab-bar state: no snapshot is emitted.
`index.ts` also sets the Chromium switch `disable-backgrounding-occluded-windows`
(before ready), so a window covered by another app's window keeps rendering. Cost:
the ui pages also render while covered; they are static, so the idle
cost is small. A MINIMIZED window cannot be fixed: Chromium always hides it. On
`minimize`, if a tab is awake, the main window shows one Notification ("The
agent's browser tab is paused") telling the person to open the window. Awake
also lasts through the 60 s hold after the agent finished, so the text never
claims the agent is running. A handle without `setViewMode` (test fakes) cannot
go under the active tab, so there an awake tab stays hidden.

A browser tab's `WebContentsView` is constructed with
`partition: "persist:penbrowser"` — its own session, separate from the ui
pages' (the default session) — and **no preload at all**: `contextIsolation`/`sandbox` are
on as usual, but there is nothing exposing a bridge to it. That
dedicated partition is the whole security boundary: the ui's storage is
never in it, and whatever the user logs into inside the browser tab is
exactly what the agent can reach, nothing more.
The partition also has no chrome to ever reveal or revoke a granted
permission, so `index.ts` calls `denyAllPermissions` (`browser/permissions.ts`)
on it exactly once, at startup, after `app.whenReady()` — deny-by-default
`setPermissionRequestHandler`/`setPermissionCheckHandler`, since Electron
grants permission requests by default and would otherwise silently hand any
browsed page geolocation, notifications, clipboard-read, or media devices.
(The default session, which the ui pages use, is locked down the same way
by `restrictPermissions` with one exception, `clipboard-sanitized-write`.)
A browser tab's title/url/back-forward state comes from real
navigation events (`did-navigate`, `did-navigate-in-page`,
`page-title-updated`) that `window.ts` wires into
`TabViewHandle.onNavigationStateChanged` — wired by `TabManager.newTab()`
only for `kind: "browser"`.

The `browser:command` `ipcMain.handle` in `window.ts` checks the sender
against `isBrowserOwner` (`orphanRelease.ts`): the agent panel's
webContents id is the only owner (its preload, `preload/agentPanel.ts`, carries the
one browser bridge; `test/preloadBrowserBridge.test.ts` pins its shape). The trace/settings pages
(`preload/tab.ts`) have no browser bridge at all.

Ownership of the SHARED browser's fixture is per sender, like the journal:
`src/main/fixtureOwners.ts` records which webContents (the panel)
applied it and its token. The owner is recorded when `applyFixture` STARTS (pending): a sender that reloads, crashes or closes mid-apply marks the in-flight fixture, and `finishApply` hands back the release (also when the sender is no longer a live browser owner). The panel's reload/crash/window close releases only a
fixture it owns.
The panel's orphans (fixture, journals, isolated sessions) are released on
`render-process-gone` and on a COMMITTED main-frame navigation (`did-frame-navigate`, `isMainFrame` passed to `isOrphaningEvent`),
never on `did-start-navigation`, which also fires for navigations the panel policy
denies, 204s and downloads (`isOrphaningEvent`, `orphanRelease.ts`).

Popups (`target="_blank"`, `window.open`) inside a browser tab open as a new
browser tab (`navigation.ts`'s `attachBrowserTabPolicy` /
`decideBrowserNavigation` — any http(s) URL is allowed, anything else is
denied) rather than escaping to the system browser via `shell.openExternal`,
unlike the ui pages' `attachNavigationPolicy` (origin clamp, everything else external).
**`open` resolves at DOM-ready, not at full load.** `webContents.loadURL()`'s
own promise only resolves at `did-finish-load` — every subresource,
including ads/trackers/video on a heavy commercial page, which routinely
exceeds `BROWSER_COMMAND_TIMEOUT_MS` (20s) even though the page has been
usable for most of that wait. `BrowserPageHandle.onceDomReady()`
(`TabViewHandle.onceDomReady()` in `window.ts`, a one-shot listener on
`webContents`'s `dom-ready` event) is armed **before** `loadURL()` is
called — arming it after risks missing an event that can fire while
`loadURL()` is still synchronously setting up the navigation — and raced
against the `loadURL()` promise. If the full load settles first (a fast
page, or a genuine navigation error before the DOM ever became ready), that
result is trusted outright, a rejection surfacing as `{ error }` exactly as
before this fix. If DOM-ready wins, the page gets a short, bounded grace
period (`OPEN_LOAD_GRACE_MS`, 1500ms — well under the command timeout) to
finish the full load too, so the common fast page still reports
`loaded: true`; if the grace period expires first, the command returns with
`loaded: false` instead. The result's new `loaded: boolean` field is the
only way a caller can tell which case happened — `get_screenshot` or
`browse_find_images` immediately after a `loaded: false` open should expect
a page that's still filling in. `loadURL()`'s own promise is *always*
awaited internally (via a `.then` that converts a rejection into a resolved
value) regardless of which branch is taken, so a load failure or success
that settles after `open` has already returned can never surface as an
unhandled rejection — it's simply too late to change the `loaded` value
already reported.

Page scripts and a load that never ends. Electron's own
`webContents.executeJavaScript` (and `executeJavaScriptInIsolatedWorld`) defer
running until the page *stops* loading (electron/electron#5183): normally a
feature (no script runs on the outgoing or the not yet committed document while
a navigation is pending, and the result serialization is the one every command
was built on), but on a page with one subresource that never completes (seen on
avito.ru behind its anti-bot check) every `snapshot`/`read`/`act` would time out.
So the default route stays `webContents.executeJavaScript`, and only a "stuck"
tab takes another one. The decision is the pure `src/main/scriptRoute.ts`
(`pickScriptRoute`): a browser tab showing a real document (not the placeholder),
whose main-frame navigation is finished (`tabLoading.ts` idle: committed AND
dom-ready, or failed/stopped), while `webContents.isLoading()` is still true.
`window.ts` only wires it (`runPageScript`; the handle's `executeJavaScript`, the
tail-colour sample and `getUaBrands` go through it):
- stuck: `webContents.mainFrame.executeJavaScript` (no gate) raced against
  `STUCK_SCRIPT_TIMEOUT_MS` (10 s, "Frame script timed out after ..."); no live
  frame rejects with "Frame no longer exists.".
- isolated world, stuck: CDP (`isolatedEval.ts`: `Page.createIsolatedWorld` +
  `Runtime.evaluate` with that context id, no `Runtime.enable`, the `CdpSend` type of
  `loginCapture.ts`), frame id and context id cached per main-frame document and
  dropped on a main-frame `Page.frameNavigated`. It sends on the tab's debugger
  directly, not through `sendGated`: the document is committed by definition there.
- everything else: unchanged Electron calls. The agent panel's own flush script
  (`pagePort`) keeps `webContents.executeJavaScript` too.

Accepted trade-off of the stuck route: `WebFrameMain.executeJavaScript`
serializes differently from `webContents.executeJavaScript` (an `undefined`-valued
key, `NaN` and `Infinity` are dropped, `Date` arrives as a number, a typed array
as `{}`, `undefined` inside an array becomes `null`). The controller's scripts
return plain JSON, so this is the price of not timing out after 20 s on every
command. `e2e/browser-hanging-load.spec.ts` pins it (`<img src="/hang">`: open,
snapshot, read, perform by index, annotated screenshot all answer in well under
5 s while `isLoading()` is still true).
The address row (a second, 32px-tall row inside the *existing* tab-bar
`WebContentsView` — no new view, no new preload) is shown only while the
active tab is a browser tab; `window.ts`'s `layout()` re-runs on every
`tabbar:state` push (not just on window resize) since the active tab's kind
can change without one. Its back/forward/reload/url controls send
`tabbar:navigate` (sender-checked against the tab-bar view, like
`tabbar:new`/`tabbar:activate`/`tabbar:close`). Typed input is normalized by
`normalizeTypedUrl` in `src/tabbar/urlNormalization.ts` — its own file
(loaded as a second plain `<script src>` before `renderer.js`, same
no-import/export global-script constraint as `renderer.ts`, so its
functions are testable in isolation) — into a navigable URL: whitespace in
the input always means a search query (routed to a Pinterest search),
otherwise it is parsed as a URL (`https://` prepended if there's no
scheme) and falls back to search if that fails or the parsed host has no
dot. A submission that still can't be normalized into an `http(s)` URL
(`isNavigableUrl`, also in that file) leaves the input showing its prior
value with a `.invalid` CSS class instead of silently doing nothing. The
input also resyncs to the tab's latest known url on blur — while focused,
incoming `tabbar:state` pushes don't overwrite it (so as not to clobber
mid-typing), but nothing used to catch it up afterwards, leaving it stale
indefinitely if a state change (e.g. an agent-driven `browse_open`) landed
while the user had the address bar focused. When the active tab's url goes from empty to non-empty and the user has not typed
(`userEditingUrl` false), `renderer.ts` also blurs the input (`shouldBlurAddressBar`, `urlNormalization.ts`, unit-tested), so a tab
that was auto-focused and then navigated by the agent does not stay focused and grey.

**A fresh, empty-URL browser tab becoming active auto-focuses the address
bar**, the way every real browser does on a new tab — File ▸ New Browser Tab
used to produce a tab titled "New Tab" with a visible but unfocused,
completely empty address row and a blank content area, with nothing at all
inviting input (the placeholder "Search or enter address" only helps once
the field is actually focused). The decision lives in `tabManager.ts`'s pure,
exported, unit-tested `shouldFocusAddressBar(previous, next)` — true only
when the *newly* active tab is a browser tab with an empty url (keyed off
"the active tab id changed since the previous push", not just "kind browser,
url empty", so the frequent non-activation pushes — title changes,
navigation-state changes, resizes — never steal focus
from whatever the user is doing). `window.ts`'s `pushState` tracks the prior
snapshot itself, calls the predicate, and folds the result into the existing
`tabbar:state` snapshot as `focusAddressBar` rather than adding a new IPC
channel. Two halves, both required, since the tab bar is its own
`WebContentsView`: `window.ts` focuses `tabbarView.webContents` itself
(OS-level — without this, focusing an input inside the tab bar's own DOM
does nothing for where keystrokes actually go), and `renderer.ts` focuses
and selects `#url-input` when it sees `focusAddressBar` on the pushed state.

This auto-focus interacts with the blur-resync anti-clobber guard above in a
way worth knowing: being merely *focused* is no longer by itself enough to
suppress `onState`'s writes into `#url-input` — only an actual `input` event
(`userEditingUrl` in `renderer.ts`) does. The auto-focus on a brand-new blank
tab fires with no keystroke at all, and if focus alone suppressed syncing, a
subsequent agent-driven `browse_open` navigating that same tab would never
un-suppress it (nothing ever blurs the field in that flow), permanently
wedging the address bar on `""` even once the tab had actually navigated.

**`SIDEFORM_LIGHT_USER_DATA_DIR`** overrides Electron's `userData` directory
(`config.ts`'s `resolveUserDataDir`, applied in `index.ts` via
`app.setPath("userData", …)` before `app.ready`; empty = unset).
`e2e/userDataIsolation.ts` (called from all three Playwright configs) sets it to
a temp dir that is fresh per Playwright RUN and shared by that run's launches
(every spec spreads `process.env` into its `electron.launch` env) — enough to
keep a developer's saved cursor settings out of e2e. `e2e/globalTeardown.ts`
deletes the dir afterwards (only one the helper created; an explicitly set
`SIDEFORM_LIGHT_USER_DATA_DIR` is left alone).
**Storage identity.** The app name is `Sideform Light` (`DISPLAY_APP_NAME`, `config.ts`), set with `app.setName` BEFORE ready in `index.ts`: Chromium takes the safeStorage Keychain item name (`"Sideform Light Safe Storage"`) from the name at ready and ignores later `setName` calls. `userData` is `<appData>/Sideform Light` (explicit `app.setPath`), so Light never shares a directory, a Keychain item or a saved-logins file with Sideform Desktop. `index.ts` also takes `app.requestSingleInstanceLock()` (a second launch quits and focuses the existing window). If the key ever does not match, the credentials file is kept untouched: `list()` still shows the entries, `findForOrigin` returns `undecryptable`, and re-saving a login re-encrypts just that entry.
**`tabs({ action, tabId?, url? })`.** `list` returns every open browser tab
(`{ tabId, url, title, current }[]`) plus which one is current; `switch`
makes a given tab the agent's current tab (and activates it in the strip);
`close` closes a *browser* tab only — a non-browser tab id, or an id that isn't
currently open, is a clean error, never a wrong-kind-of-tab close; `new`
opens a fresh browser tab, optionally loading a URL with `open`'s http(s)-only
semantics. Backed by four **optional** `BrowserTarget` methods
(`listPages`/`selectPage`/`closePage`/`newPage`) — `tabs()` reports "not
supported" up front if any is missing (window.ts always implements all four
together, over `TabManager.listBrowserTabs()`/`activate()`/`closeTab()`/
`newTab()`), rather than failing action-by-action.

**`TabManager.agentBrowserTabId`.** Which browser tab (by `TabManager`'s own
sequential id) the agent is currently driving. `browserHandle()` prefers this
tab while it's still a live browser tab, falling back to the pre-existing
"active if browser, else most-recently-created browser tab" rule otherwise.
Fixes upstream jev-ultrafast #61 ("the agent sticks to the old tab"): a popup
opened from a browser tab (`window.ts`'s `attachBrowserTabPolicy` callback)
sets this to the new tab, so the very next browser command targets it even
before the user has looked at the strip; `tabs({action:"switch"|"new"})`
also set it. Cleared when
the tab it points at closes — `browserHandle()`'s own fallback rule already
covers "no explicit agent tab."

Review finding 4: `TabManager.activate(id)` — the path a user-initiated
tab-strip click goes through (`window.ts`'s `tabbar:activate` IPC handler) —
now also repoints `agentBrowserTabId` to `id` when the newly-activated tab is
a browser tab: **the agent follows the user's focus.** Before this,
`browserHandle()` kept preferring a stale `agentBrowserTabId` even after the
user had switched the tab strip to a different browser tab, so the next
browser command silently acted on the tab the user had left, not the one
they were looking at. Deliberately *not* folded into the private `setActive`
helper every *automatic* activation already routes through (a fresh tab, the
active tab closing, a popup's own activation via `newTab`) — see finding 7
immediately below, which needs a popup's activation to *not* by itself
repoint the agent.

Review finding 7: a popup's target now matters. `window.ts`'s
`attachBrowserTabPolicy` callback fires per browser tab (one closure per
`createView` call), so before this fix *any* browser tab's popup — even one
the agent wasn't driving — repointed `agentBrowserTabId` to the new tab,
letting a tab the user had open on the side steal the agent from whatever it
was doing. The callback now compares `tabs.browserHandle()?.getWebContentsId()`
against its own tab's id first: only a popup opened by the tab the agent is
*currently* driving sets `agentBrowserTabId` to the new tab (fixing #61, as
before); a popup from any other browser tab still opens (and, unchanged,
still becomes the *active* tab in the strip via `newTab`'s own `setActive`
call) but the agent does not follow it. This is what makes finding 4's
`activate()` change safe to add: a popup's automatic activation goes through
the private `setActive` path, not the public `activate()`, so it never
triggers "the agent follows the user's focus" on its own — only an explicit,
genuinely user-driven tab-strip click does.
**CDP session per browser tab.** `window.ts` attaches
`webContents.debugger` (protocol version `"1.3"`) once, at tab creation, only
for `kind === "browser"` — never for page tabs, which have no reason to
need trusted input events or dialog interception. `Page.enable` is sent
immediately after a successful attach. Attach failure (most commonly: real
DevTools already attached to this tab) degrades gracefully and locally:
`sendCdp`/`drainDialogs` are left `undefined` on that tab's handle, so
`press`/`hover` report a clear `{ error: "…requires a CDP session…" }` and
dialogs on that tab simply aren't auto-handled — nothing else in this bridge
depends on the session existing. `sendCdp`/`drainDialogs` are
**optional** members of both `BrowserPageHandle` (`controller.ts`, the
Electron-free interface `BrowserController` is tested against) and
`TabViewHandle` (`tabManager.ts`) — structurally identical on both sides, the
same pattern `isVisible?`/`onceDomReady` already established. The debugger is
detached in the tab's own `destroy()`, guarded by whether attach actually
succeeded.

`press`'s `Input.dispatchKeyEvent` and `hover`'s `Input.dispatchMouseEvent`
are **trusted, OS-level input events** — unlike a page-script
`el.dispatchEvent(...)`, which a real app's `keydown` handler can (and
routinely does) ignore via `event.isTrusted`, and which never triggers the
browser's own `:hover` CSS pseudo-class at all. This is the whole reason
`press`/`hover` exist as CDP-backed actions instead of two more page scripts
like `CLICK_JS`/`TYPE_JS`.

**Dialog policy.** `Page.javascriptDialogOpening` (received via the same
`webContents.debugger.on("message", …)` listener) is auto-handled per the
design doc's policy — `alert`/`beforeunload` → `Page.handleJavaScriptDialog`
with `accept: true` (there is no meaningful "no" to either), `confirm`/
`prompt` → `accept: false` (never agree to something on the user's behalf).
Every **auto-handled** dialog is pushed onto a per-tab queue (`{ type,
message }`, message trimmed to 200 chars, capped at `DIALOG_QUEUE_CAP` (10)
— oldest dropped first, so a crashed/stuck agent loop that never drains it
can't grow this unboundedly) that `drainDialogs()` empties.

Review finding 3: auto-handling only ever applies **while an agent browser
command is actually in flight.** `window.ts` keeps a window-scoped `ScopeCounter`
(`commandsInFlight`, per scope: the shared browser or one isolated session),
incremented/decremented around the whole command dispatch (`try`/
`finally` so a throwing command can't leave it stuck above zero);
`Page.javascriptDialogOpening`'s handler checks `commandsInFlight.active(<the
tab's own scope>)` — a session command never auto-answers a dialog in a tab the
user browses — and, outside a command, returns without calling
`Page.handleJavaScriptDialog` or queuing anything at all — the user sees and
answers that dialog themselves, the same as in any other browser. Before
this fix, *any* JS dialog on a browser tab — including one the user
triggered themselves by typing a URL or clicking a link with no agent
command running — was silently accepted/dismissed on their behalf, with no
way to ever see or answer it.
**Third-pass review findings.** (a) The address row's back/forward/reload/
URL entry drives `TabManager.activeBrowserHandle()` — the tab it is showing —
never `browserHandle()`, which prefers the agent's pinned (possibly hidden)
tab. (b) The pre-command dialog sweep touches only the agent's current tab
(`currentBrowserTabId()`); a dialog in a tab the user is browsing by hand is
theirs to answer, and auto-accepting a "Leave site?" would lose their input.
This refines second-pass item 1 below. (c) A command that TIMES OUT keeps
running (a promise can't be cancelled), so `BrowserController` records it as
`overrun` and the next queued command waits for that work to settle, bounded
by `OVERRUN_GRACE_MS` (10 s) — otherwise a late click or a late
`REMOVE_MARKS_JS` lands inside the next command's before/after captures.
**Unit vs. e2e split.** The unit suite (`test/browserController.test.ts`)
stubs `executeJavaScript` and a fake `sendCdp` that records every `Input.*`
call, covering the trusted/fallback branch selection, the hidden-target
error, and scroll-container argument plumbing — it cannot prove a click is
*genuinely* trusted, that a synthetic click never fires `pointerdown`, or
that `Input.insertText` fires a real `beforeinput` (React's own signal that
a change came from a real input event, not a scripted one). Those three —
plus a real inner-scroll container — are e2e-only, against a real DOM served
by `e2e/browser-tab.spec.ts`'s own stub HTTP server (`/wave2` fixture).
A child frame's own `executeJavaScript` is not gated on the load ending (the
gate of electron/electron#5183 is on `webContents`, see "Built-in browser tab"),
but a frame that never answers must not hang a
whole `snapshot`/`read`/`findImages` call — every per-frame script call
(`executeScriptInFrame`) is raced against `FRAME_SCRIPT_TIMEOUT_MS` (1.5s,
enforced both in `window.ts`'s own `executeJavaScriptInFrame` and again in
`controller.ts`'s wrapper), and a timed-out or rejecting frame is simply
skipped — the command still succeeds with whatever it already had. This bit
concretely with `checkBotWall` below (a *top-document* script, not a frame
one) before it got its own short, independent timeout — see that section.

## PageFixture (`applyFixture` / `releaseFixture`)

`window.penAgentPanel.browser.applyFixture(fixture)` / `releaseFixture(token?)` go
through `browser:command`. Every fixture field is allowed
(`allowNetworkMocks: true`); a non-object fixture is rejected by the
controller itself (stage `validate`). Everything is scoped to the browser
partition `persist:penbrowser` and to browser tabs — the ui's default session and the
default session are never touched:

- `network`: `src/main/fetchRouting.ts` implements `BrowserTarget.routeRequests`
  with CDP `Fetch` (Request stage) on each browser tab's debugger session.
  Never `session.webRequest` (profile-wide). Tabs opened while routing is
  active are enabled on creation; the remover (`releaseFixture`) disables
  Fetch and lets paused requests through. `routeRequests` awaits every tab's
  `Fetch.enable` ack and throws (after undoing) if any still-registered tab
  fails (a tab closing mid-call is ignored). Enable/disable are serialized per
  tab (a late disable of a removed route can no longer switch off a newer
  route). If the agent's current browser tab has no debugger (attach failed,
  so it is not registered), `routeRequests` throws "request interception is
  not available in this browser tab" instead of reporting mocks it cannot
  deliver.
  Limits: (a) mocks apply to EVERY tab of the built-in browser
  (`persist:penbrowser`), including tabs the user browses manually, and never
  to the ui page tabs; rules match only the fixture's URLs, other requests pass
  through. (b) CDP Fetch is per page target: requests from out-of-process
  (cross-site) iframes and from service workers are NOT intercepted, unlike
  the cloud (Playwright context route).
- Orphaned mocks: main owns them, but the renderer's `finally` never runs when
  the agent panel (the fixture's owner) reloads, crashes or closes. `window.ts`
  releases the panel's own fixture on its `render-process-gone`, a COMMITTED
  main-frame navigation (`did-frame-navigate`; a denied navigation or a 204 keeps it), and destroy. Never for browser tabs.
- Debugger `detach` on a browser tab unregisters it from the router (it clears
  that tab's `enabled` state) and sets `debuggerAttached = false`.
- `storage.cookies`: `getCookies` / `setCookies` in `src/main/fixtureSession.ts`
  against `persist:penbrowser`. Host-only cookies (`hostOnly`) map to a `url`
without `domain`, and `__Host-` cookies are set without `domain`.
- `fresh`: `resetSession(origins)` closes every browser tab, opens one blank
  browser tab, then clears cookies and site data (`clearStorageData` with an
  `origin`) ONLY for the fixture's own origins (all origins are validated, http/https only,
  BEFORE any tab is closed; cookies are found with `cookies.get({domain})` so
  path-scoped and Secure ones go too). Other sites' logins survive.
  Parent-domain cookies (`.example.com` for origin `https://app.example.com`)
  are kept: only the origin host's own cookies go. Cookies ignore ports, so
  `http://localhost:3000` clears localhost cookies shared by every localhost
  port (a browser limitation).
  No origins means only tabs are reset. Never call `clearStorageData` /
  `clearCache` without an origin.

## QA diagnostics (`assert`, failed requests, emulation bookkeeping)

- `browser:command` `assert` calls `BrowserController.assert(args)` (read-only
  checks; `@sideform/browser-agent` v0.2.22). It is page-driving, so isolated
  sessions get it through `BROWSER_COMMANDS`.
- Failed requests: `src/main/failedRequests.ts` (pure) records
  `Network.responseReceived` status >= 400 and `Network.loadingFailed` (not
  canceled) from the tab's debugger messages as `<METHOD> <status|error>
  <origin><pathname>` (no query/hash, ring of 50). The handle's
  `drainFailedRequests` is a getter that is `undefined` while the debugger is
  detached, so a check never passes on a tab that cannot see the network.
- `clearDiagnostics()` empties the console-error and failed-request buffers at
  `applyFixture` and at a run boundary (`src/main/runBoundary.ts`: the first
  command of a scope, or the first after 5 minutes idle), so failures from
  before a run do not count in it.
- `src/main/agentEmulation.ts` (pure) tracks which tabs an agent fixture
  emulated (device metrics or UA, seen through the agent's `sendCdp` during
  apply) per `fixtureToken`. A matching release resets the Browser tools
  Viewport radio of those tabs only. The menu itself sends through
  `sendCdpDirect`, so the user's own viewport is never taken for a fixture's.
- **`Emulation.*` before the first commit crashes Electron 43** (main process
  SIGSEGV, EXC_BAD_ACCESS at 0x0). A browser tab that never committed a
  document must not receive it. `src/main/commitGate.ts` (pure, unit-tested)
  plus `sendGated` in `window.ts`. Rules, each learned from a race:
  - `ensure()` ONLY WAITS (for a navigation EVENT, never a CDP reply:
    deadlock). It never loads anything; loading on demand cancelled a
    navigation its caller had just started. The hidden `about:blank`
    placeholder is loaded in two places only: at creation of a browser tab
    (`startPlaceholderIfIdle`, ~100 ms after creation and only if the tab has not started a navigation by then: an immediate load raced `open`'s loadURL, and a committed about:blank makes Playwright report the page early; not awaited; `handle.loadURL` waits out an in-flight placeholder because Electron resolves a superseding `loadURL` at the placeholder's finish-load) and by the gate itself when the first
    navigation was aborted with no commit (204/download: only
    `did-stop-loading`, nothing loading, capped at 3).
  - A commit is `did-navigate` OR `dom-ready` (a refused connection commits an
    error page with no `did-navigate`). The placeholder also waits for its own
    `dom-ready`, so a late one cannot satisfy a following `open`'s
    `onceDomReady`. The 10 s timeout is quiet-time: start/redirect/loading
    events re-arm it (hard cap 60 s while still loading). `render-process-gone`
    resets the commit.
  - Gated: the agent's `sendCdp`, the menu's `sendCdpDirect`, `getUaBrands`,
    and FetchRouter's awaited enable in `routeRequests` on an EXISTING tab
    (`RoutedTab.whenReady`). NOT gated: Page.enable/Network.enable at attach,
    `registerTab`'s fire-and-forget Fetch.enable (a popup's first request must
    still be mocked), the dialog handler and the login capture (both imply a
    document; gating could deadlock).
  - `getURL/getTitle/reportNavState` mask the placeholder through the gate's
    exact `isPlaceholderShown()` flag, not a URL compare: an `about:blank`
    opened on purpose is reported as such. The placeholder's history entry is
    removed once a real page commits (also on the dom-ready-only error path),
    then `reportNavState` refreshes `canGoBack`; a failed removal keeps the flag
    and retries on the next navigation event.
  Regression: `e2e/browser-emulate-first-command.spec.ts`.
- DevTools opened from the Browser tools menu coexist with the automation
  debugger on Electron 43 (verified by `e2e/browser-qa-tools.spec.ts`): the
  debugger stays attached and `press`/`hover`/`screenshot`/`assert` keep working.

## Saved logins (Passwords tab, save prompt, `fillLogin`)

The browsing subagent can sign in to a site with a login the user saved in
the built-in browser, without the password ever reaching the model (the agent's
tool schema lives in the backend).

- **Store** — `src/main/browser/credentialStore.ts`, pure and Electron-free
  (cipher and fs injected, like `cursorSettings.ts`). File
  `browser-credentials.json` in `userData`:
  `{ version: 1, entries: [{ id, origin, username, label, password, lastUsedAt? }], never: [host] }`,
  `password` = base64 of `safeStorage.encryptString`. `origin` is normalized
  `scheme://host[:port]` (http/https, lowercase host, no leading `www.`,
  default port dropped; a bare host typed in the Passwords tab means
  https) and matched strictly on scheme + host + port: no subdomain or
  eTLD+1 matching. The `never` list stays hostname-only. The parser accepts
  only this shape (entries without a normalized `origin` are dropped; no
  migration, unreleased). A file that is not valid JSON or has another
  `version` reads as empty and is renamed to
  `browser-credentials.json.bad-<timestamp>` before the first write (kept;
  one log line without content; if the rename fails the write is refused with
  a fixed error). The same set-aside happens when the file has ANY invalid
  entry (or a malformed `never`/`entries` field): the valid entries stay
  usable in memory, the original is kept as `.bad-<ts>` before the first
  write. Only ENOENT on read means "no file"; any other read error (EACCES,
  EIO...) counts as unreadable too (nothing overwrites it). A set-aside rename
  that fails with ENOENT (the file vanished) counts as done and the write
  proceeds. ONE instance, created in `index.ts` (app
  level, like the saved logins) and passed into every `createMainWindow`
  together with the save-prompt state and the Passwords service
  (`LoginServices` in `window.ts`).
- **`browser:command` → `fillLogin`** — `src/main/browser/fillLogin.ts` (pure;
  controller `snapshot`/`perform`/`act`, store and current-URL reader
  injected). Reads the agent tab's URL (http/https only), finds the entry for
  that exact origin (scheme, host, port), takes a fresh snapshot, types into
  the top document's fields only (elements with a `frame` are skipped, so a
  login is never typed into an iframe), then optionally presses Enter via
  `act({action:"press"})`. Field picking uses only what a snapshot element
  really carries (the snapshot has no input `type` for text fields and no
  `autocomplete`; `inputType` exists for checkbox/radio only): `tag`, `ops`
  (a username field offers both `TYPE_TEXT` and `CLICK`), `role`, `options`/
  `expanded`/`checked` (not a plain field), `label`. The origin is re-checked
  before AND after every `perform`, so a mid-fill navigation to another origin
  stops the fill (no further typing, no submit; the fixed error is returned).
  **Known limit:** a cross-origin navigation that lands during the cursor
  animation inside `perform`, before its `insertText`, cannot be fully
  prevented from this layer: the keystrokes of that one call go to whatever
  page is focused then. The re-checks shrink the window to one call; closing
  it needs a check inside the controller, between the animation and the
  insert. The result is ONLY `{ ok, origin, label, filled, submitted, url?, retried?,
  sessionEstablished?, note?, stillOnSignInPage? }` or `{ ok:false, error }`
  with fixed messages; controller results/errors are never passed through.
  There is no wait before the first snapshot. After typing, a second snapshot
  checks that the fields still hold text (a field the app cleared on late
  hydration is typed again once; if the re-read fails or a picked field is
  missing, one fresh snapshot is taken, and if that fails too Enter is NOT
  pressed: `ok`, `submitted:false`). After Enter the page is watched for 3 s;
  a fallback click on the submit button follows only if nothing changed.
  At most TWO submits per call: the first (Enter, maybe the click) and ONE
  retry (retype BOTH fields + Enter only, `retried:true`). The retry runs when
  the form had a password field, the pre-submit ids were confirmed, and the
  watch saw NO reaction: no URL change, no pending load (`isLoading` dep), the
  same form fingerprint at every poll (snapshot elements' tag/label/role/
  disabled/ops plus the snapshot's visible `text`; values, focus and `hasValue`
  are excluded, so a disabled or relabelled button, a new element or a new
  error text counts as a reaction; the act's own `changed` flag does not, it also
  fires for focus moves), the page stayed readable. A cleared password with an unchanged fingerprint is a hydration
  reset, not a reaction. Accepted risks: a wrong password can be submitted twice
  per call, and an XHR response that changes nothing visible within the window
  can cause a second submit; an error message the snapshot text cannot see (shadow
  DOM, out of the viewport, past 6000 chars) is not detected as a reaction. A
  password field that appears after typing (identifier-first form) is typed once
  before Enter; a form whose password was not typed is never retried. Navigation
  and success compare origin + path only (a query or hash change is neither). `url` is origin + path only, with the
  saved username (and an email's local part of 3+ chars) redacted to "…"
  from the path AND the host labels; common names are over-redacted on purpose.
- **Save prompt** — `src/main/browser/loginCapture.ts`. On each main-frame
  `Page.frameNavigated` of a browser tab's existing CDP session, main creates
  an isolated world (`Page.createIsolatedWorld`, name `penLoginCapture`), adds
  the binding to THAT context id (`Runtime.addBinding` with
  `executionContextId`) and runs the script there (a per-tab generation counter
  makes a late result for an older document, from `install()` or an earlier
  `frameNavigated`, discard itself, so it can never overwrite the current
  context id); page scripts cannot see
  the world, the script or the binding. NO `Runtime.enable` (a known
  automation fingerprint; the console-error capture avoids CDP `Runtime` for
  the same reason). Verified on Electron 43: a binding added BY NAME
  (`executionContextName`) plus `addScriptToEvaluateOnNewDocument` yields no
  working binding without `Runtime.enable`, while an explicit-context binding
  does, and `Runtime.bindingCalled` is delivered anyway. CDP commands on a
  tab that has not navigated yet are only answered after its first commit, so
  never `await` them before `loadURL()` (deadlock); `install()` covers the
  first document, `frameNavigated` every later one. The script runs in the
  top frame only, reacts to trusted clicks/Enter and to `submit` with a user
  activation, de-duplicates within 2 s, never captures a form with two or
  more password fields (change-password / sign-up), and is idempotent per
  world. It sends `{ username, password, origin: location.origin }` read at
  submit time. Per tab (`loginCapture.forTab()`), main accepts a binding event
  only if its `executionContextId` equals the isolated-world context it
  created for the tab's current document (the id is cleared on every
  main-frame navigation), and files the login under the payload origin, not
  the tab's later URL. It does not ask at once (a typo is "submitted" too):
  the capture is held in memory and the prompt appears only if a main-frame
  (`Page.frameNavigated`) or same-document (`Page.navigatedWithinDocument`,
  counted for the TOP frame only: its `frameId` must equal the tracked top
  frame id) navigation follows within `HOLD_MS` (5 s); otherwise it is dropped.
  A navigation alone is not success (a wrong password POSTs and reloads the
  login page): once the new document is ready (the check waits for
  `DOMContentLoaded`, bounded by `SETTLE_MS` = 3 s, then asks anyway) the
  isolated world is asked for a visible `input[type=password]` in the top
  document; if one is visible the capture is dropped with no prompt
  (`decideAfterNavigation`, pure); an unanswerable check prompts. For an
  existing entry with another password ("Update password?") the default and
  cancel button is "Not Now". `decideSavePrompt` (pure) skips on never-list,
  identical entry, no encryption, or a prompt already open (one flag for the
  whole app). If the debugger attach
  failed, the feature is off for that tab. `e2e/saved-logins.spec.ts` drives
  it end to end with the native dialog stubbed.
- **Doc pages and logins** — the `@` mention picker of the Markdown pages uses `logins:list` / `logins:add` (see "IPC channels"; rule 4 below states the exception). They are separate from `passwords:*`, which stay Passwords-tab only. Code: `loginsIpc.ts` (pure, `test/loginsIpc.test.ts`), `passwordsApi.listSummaries` / `precheckAdd`, `TabManager.isDocViewer`, wiring in `passwordsService.ts` and `window.ts`.
- **Passwords tab** — `TabKind` `"passwords"`, a SINGLETON per window opened by File ▸ Passwords… (a local action; `TabManager.openPasswordsTab({focus:true})`, like the Settings tab). The tab loads the LOCAL page `dist/passwords/passwords.html` (`loadFile` in `window.ts` `createView`; `TabManager` never calls `loadURL` for it) with `preload/passwords.js` only (NOT `preload/tab.ts`, never a ui URL), `contextIsolation`/`sandbox`, `attachLocalOnlyPolicy`. Title fixed "Passwords", tab icon pen "Key" (like every tab icon), no address row. It is not a page tab (`isPageTab` is false: `settings:open` refuses it), and gets no browser wiring (it shows the window's resolved theme). Tabs are not persisted, so there is no restore path. Service `src/main/passwordsService.ts` (pure, Electron ports injected, `test/passwordsService.test.ts`), `src/passwords/` (plain-script renderer like the tab bar; CSP `default-src 'none'`), `src/preload/passwords.ts`,
  request handling in `browser/passwordsApi.ts`. Site icons are neutral (a
  globe, or the site's icon through `<img>`; CSP adds `img-src data:` only).
  Icons never come from the Passwords tab: `window.ts` listens to
  `page-favicon-updated` on browser tabs and `browser/faviconCache.ts` (pure,
  fs and fetch injected) downloads the FIRST favicon through the
  `persist:penbrowser` session (http/https, image types only, 64 KB, 3 s) for
  origins that have a saved login, keeping data URLs per origin in
  `browser-favicons.json` (200 entries). Each icon is stored with the favicon URL it came from: a page that later
  reports another URL is refetched, a failed fetch of a URL is retried after
  10 minutes (not for the whole run). The icon of an origin goes when its last
  login is removed (`passwordsApi.remove`) and icons of origins without a login
  are filtered out on load. `passwords:list` adds an optional `icon` per entry;
  an icon seen before the login was saved is fetched in the background on the
  next `list`, and every stored icon (that one or one from
  `page-favicon-updated` while the tab is open) sends `passwords:changed`,
  so the row icons update without a manual refresh. The data-URL pattern for icons
  is a single copy, `isIconDataUrl` in `src/passwords/helpers.ts` (main
  `require`s it; the renderer, a plain script, uses it as a global).
  `passwords:add` answers `{ ok:false, exists:true, id }` when a login for the
  same normalized origin + username exists, and replaces its password only
  when the payload carries `replace: true` (the New login form shows an inline
  warning and a "Replace" button first). A save reply that arrives after its
  form was discarded or replaced only refreshes the list data. Copy on encryption is platform-specific (`api.isMac`). 
  In `window.ts`'s debugger `message` handler the login binding
  (`isLoginBindingCall`) is consumed FIRST and returns, before the
  `cdpEventListeners` fan-out: the password-bearing payload reaches nothing
  else (`test/loginBindingRouting.test.ts` pins the order).

Security rules (breaking one is a bug even when the feature works):
1. A password exists as plaintext only in the main process and inside the
   `text` of one `perform` call. Never in a tool result, error, log line,
   IPC reply, window title, dialog text or analytics event. Captured
   passwords live in memory until the user answers the prompt.
2. `passwords:list` returns origin, username, label — never a password. The
   renderer sends a password in (`passwords:add` and `passwords:update`) and never gets it back; both answer `{ ok: true, id }` with the saved entry id only.
3. Fill only into a page whose normalized origin (scheme, host, port)
   equals the entry's, top frame only.
4. A page must not trigger the save flow by itself or read the store: the
   binding exists in the isolated world only, and the script needs trusted
   input or a user activation. The renderer-side store is not reachable
   from any page (no preload on browser tabs). **No exception:** no ui page can list or add logins; only the
   Passwords tab (its own preload and `passwords:*` channels, attached
   webContents only) reaches the store.
5. `fillLogin` returns fixed error strings; do not forward controller text.

## Browser history (address-bar suggestions, History tab)

The built-in browser remembers pages like a real browser: the address field suggests them, a History tab lists them.

- **Store** — `src/main/browser/historyStore.ts` (pure, fs port injected, `test/historyStore.test.ts`). File `browser-history.json` in `userData` (shared by dev and prod, like the browser partition): `{ version: 1, entries: [{ url, title, visitCount, lastVisitedAt }] }`, one entry per URL (key = the URL with its hash removed, `historyKey`), capped at 5000 (oldest `lastVisitedAt` dropped). Writes are debounced (500 ms), tmp + rename, mode 0o600; a corrupt file loads as empty and is not overwritten until the next change. ONE store, created in `index.ts` and passed to every `createMainWindow` (`HistoryServices` in `window.ts`); `load()` runs in the background: every mutation made before it resolves (visit, title, remove, clear) is also queued and replayed IN ORDER onto the file's entries after the read, and no write is scheduled or made while it runs (a slow read can never truncate the file). `flush()` (async) runs on `before-quit`; `will-quit` calls `flushSync()` (`HistoryFs.writeSync`, tmp + rename, 0o600; cancels the debounce; no-op when clean or not loaded), the guarantee that the last visit survives a quit. `history:changed` is coalesced to one per 250 ms per History tab (first send at once, one trailing send).
- **What is recorded** — `window.ts` `createView`, `kind === "browser"` WITHOUT `sessionId`: `did-navigate` and main-frame `did-navigate-in-page` -> `recordVisit(url, Date.now())` (a burst under 1 s counts as one visit), `page-title-updated` -> `setTitle(currentUrl, title)`. An in-page navigation is recorded only when its history key (hash removed) differs from the tab's last recorded key (a hash-only change is not a visit). Pages the agent opens while it drives the browser are not recorded: nothing is recorded or titled while an agent browser command is in flight for the shared scope (`commandsInFlight.active(undefined)`); a navigation the user makes in that window is lost too. Never: isolated session tabs (`qa-*` partitions), non-http(s) urls (the hidden `about:blank` placeholder, the offline `file:` page), urls with `user:pass@`, urls over 2048 chars.
- **Ranking** — `src/main/browser/historySuggest.ts` (pure): empty query = newest 8; otherwise every whitespace token must be a substring of the title or of the URL without scheme and leading `www.`; score = host prefix (+100), URL prefix (+60), title word prefix (+20 per token), plus frecency `log2(1 + visitCount) * 10 / (1 + ageDays / 7)`; ties newest first. `inlineCompletion` completes the top item's host (the whole URL once the typed text has a `/`).
- **Omnibox popup** — a separate hidden `WebContentsView` per main window (`omniboxView` in `window.ts`: `preload/omnibox.js`, page `dist/omnibox/omnibox.html`, `#00000000` background, `attachLocalOnlyPolicy`; the card draws its own radius, so no `setBorderRadius`). A popup inside the tab bar view would be clipped to its height (same reason the menus are native). It is created with the other shell views at window creation, BEFORE the empty view, so `waitForShellViews` (which also waits for `omnibox.html`) guarantees it exists before any `app.evaluate`. The tab bar renderer owns the state (query, items, selection) and all keys (`src/tabbar/omnibox.ts` pure helpers); the popup only paints and reports clicks. `tabbar:omnibox-show` -> main validates, sizes it with `omniboxBounds` (`layout.ts`), re-adds it as the top-most child and sends `omnibox:render`. It hides on `tabbar:omnibox-hide`, window resize/blur, an active tab change (`pushState`), an empty list and a non-browser active tab. A pick navigates the ACTIVE browser tab (`decideBrowserNavigation`), tells the tab bar (`tabbar:omnibox-picked`) and focuses the page. A remove deletes the entry, focuses the tab bar back and sends `tabbar:omnibox-refresh`; the tab bar cancels its 150 ms close timer, restores the typed text and caret and re-runs the query that produced the shown list (empty for Recent). The field is reset to the tab url only when that timer actually closes the popover. Inline completion applies only with the caret at the end of the field; `pushState` re-sends `omnibox:render` only when the theme changed. "Show all history" opens the History tab.
- **History tab** — `TabKind` `"history"`, a SINGLETON per window like Passwords (`TabManager.openHistoryTab({focus:true})`, `findHistoryTab`). Opened by File ▸ History… (a local action: macOS `Cmd+Y`; Windows/Linux `Ctrl+H`, because `Ctrl+Y` is Redo in the Edit menu), the Browser tools "⋮" menu ("Show History") and the popup footer. Loads the LOCAL page `dist/history/history.html` with `preload/history.js` (`window.penHistory`), not the tab preload; `attachLocalOnlyPolicy`. Title fixed "History", no address row, not a page tab. Page `src/history/` (plain script, CSP `default-src 'none'`, tokens from `../tabbar/tokens.css`): search, rows grouped by day, remove per row, "Clear history…" (native `dialog.showMessageBox` on the owning window, Cancel default). A row click opens the url in a NEW user browser tab (activated, focused). Service `src/main/historyService.ts` (pure, ports injected, like `passwordsService.ts`).
- **Tests** — `historyStore`, `historySuggest`, `historyService`, `historySuggestIpc`, `omniboxIpc`, `omnibox` (tab bar key helpers) unit tests; `tabManager.test.ts` ("history tab"), `menu.test.ts`, `browserToolsMenu.test.ts`, `ipcContract.test.ts`; `e2e/browser-history.spec.ts`.

## Ad and tracker blocking

The built-in browser filters ads and trackers, ON by default (setting `adBlock`).

- **Library** — `@ghostery/adblocker-electron` (2.x). `ElectronBlocker.fromPrebuiltAdsAndTracking(net.fetch, caching)` builds the engine from the prebuilt EasyList + EasyPrivacy based lists. The list download uses Electron's `net.fetch` (Chromium networking: system proxy/PAC and the OS certificate store), NOT Node's global `fetch`; `index.ts` wires it in, `adBlock.ts` stays Electron-free (`create` is injected). The serialized engine is cached in `adblock-engine.bin` in `userData` (a missing or corrupt cache is ignored and rewritten). A cache file older than 7 days (mtime) is not read: the engine is built from the network, and if that fails the old cache is used (`loadAdBlockEngine`, fs and clock injected). **Each build attempt is cut off after 30 s** (`ENGINE_LOAD_TIMEOUT_MS`, `withTimeout`), so a hung network settles the load (and the manager's `loading` flag) as a failure; a hung refresh of a stale cache falls back to the old cache. The package is `require()`d lazily after `ready` (`requireRestoringEnv`: importing it sets `ELECTRON_DISABLE_SECURITY_WARNINGS`, which is restored right after). The load runs in the background (`createEngineManager`), only while blocking is on; until it is loaded nothing is blocked.
- **Retry and logging** — a failed load leaves the browser unfiltered and is retried after 10 min, then 30 min, then every 60 min (`ENGINE_RETRY_DELAYS_MS`), on the next time blocking is enabled or from an unref'd timer (only while blocking is on). Only the FIRST failure of a failure streak is logged (one line, `[adblock] ...: reason`); a success ends the streak, the next failure logs again.
- **Refresh while running** — while blocking is on, every 24 h (unref'd timer, `ENGINE_REFRESH_CHECK_MS`) the manager asks `isAdBlockCacheStale` (the cache file's age: a rebuild rewrites it). Older than 7 days: the engine is rebuilt from the network in the background (`loadAdBlockEngine({refresh: true})`: no cache read, no fallback) and swapped in with `setEngine` on success; on failure the old engine stays (the failure is logged under the same once-per-streak rule) and the next check is 24 h later.
- **Network only** — only `session.webRequest.onBeforeRequest` is registered. `enableBlockingInSession` is NEVER called: it registers a preload script and IPC handlers into pages, and browser tabs must stay preload-free (the security boundary, see "Built-in browser tab"). So there are no cosmetic filters. A main-frame document request (`resourceType` `mainFrame`) is never blocked, only subresources.
- **Shared partition only** — `persist:penbrowser`. NOT the isolated QA partitions `qa-*` (a QA run must see the page as the site serves it) and NOT the default (ui) session. Electron keeps one `onBeforeRequest` listener per session; the Fetch routing for fixtures uses CDP `Fetch`, not `webRequest`, so they do not collide.
- **Setting** — `browser-settings.json` in `userData` (`browserSettings.ts`, `{adBlock: true}`; a missing/corrupt file or a wrong type falls back to the default per field; keys of removed settings in an older file are ignored). `store.set` writes the file FIRST: if the write fails it returns `null`, the in-memory value is unchanged and nobody is notified; the IPC answers `{error:"Could not save the setting."}` (the Settings page reverts the switch on `{error}`). ONE store per process, created in `index.ts`; `onChange` registers (`adBlock` on) or unregisters (`onBeforeRequest(null)`) the listener at once. Decisions in `src/main/browser/adBlock.ts` (`createAdBlockController`, Electron session injected). Changed from the Settings page over `browser-settings:*`.
- **Fixtures** — while a PageFixture is applied on the SHARED browser (any window), the request listener passes EVERY request (`shouldBypass`): a fixture may mock a URL a filter list would cancel before CDP Fetch sees it. Each window lends a probe `{fixtureSince, releasing}` to the app-level `FixtureBypassRegistry` (`createFixtureBypassRegistry`, created in `index.ts`, passed to `createMainWindow`): `fixtureSince` is when `FixtureOwners` saw the `applyFixture` start (`activeSince()`), `releasing` is true while any shared release (explicit or orphan, `releaseSharedFixture`) is in flight. **A fixture counts for at most 15 minutes since its apply started** (`FIXTURE_BYPASS_MAX_MS`, injected clock): a shared fixture that is never released must not switch blocking off for the rest of the session; a release in flight always counts. The probe is removed when the window has closed AND the releases that the close started have finished (`awaitSettled`, 30 s at most), so an in-flight orphan release is still covered. So QA asserts on the shared browser see the page filtered when no fixture is applied, and unfiltered during one; isolated `qa-*` sessions are never filtered.
- **`SIDEFORM_LIGHT_NO_ADBLOCK=1`** — skips engine loading entirely (nothing fetched, nothing cached; `isAdBlockDisabledByEnv`, `config.ts`; `1`/`true`/`on`/`yes`). `e2e/userDataIsolation.ts` sets it for every Playwright launch (all three configs), so e2e never hits the network for filter lists.
- **QA diagnostics** — a blocked request arrives as `Network.loadingFailed` with `net::ERR_BLOCKED_BY_CLIENT`; `failedRequests.ts` skips it (like `canceled`), so a blocked tracker is not a page failure.
- **Tests** — `adBlock`, `browserSettings`, `browserSettingsIpc`, `failedRequests`, `config` ("isSettingsPageOn"), `preloadTab`, `ipcContract`.

## Checkpoint journal (`startJournal` / `stopJournal` / `captureCheckpoint`)

`window.penAgentPanel.browser.startJournal(opts?)` / `stopJournal(token?)` /
`captureCheckpoint(token?)` go through `browser:command` and call the
`BrowserController` methods of the same name (`@sideform/browser-agent`
v0.2.16). `startJournal({origins?})` resolves to the owner token (a string), or
`{error}` when another sender is recording; `stopJournal({token})` resolves
to a boolean; `captureCheckpoint({token})` resolves to `CheckpointResult`
(`{ok:true, fixture, complete, gap?, summary}` or `{ok:false, error}`). The
journal lives in the main-process controller (one per window) and records the agent's state-changing steps after the last new
document. Args are untrusted: `src/main/checkpointArgs.ts` accepts `origins`
only as an array of at most 20 strings of at most 512 chars (`[]` is valid,
absent means defaults). Malformed `origins` make `startJournal` return
`{error: "invalid origins"}`. Journal `token` args are a string of at most 512
chars, else ignored; `releaseFixture` passes its token as is.

The checkpoint holds secrets (cookies, storage of the listed origins; default is
the base page's origin only). It is returned to the calling agent panel only,
and the panel keeps it in memory; main never stores or logs it.

Ownership: because the controller is shared, `src/main/journalOwners.ts`
(pure, tested) maps token -> owner webContents id. A start from a sender B while a
live sender A owns a journal is refused without touching the controller; the owner
may restart its own. `stopJournal` and `captureCheckpoint` require a token owned
by the sender, else `false` / `{ok:false, error}`; no tokenless call ever
reaches the controller.

Isolation: a page-changing `browser:command` (all but `snapshot`, `read`,
`screenshot`, `findImages`, `captureCheckpoint`, `stopJournal`,
`startJournal`, and `tabs` with action `list`) from a sender that does not own the
running journal first stops that journal. The owner then gets no checkpoint
(its capture fails) instead of one with another sender's steps. An owner mapping
older than 20 minutes may be taken over by another sender's start; this frees a
lock left by a missed stop.

Orphan stop: the agent panel on reload/crash/close skips its renderer cleanup,
and a running journal costs marker reads on every page-changing command. So
`window.ts` calls `journalOwners.stopOwnedBy(panelId)` in the same places
as `releaseFixture()`: `render-process-gone`, a committed main-frame navigation
(`did-frame-navigate`; also fires on the panel's first load; harmless, it owns
nothing yet), and window close. It stops only the journals the panel
owns, with their tokens.

## Isolated sessions (`browser.isolated(id)` / `browser.closeSession(id)`)

A private browser per QA run so several run at once
without sharing cookies, tabs, fixtures or mocks. The shared browser
(`browser.*` without `isolated`) is unchanged.

- **API** (`src/preload/agentPanel.ts`): `browser.isolated(id)` returns the same methods
  as `browser`, each call adding `session: id` to the `browser:command` payload
  (contextBridge proxies the returned object, e2e-verified). `isolated(undefined)`
  still sends the key, so main rejects it: a lost id never falls back to the
  shared browser. `browser.closeSession(id)` sends `{command: "closeSession", session}`.
- **Every decision is pure** in `src/main/browserSessions.ts` (`window.ts` only
  adapts Electron): id pattern `^[A-Za-z0-9_-]{1,64}$` (key present with a bad
  value is an error, key absent is shared); `planSessionCommand` (what a command
  gets given the session's state: unknown command, foreign, missing, closed,
  live); `PartitionPool`; `BrowserSessions` (ownership, in-flight tracking,
  tombstones, orphan lookup); `ScopeCounter`.
- **Which commands create.** Only `open`, `tabs` with `action: "new"`,
  `applyFixture`, `startJournal`. Any other command on a missing session →
  `{error: "no such browser session"}`; `releaseFixture`/`clearActEmulation`/`stopJournal`/
  `captureCheckpoint` answer naturally (`{ok:true}`, `{ok:true}`, `false`, `{ok:false,error}`
  with the shared `ERR_NO_JOURNAL`). Unknown commands never create. Validation
  happens before any partition is taken.
- **Tombstones.** `closeSession` (also for an id that never existed or is still
  waiting for a slot) remembers the id (tombstones are keyed by (owner panel, id), so one
  owner's close never blocks another owner's id, and are dropped when the owner is
  destroyed, not on reload; cap 10 000, oldest evicted;
  a creation still waiting for a slot is cancelled by the close): every later command →
  `{error: "browser session closed"}` (cleanup commands keep their natural
  answers). A closed id is never recreated; run ids are unique per run.
- **Partition pool (app-global, all windows).** 6 slots `qa-0`..`qa-5`, memory
  only (no `persist:`); `denyAllPermissions` once per slot. A session takes a free
  slot; on close the partition is wiped (`clearStorageData` + `clearCache`) and
  only then the slot returns. Cap = pool size. With no free slot the creating
  command waits FIFO up to 60 s (`SIDEFORM_LIGHT_SESSION_SLOT_WAIT_MS` overrides, for
  tests), then `{error: ERR_TOO_MANY_SESSIONS} ("too many parallel browser sessions: all browser slots stayed busy for 60 s; ...", readable by the model; the call never hangs past SLOT_WAIT_MS)`.
- **Per-session state:** its own `BrowserController` (built by the same
  `makeController` factory as the shared one), `BrowserTarget`, `FetchRouter`
  (a mock never touches another session or the shared tabs) and `JournalOwners`
  (the shared journal guard is skipped). `fresh` clears only that partition.
- **Pending creation counts as existing.** A command arriving while the session is
  still being created waits for it (`stateOf` → `pending`). A throwing create
  releases the slot and gives the creator and every waiter `{error: "could not
  create browser session"}`.
- **One command list.** `src/main/browserCommands.ts` (`BROWSER_COMMANDS`,
  `PAGE_DRIVING_COMMANDS`) feeds the session planner and the agent-activity icon;
  `test/ipcContract.test.ts` pins the `window.ts` dispatch switch and the preload
  to it.
- **Tab scoping.** `TabEntry.session` + a `scope` argument on every browser-tab
  lookup in `TabManager` (undefined = shared). A scope never sees another
  scope's tabs and the agent pin is per scope, so the shared agent cannot drive a
  session tab and vice versa. A popup of a session tab opens in the same session and is loaded through ITS OWN
  handle (it is a background tab, so the active tab is the user's own). `tabs switch` in a session only repoints that session's agent tab (no
  activate/focus). A user click or tab-cycle on a session tab does not repoint the
  session's agent tab (only shared tabs follow the user's focus). Closing the active
  tab never auto-activates a session tab: with only session tabs left the window
  stays at zero active tabs (the empty start shows). Exception: a session tab the agent
  creates while there is NO active tab (the empty start shows) becomes the active tab
  (`planNewTab`; see "Background tabs"); it is pinned and scoped like any session tab, and closing it falls back as usual.
- **Background tabs.** A session tab does not become active while ANOTHER tab is active
  and never gets address-bar focus; the active view keeps focus. It opens `setVisible(false)`.
  Exception (decided): when the window has NO active tab (the empty start is showing), the
  session tab the agent creates becomes the active tab: `shown`, laid out, address row, but with no
  keyboard focus (the agent panel keeps it; if the empty view or a collapsed panel held it, see "Empty start") and no address-bar auto-focus. A SHARED agent tab activates with focus
  as it always did (a page without focus leaves a native `<select>` popup hanging the next command). Later session tabs
  stay background while one is active; a person's click on another tab works as before. While the agent
  drives it, it is awake: visible but under the active tab (see "Awake agent tabs"),
  so it renders and screenshots. After the 60 s hold it hides again. The user clicks
  it to watch. Shared tabs behave as before.
  Limit: on Linux a never-shown view MAY not paint, so `screenshot` of a
  session tab may answer `Screenshot capture failed (empty image).` (`capturePage`
  `stayHidden` does not help). It depends on the Chromium build / compositor, so
  e2e accepts either that exact error or a JPEG on Linux (it flipped on CI on
  2026-10-18 with no change in the screenshot path). macOS always captures it
  and e2e requires the image there.
- **Saved logins work (fill only):** `fillLogin` runs in a session against that
  session's agent tab (`tabs.browserHandle(sessionId)`), so parallel runs can sign
  in under different saved accounts of one site: `label` picks the account by
  label, else by username (case-insensitive; the "unknown label" reply lists
  labels only, never usernames). Save-password capture and the favicon cache are
  still not installed on session tabs. (Changed 2026-10-17; it used to answer
  `saved logins are not available in an isolated session`.)
- **Ownership:** a session belongs to the sender that created it (the agent panel); any other
  sender gets `{error}`.
- **Close** (idempotent; a second `closeSession` returns the SAME promise, resolved
  when teardown finished; `BrowserSessions.close`): the owner is checked first (a
  non-owner closes and tombstones nothing), then tombstone → wait for in-flight
  commands (30 s) → if still running, close the session's tabs FIRST (unblocks stuck
  commands) and wait once more (30 s) → release fixture, stop journal, close tabs and
  wait until every session webContents is really destroyed → `closeAllConnections`,
  `clearStorageData`, `clearCache`, `clearAuthCache`, `clearHostResolverCache`, then
  verify `ses.cookies.get({})` is empty → return the slot. Commands still stuck after
  the second wait, a failed wipe step, a leftover cookie or a failed destroy
  **quarantine the slot** for the rest of the app run (logged); the session itself is
  dropped from the registry (controller and router freed) and does not count in `size`.
  A slot whose deny-all permission policy threw (`SlotUnusableError`) is quarantined
  too: the policy is marked only after it worked. Once closing, a command or popup can
  no longer open a tab for the session (`requireLiveSession`). Orphans (owner
  committed main-frame navigation, `render-process-gone`, destroy) close all the owner's
  sessions, including ones still waiting for a slot (the waiter leaves the pool queue
  and the creating command gets `browser session closed`), next to `releaseFixture`.
- Tests: `test/browserSessions.test.ts`, the scope/background blocks in
  `test/tabManager.test.ts`, `createTabAgentActivity` in `test/agentActivity.test.ts`,
  the `isolated` block in `test/preloadTab.test.ts`, the command check in
  `test/ipcContract.test.ts`, and `e2e/browser-sessions.spec.ts`.

**e2e launch helper.** The window starts with zero tabs and the agent panel loads `/agent` from the stub ui (`e2e/stubUi.ts`, an http server standing in for `ui/dist`; the specs point `SIDEFORM_LIGHT_UI_URL` at it, so no `ui/dist` is needed). Specs that drive the browser launch with `launchShell` (`e2e/launch.ts`: waits for the shell views and the panel page, returns it as `shell.agentPage`); they call `agentPage.evaluate(() => window.penAgentPanel.browser…)`. Specs about the empty start use `electron.launch` directly. `npm run test:e2e` builds with `SIDEFORM_LIGHT_SKIP_UI=1` (see `copy-static`).

**Do not run main-process code (`app.evaluate`) while main may be creating views.** Node's inspector runs an evaluate as a V8 interrupt, in the middle of synchronous main code. If it lands while main constructs a `WebContentsView` (the shell views at launch, or a tab just requested), Electron 43 dies with SIGSEGV, and Playwright reports only "Target page, context or browser has been closed" at the next call. That was the "random test fails at launch" CI flake (2026-10-20, Linux container under load: 10 SIGSEGV in 270 browser-tab tests, every one inside the tab bar's `new WebContentsView`; 0 in 540 after the fix, and 3 full suites green). Rules:
  - After `electron.launch`, call `waitForShellViews(app)` (`e2e/launch.ts`) before any `app.evaluate`. It waits on Playwright's page list and "window" events (CDP, no main-process code) for the tab bar, the empty start and the omnibox popover, returns the tab bar page, and rejects at once if the app exits. `launchShell` does this.
  - Drive the UI from the renderer where you can (`tabbar.evaluate(() => penTabbar.newTab())`), and wait for the new page's "window" event before the next `app.evaluate`.
  - `reportCrashes(app)` prints `Electron pid=… crashed with SIGSEGV`; `launchShell` calls it.
  - Reproduce Linux-only issues in `mcr.microsoft.com/playwright:v1.64.1-noble` with `xvfb-run -a` (run three containers at once: the load makes timing flakes show up).

