#!/usr/bin/env bash
# One command for local development against the production backend:
#   - the ui runs from its Vite dev server (http://localhost:5174, hot reload),
#   - the Electron shell loads it from there (SIDEFORM_LIGHT_UI_URL, chats go to chats-dev/),
#   - the ui's Vite dev server proxies /api to a backend you run yourself
#     (pen-editor-backend: `npm run dev:local`, on http://localhost:3001; override with BACKEND_URL=...).
# The shell does not start its bundled backend in this mode. Configure the model provider in Settings > Model.
#
# Usage: scripts/dev-prod.sh
#        BACKEND_URL=http://localhost:3002 scripts/dev-prod.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
UI_URL="http://localhost:5174"

for dir in ui app; do
  if [ ! -d "$ROOT/$dir/node_modules" ]; then
    echo "==> npm ci in $dir/"
    (cd "$ROOT/$dir" && npm ci)
  fi
done

# The app holds a single-instance lock (shared with the installed Sideform Light): a second launch only
# focuses the running window and quits, so this script would end at once.
if pgrep -f "Sideform Light.app/Contents/MacOS/|sideform-light/app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" >/dev/null; then
  echo "Sideform Light is already running (installed or dev). Quit it first, then run this script again." >&2
  exit 1
fi

if curl -s -o /dev/null --max-time 2 "$UI_URL"; then
  echo "Port 5174 is already in use. Stop the other ui dev server first." >&2
  exit 1
fi

echo "==> ui dev server on $UI_URL (backend $BACKEND_URL)"
(cd "$ROOT/ui" && VITE_DEV_BACKEND_URL="$BACKEND_URL" exec npm run dev) &
UI_PID=$!

cleanup() {
  kill "$UI_PID" 2>/dev/null || true
  wait "$UI_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 "$UI_URL"; then break; fi
  if ! kill -0 "$UI_PID" 2>/dev/null; then
    echo "The ui dev server exited. See the output above." >&2
    exit 1
  fi
  sleep 0.5
done
if ! curl -s -o /dev/null --max-time 2 "$UI_URL"; then
  echo "The ui dev server did not start on $UI_URL in 30 s." >&2
  exit 1
fi

echo "==> Electron (ui $UI_URL, backend $BACKEND_URL)"
cd "$ROOT/app"
SIDEFORM_LIGHT_SKIP_UI=1 \
SIDEFORM_LIGHT_SKIP_BACKEND=1 \
SIDEFORM_LIGHT_UI_URL="$UI_URL" \
  npm start
