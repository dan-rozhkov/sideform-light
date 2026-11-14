// Drives an installed Sideform Light over CDP: screenshots of every page, then one agent task.
// Usage: node drive.mjs <outDir> <task>
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { openSync } from "node:fs";

const [outDir, task, appExe] = process.argv.slice(2);
// The app is started here, not in an earlier step: the runner kills a step's processes when the step ends.
const app = spawn(appExe, ["--remote-debugging-port=9333"], {
  stdio: ["ignore", openSync(`${outDir}/app-stdout.log`, "w"), openSync(`${outDir}/app-stderr.log`, "w")],
});
app.on("exit", (code) => console.log("APP EXITED", code));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const desktop = (name) => {
  try {
    execFileSync("powershell", ["-NoProfile", "-File", ".github/smoke/screen.ps1", `${outDir}/${name}.png`], { stdio: "inherit" });
  } catch (e) {
    console.log("desktop screenshot failed", e.message);
  }
};

let browser;
for (let i = 0; i < 60 && !browser; i++) {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 }).catch((e) => {
    console.log("connect attempt", i, String(e.message).split("\n")[0]);
    return null;
  });
  if (!browser) await sleep(1000);
}
if (!browser) throw new Error("app did not open CDP port 9333");
const pages = () => browser.contexts().flatMap((c) => c.pages());
let panel;
for (let i = 0; i < 30 && !panel; i++) {
  panel = pages().find((p) => p.url().includes("/agent"));
  if (!panel) await sleep(1000);
}
if (!panel) throw new Error("agent panel not found: " + pages().map((p) => p.url()).join(", "));
panel.on("response", (r) => r.url().includes("onrender.com") && console.log("RESP", r.status(), r.request().method(), r.url()));
panel.on("requestfailed", (r) => console.log("FAILED", r.url(), r.failure()?.errorText));
await panel.waitForSelector("textarea");
await sleep(3000);
desktop("1-start-desktop");
await panel.screenshot({ path: `${outDir}/1-start-panel.png` });

await panel.fill("textarea", task);
await panel.keyboard.press("Enter");
const t0 = Date.now();
let shot = 0;
while (Date.now() - t0 < 180000) {
  await sleep(10000);
  const busy = await panel.evaluate(() => !!document.querySelector('button[aria-label*="Stop" i]'));
  if (shot < 3) {
    shot++;
    desktop(`2-running-${shot}-desktop`);
    for (const [i, p] of pages().filter((p) => /^https?:/.test(p.url())).entries()) {
      await p.screenshot({ path: `${outDir}/2-running-${shot}-tab${i}.png` }).catch(() => {});
    }
  }
  if (!busy && Date.now() - t0 > 15000) break;
}
desktop("3-done-desktop");
await panel.screenshot({ path: `${outDir}/3-done-panel.png` });
console.log("PANEL TEXT:\n" + (await panel.innerText("body")).slice(0, 3000));
await browser.close();
app.kill();
process.exit(0);
