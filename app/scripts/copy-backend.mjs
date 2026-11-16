// Build step after copy-static: copies the bundled local backend (pen-editor-backend `npm run build:local`,
// a `dist-local` dir with server.mjs and its data files) into dist/backend/. The shell forks
// dist/backend/server.mjs at start (src/main/localBackend.ts).
//
//   SIDEFORM_LIGHT_BACKEND_BUNDLE=<dir>  the dist-local dir to copy (must contain server.mjs)
//   SIDEFORM_LIGHT_SKIP_BACKEND=1        skip silently (CI, e2e, ui-only work)
// Neither set: warns and skips, so `npm run build` / `npm start` still work. Packaging refuses an app without
// the bundle (scripts/verify-packaged-deps.cjs).
import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "backend");
rmSync(out, { recursive: true, force: true });

if (process.env.SIDEFORM_LIGHT_SKIP_BACKEND === "1") process.exit(0);

const bundle = process.env.SIDEFORM_LIGHT_BACKEND_BUNDLE;
if (!bundle) {
  console.warn(
    "copy-backend: SIDEFORM_LIGHT_BACKEND_BUNDLE is not set, the local backend is NOT bundled (dist/backend is absent).\n" +
      "The app will run, but without a backend (use SIDEFORM_LIGHT_BACKEND_URL for a dev backend). " +
      "Packaging fails without it. Set SIDEFORM_LIGHT_SKIP_BACKEND=1 to silence this warning.",
  );
  process.exit(0);
}
const src = path.resolve(bundle);
if (!existsSync(path.join(src, "server.mjs")) || !statSync(src).isDirectory()) {
  console.error(`copy-backend: ${src} has no server.mjs. Build it first (pen-editor-backend: npm run build:local).`);
  process.exit(1);
}
cpSync(src, out, { recursive: true });
console.log(`copy-backend: bundled ${src} -> dist/backend`);
