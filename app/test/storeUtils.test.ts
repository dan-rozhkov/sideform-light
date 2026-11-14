import { describe, expect, it, vi } from "vitest";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createKeyedChain, nodeStoreFs, renameWithRetry, renameWithRetrySync, STALE_TMP_MS, sweepStaleTmp, writeFileAtomic, writeFileAtomicSync } from "../src/main/storeUtils";

describe("createKeyedChain", () => {
  it("runs tasks of one key in order, even when an earlier one rejects", async () => {
    const serialized = createKeyedChain();
    const order: string[] = [];
    const a = serialized("k", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("a");
      throw new Error("a failed");
    });
    const b = serialized("k", async () => void order.push("b"));
    await expect(a).rejects.toThrow("a failed");
    await b;
    expect(order).toEqual(["a", "b"]);
  });

  it("different keys do not wait for each other", async () => {
    const serialized = createKeyedChain();
    const order: string[] = [];
    const slow = serialized("x", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("slow");
    });
    await serialized("y", async () => void order.push("fast"));
    await slow;
    expect(order).toEqual(["fast", "slow"]);
  });
});

describe("sweepStaleTmp", () => {
  it("removes only old .tmp files and logs a failing removal", async () => {
    const removed: string[] = [];
    const io = {
      read: vi.fn(),
      write: vi.fn(),
      listFiles: vi.fn(),
      remove: vi.fn(async (p: string) => {
        if (p.endsWith("bad.tmp")) throw new Error("denied");
        removed.push(p);
      }),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const now = 10 * STALE_TMP_MS;
    await sweepStaleTmp(
      io,
      "/r",
      [
        { name: "old.tmp", mtimeMs: now - STALE_TMP_MS - 1 },
        { name: "fresh.tmp", mtimeMs: now - 1000 },
        { name: "a.json", mtimeMs: 0 },
        { name: "bad.tmp", mtimeMs: 0 },
      ],
      () => now,
      "store",
    );
    expect(removed).toEqual(["/r/old.tmp"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("store: could not sweep bad.tmp"));
    spy.mockRestore();
  });
});

const errno = (code: string) => Object.assign(new Error(code), { code });

describe("renameWithRetry", () => {
  it("retries EPERM/EBUSY/EACCES and then succeeds", async () => {
    const codes = ["EPERM", "EBUSY", "EACCES"];
    const rename = vi.fn(async () => {
      const c = codes.shift();
      if (c) throw errno(c);
    });
    const sleep = vi.fn(async () => undefined);
    await renameWithRetry(rename, "a", "b", sleep);
    expect(rename).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("gives up after 5 tries with the last error", async () => {
    const rename = vi.fn(async () => {
      throw errno("EBUSY");
    });
    await expect(renameWithRetry(rename, "a", "b", async () => undefined)).rejects.toMatchObject({ code: "EBUSY" });
    expect(rename).toHaveBeenCalledTimes(5);
  });

  it("does not retry other errors", async () => {
    const rename = vi.fn(async () => {
      throw errno("ENOSPC");
    });
    await expect(renameWithRetry(rename, "a", "b", async () => undefined)).rejects.toMatchObject({ code: "ENOSPC" });
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("sync twin: retries then succeeds, fails fast on other codes, gives up after 5", () => {
    let n = 0;
    const flaky = vi.fn(() => {
      if (n++ < 2) throw errno("EPERM");
    });
    const wait = vi.fn();
    renameWithRetrySync(flaky, "a", "b", wait);
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    const other = vi.fn(() => {
      throw errno("EIO");
    });
    expect(() => renameWithRetrySync(other, "a", "b", wait)).toThrow("EIO");
    expect(other).toHaveBeenCalledTimes(1);
    const busy = vi.fn(() => {
      throw errno("EACCES");
    });
    expect(() => renameWithRetrySync(busy, "a", "b", wait)).toThrow("EACCES");
    expect(busy).toHaveBeenCalledTimes(5);
  });
});

describe("writeFileAtomic options", () => {
  it("nodeStoreFs.write does not chmod and does not set a directory mode; the opt-in does", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "atomic-"));
    try {
      const chmodAsync = vi.spyOn(fsp, "chmod");
      await nodeStoreFs.write(path.join(dir, "sub", "a.json"), Buffer.from("x"));
      expect(chmodAsync).not.toHaveBeenCalled();
      expect((await fsp.readFile(path.join(dir, "sub", "a.json"))).toString()).toBe("x");
      await writeFileAtomic(path.join(dir, "b.json"), "y", { chmod: true, dirMode: 0o700 });
      expect(chmodAsync).toHaveBeenCalledTimes(2);
      chmodAsync.mockRestore();
      writeFileAtomicSync(path.join(dir, "c.json"), "z", { chmod: true });
      expect((await fsp.readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
