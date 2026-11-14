// Build step after `tsc`: copies the shell's static pages next to the compiled main/preload code
// (dist/tabbar, dist/passwords, dist/history, dist/omnibox) and the bundled ui (../ui/dist -> dist/ui).
//
// The ui is mandatory: a build without it would start an app whose agent panel is a 404. When ../ui/dist is
// missing the script fails with a clear message. SIDEFORM_LIGHT_SKIP_UI=1 is the explicit opt-out for tests
// and CI that serve the ui from a stub or the Vite dev server (SIDEFORM_LIGHT_UI_URL); it is never implied.
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const files = {
  tabbar: ["tabbar.html", "tabbar.css", "empty.html", "empty.css", "tokens.css"],
  passwords: ["passwords.html", "passwords.css"],
  history: ["history.html", "history.css"],
  omnibox: ["omnibox.html", "omnibox.css"],
};
for (const [dir, names] of Object.entries(files)) {
  mkdirSync(path.join(dist, dir), { recursive: true });
  for (const name of names) cpSync(path.join(root, "src", dir, name), path.join(dist, dir, name));
}

// The backend URL of this build. The main process reads it at start, because a released app has no env var
// and its CSP must allow the backend that the ui was built against (VITE_DESIGN_AGENT_BACKEND_URL).
writeFileSync(
  path.join(dist, "build-config.json"),
  JSON.stringify({ backendUrl: process.env.SIDEFORM_LIGHT_BACKEND_URL || null }, null, 2) + "\n",
);

const uiDist = path.resolve(root, "..", "ui", "dist");
const uiOut = path.join(dist, "ui");
rmSync(uiOut, { recursive: true, force: true });
if (process.env.SIDEFORM_LIGHT_SKIP_UI === "1") {
  console.warn("copy-static: SIDEFORM_LIGHT_SKIP_UI=1, the ui is NOT bundled (dist/ui is absent).");
} else if (!existsSync(path.join(uiDist, "index.html")) || !statSync(uiDist).isDirectory()) {
  console.error(
    `copy-static: ${uiDist} is missing or has no index.html.\n` +
      "Build the ui first (cd ../ui && npm run build), or set SIDEFORM_LIGHT_SKIP_UI=1 to build the shell without it " +
      "(only for tests and for running against a ui dev server).",
  );
  process.exit(1);
} else {
  cpSync(uiDist, uiOut, { recursive: true });
}
