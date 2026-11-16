import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  COOL_DOWN_MS,
  MAX_RESTARTS_PER_MINUTE,
  buildChildEnv,
  createLocalBackend,
  parseReadyMessage,
  unpackedPath,
  type BackendChild,
  type BackendForkOptions,
} from "../src/main/localBackend";

class FakeChild extends EventEmitter implements BackendChild {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("exit", 0));
    return true;
  }
}

/** A manual clock: timers fire only on `advance`. */
function makeClock() {
  let t = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      t += ms;
      for (const [id, tm] of [...timers]) {
        if (tm.at <= t) {
          timers.delete(id);
          tm.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

function setup(over: { exists?: boolean; baseEnv?: NodeJS.ProcessEnv } = {}) {
  const clock = makeClock();
  const children: FakeChild[] = [];
  const forks: { path: string; opts: BackendForkOptions }[] = [];
  const logs: string[] = [];
  const warns: string[] = [];
  let tokenN = 0;
  const backend = createLocalBackend({
    fork: (p, _a, opts) => {
      forks.push({ path: p, opts });
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    bundlePath: "/app/dist/backend/server.mjs",
    dataDir: "/ud/backend",
    baseEnv: over.baseEnv ?? { PATH: "/bin" },
    exists: () => over.exists ?? true,
    ensureDir: () => undefined,
    log: (l) => logs.push(l),
    warn: (l) => warns.push(l),
    newToken: () => `tok${++tokenN}`,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { backend, clock, children, forks, logs, warns };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("buildChildEnv", () => {
  it("copies only the allowlist and sets the local-mode vars; secrets stay out", () => {
    const env = buildChildEnv(
      { PATH: "/bin", HOME: "/h", LC_ALL: "C", LANG: "en", OPENROUTER_API_KEY: "sk", ANTHROPIC_API_KEY: "a", NODE_OPTIONS: "--x", SIDEFORM_LOCAL_TOKEN: "old", PORT: "9" },
      { token: "T", dataDir: "/d" },
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", LC_ALL: "C", LANG: "en", SIDEFORM_LOCAL: "1", HOST: "127.0.0.1", PORT: "0", SIDEFORM_LOCAL_TOKEN: "T", SIDEFORM_LOCAL_DATA_DIR: "/d" });
  });
  it("matches Windows names case-insensitively", () => {
    const env = buildChildEnv({ Path: "C:\\x", SystemRoot: "C:\\Windows", ComSpec: "cmd", USERPROFILE: "u", APPDATA: "a", LOCALAPPDATA: "l", TEMP: "t", Secret: "s" }, { token: "T", dataDir: "d" });
    expect(Object.keys(env)).toEqual(expect.arrayContaining(["Path", "SystemRoot", "ComSpec", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP"]));
    expect(env.Secret).toBeUndefined();
  });
});

describe("parseReadyMessage", () => {
  it("accepts { type: ready, port } only", () => {
    expect(parseReadyMessage({ type: "ready", port: 5123 })).toBe(5123);
    expect(parseReadyMessage({ type: "ready", port: 0 })).toBeNull();
    expect(parseReadyMessage({ type: "ready", port: "5" })).toBeNull();
    expect(parseReadyMessage({ type: "other", port: 5 })).toBeNull();
    expect(parseReadyMessage(null)).toBeNull();
    expect(parseReadyMessage("ready")).toBeNull();
  });
});

describe("unpackedPath", () => {
  it("maps app.asar to app.asar.unpacked only when packaged", () => {
    expect(unpackedPath("/R/app.asar/dist/backend/server.mjs", true)).toBe("/R/app.asar.unpacked/dist/backend/server.mjs");
    expect(unpackedPath("C:\\R\\app.asar\\dist\\backend\\server.mjs", true)).toBe("C:\\R\\app.asar.unpacked\\dist\\backend\\server.mjs");
    expect(unpackedPath("/R/app.asar.unpacked/x", true)).toBe("/R/app.asar.unpacked/x");
    expect(unpackedPath("/w/dist/backend/server.mjs", false)).toBe("/w/dist/backend/server.mjs");
  });
});

describe("createLocalBackend", () => {
  it("forks the bundle with the clean env and resolves whenReady after the ready message", async () => {
    const s = setup({ baseEnv: { PATH: "/bin", OPENROUTER_API_KEY: "sk" } });
    s.backend.start();
    expect(s.forks).toHaveLength(1);
    expect(s.forks[0].path).toBe("/app/dist/backend/server.mjs");
    expect(s.forks[0].opts).toMatchObject({ serviceName: "Sideform Light Backend", stdio: "pipe", cwd: "/ud/backend" });
    expect(s.forks[0].opts.env.OPENROUTER_API_KEY).toBeUndefined();
    expect(s.forks[0].opts.env.SIDEFORM_LOCAL_TOKEN).toBe("tok1");
    const ready = s.backend.whenReady(15_000);
    s.children[0].emit("message", { type: "ready", port: 4567 });
    await expect(ready).resolves.toEqual({ origin: "http://127.0.0.1:4567", token: "tok1" });
    expect(s.backend.state()).toBe("ready");
    await expect(s.backend.whenReady(1)).resolves.toEqual({ origin: "http://127.0.0.1:4567", token: "tok1" });
  });

  it("whenReady times out with null while still starting", async () => {
    const s = setup();
    s.backend.start();
    const ready = s.backend.whenReady(1000);
    s.clock.advance(1000);
    await expect(ready).resolves.toBeNull();
  });

  it("logs child stdout and stderr with a prefix", async () => {
    const s = setup();
    s.backend.start();
    s.children[0].stdout.write("hello\nSIDEFORM_LOCAL_READY port=1\n");
    s.children[0].stderr.write("oops\n");
    await tick();
    expect(s.logs).toEqual(["[backend] hello", "[backend] SIDEFORM_LOCAL_READY port=1"]);
    expect(s.warns).toContain("[backend] oops");
  });

  it("stays unavailable without a bundle, logs once and does not fork", async () => {
    const s = setup({ exists: false });
    s.backend.start();
    s.backend.start();
    expect(s.forks).toHaveLength(0);
    expect(s.warns.filter((w) => w.includes("bundle not found"))).toHaveLength(1);
    await expect(s.backend.whenReady(15_000)).resolves.toBeNull();
    expect(s.backend.state()).toBe("unavailable");
  });

  it("kills a child that sends no ready message in 20 s and restarts it", async () => {
    const s = setup();
    s.backend.start();
    s.clock.advance(20_000);
    expect(s.children[0].killed).toBe(true);
    await tick();
    s.clock.advance(500);
    expect(s.forks).toHaveLength(2);
    expect(s.forks[1].opts.env.SIDEFORM_LOCAL_TOKEN).toBe("tok2");
  });

  it("restarts after an unexpected exit with a new token; whenReady waits through the restart", async () => {
    const s = setup();
    s.backend.start();
    s.children[0].emit("message", { type: "ready", port: 1111 });
    s.children[0].emit("exit", 1);
    expect(s.backend.state()).toBe("starting");
    const ready = s.backend.whenReady(15_000);
    s.clock.advance(500);
    expect(s.forks).toHaveLength(2);
    s.children[1].emit("message", { type: "ready", port: 2222 });
    await expect(ready).resolves.toEqual({ origin: "http://127.0.0.1:2222", token: "tok2" });
  });

  it("gives up after 3 restarts in a minute and stays unavailable", async () => {
    const s = setup();
    s.backend.start();
    for (let i = 0; i < MAX_RESTARTS_PER_MINUTE; i++) {
      s.children[i].emit("exit", 1);
      s.clock.advance(10_000);
      expect(s.forks).toHaveLength(i + 2);
    }
    const waiting = s.backend.whenReady(15_000);
    s.children[MAX_RESTARTS_PER_MINUTE].emit("exit", 1);
    await expect(waiting).resolves.toBeNull();
    expect(s.backend.state()).toBe("unavailable");
    s.clock.advance(60_000);
    expect(s.forks).toHaveLength(MAX_RESTARTS_PER_MINUTE + 1);
  });

  it("stays down for the cool-down, then the next whenReady starts it again with a fresh restart budget", async () => {
    const s = setup();
    s.backend.start();
    for (let i = 0; i < MAX_RESTARTS_PER_MINUTE; i++) {
      s.children[i].emit("exit", 1);
      s.clock.advance(10_000);
    }
    s.children[MAX_RESTARTS_PER_MINUTE].emit("exit", 1);
    expect(s.backend.state()).toBe("unavailable");
    const forksAtGiveUp = s.forks.length;

    s.clock.advance(COOL_DOWN_MS - 1);
    await expect(s.backend.whenReady(1_000)).resolves.toBeNull();
    expect(s.forks).toHaveLength(forksAtGiveUp);

    s.clock.advance(1);
    const ready = s.backend.whenReady(15_000);
    expect(s.forks).toHaveLength(forksAtGiveUp + 1);
    expect(s.backend.state()).toBe("starting");
    s.children[forksAtGiveUp].emit("message", { type: "ready", port: 5000 });
    await expect(ready).resolves.toMatchObject({ origin: "http://127.0.0.1:5000" });

    // A fresh budget: it survives MAX_RESTARTS_PER_MINUTE more crashes before giving up again.
    for (let i = 0; i < MAX_RESTARTS_PER_MINUTE; i++) {
      s.children[forksAtGiveUp + i].emit("exit", 1);
      s.clock.advance(10_000);
      expect(s.backend.state()).toBe("starting");
    }
    s.children[forksAtGiveUp + MAX_RESTARTS_PER_MINUTE].emit("exit", 1);
    expect(s.backend.state()).toBe("unavailable");
  });

  it("does not restart after stop(), even past the cool-down", async () => {
    const s = setup();
    s.backend.start();
    s.backend.stop();
    await tick();
    s.clock.advance(COOL_DOWN_MS + 1);
    await expect(s.backend.whenReady(1)).resolves.toBeNull();
    expect(s.forks).toHaveLength(1);
  });

  it("forgets restarts older than a minute", async () => {
    const s = setup();
    s.backend.start();
    for (let i = 0; i < 6; i++) {
      s.children[i].emit("exit", 1);
      s.clock.advance(30_000);
      expect(s.backend.state()).toBe("starting");
    }
    expect(s.forks).toHaveLength(7);
  });

  it("stop kills the child, cancels restarts and releases waiters", async () => {
    const s = setup();
    s.backend.start();
    const waiting = s.backend.whenReady(15_000);
    s.backend.stop();
    expect(s.children[0].killed).toBe(true);
    await expect(waiting).resolves.toBeNull();
    await tick();
    s.clock.advance(60_000);
    expect(s.forks).toHaveLength(1);
    expect(s.clock.pending()).toBe(0);
  });

  it("is unavailable when fork throws", async () => {
    const clock = makeClock();
    const warns: string[] = [];
    const backend = createLocalBackend({
      fork: () => {
        throw new Error("boom");
      },
      bundlePath: "/b",
      dataDir: "/d",
      baseEnv: {},
      exists: () => true,
      ensureDir: () => undefined,
      warn: (l) => warns.push(l),
      ...clock,
      setTimer: clock.setTimer,
    });
    backend.start();
    await expect(backend.whenReady(1)).resolves.toBeNull();
    expect(warns.join()).toContain("boom");
  });
});
