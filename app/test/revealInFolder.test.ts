import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { parseTabMenuPayload, revealInFolder, revealMenuLabel, revealTargetFor, type RevealPorts } from "../src/main/revealInFolder";

const dirs = { traces: "/u/browse-traces" };

describe("revealMenuLabel", () => {
  it("is per platform", () => {
    expect(revealMenuLabel("darwin")).toBe("Reveal in Finder");
    expect(revealMenuLabel("win32")).toBe("Show in Explorer");
    expect(revealMenuLabel("linux")).toBe("Show in Folder");
  });
});

describe("revealTargetFor", () => {
  it("builds the trace paths", () => {
    expect(revealTargetFor({ kind: "trace", id: "t1" }, dirs)).toEqual({
      file: path.join("/u/browse-traces", "t1", "trace.json"),
      dir: path.join("/u/browse-traces", "t1"),
    });
  });
  it("returns null for an invalid id", () => {
    for (const id of ["../x", "", "a/b", "a b", "x".repeat(65)]) {
      expect(revealTargetFor({ kind: "trace", id }, dirs)).toBeNull();
    }
  });
  it("returns null for a kind that no longer exists", () => {
    expect(revealTargetFor({ kind: "canvas", id: "cv_1" } as never, dirs)).toBeNull();
  });
});

describe("revealInFolder", () => {
  function ports(existing: string[]) {
    return {
      exists: vi.fn(async (p: string) => existing.includes(p)),
      showItemInFolder: vi.fn((_p: string) => {}),
      openPath: vi.fn(async (_p: string) => ""),
      warn: vi.fn((_m: string) => {}),
    } satisfies RevealPorts;
  }
  const traceDir = path.join("/u/browse-traces", "t1");
  const file = path.join(traceDir, "trace.json");

  it("shows the file when it exists", async () => {
    const p = ports([file, traceDir]);
    await revealInFolder({ kind: "trace", id: "t1" }, dirs, p);
    expect(p.showItemInFolder).toHaveBeenCalledWith(file);
    expect(p.openPath).not.toHaveBeenCalled();
  });
  it("opens the directory when the file is missing (a save in progress)", async () => {
    const p = ports([traceDir]);
    await revealInFolder({ kind: "trace", id: "t1" }, dirs, p);
    expect(p.showItemInFolder).not.toHaveBeenCalled();
    expect(p.openPath).toHaveBeenCalledWith(traceDir);
  });
  it("warns when openPath reports an error", async () => {
    const p = ports([traceDir]);
    p.openPath.mockResolvedValue("boom");
    await revealInFolder({ kind: "trace", id: "t1" }, dirs, p);
    expect(p.warn).toHaveBeenCalled();
  });
  it("does nothing, with a warning, when neither exists", async () => {
    const p = ports([]);
    await revealInFolder({ kind: "trace", id: "t1" }, dirs, p);
    expect(p.showItemInFolder).not.toHaveBeenCalled();
    expect(p.openPath).not.toHaveBeenCalled();
    expect(p.warn).toHaveBeenCalledTimes(1);
  });
  it("does nothing for an invalid id", async () => {
    const p = ports([traceDir]);
    await revealInFolder({ kind: "trace", id: "../etc" }, dirs, p);
    expect(p.exists).not.toHaveBeenCalled();
    expect(p.warn).toHaveBeenCalled();
  });
  it("never throws", async () => {
    const p = ports([]);
    p.exists.mockRejectedValue(new Error("io"));
    p.warn.mockImplementation(() => {
      throw new Error("log");
    });
    await expect(revealInFolder({ kind: "trace", id: "t1" }, dirs, p)).resolves.toBeUndefined();
    const q = ports([file]);
    q.showItemInFolder.mockImplementation(() => {
      throw new Error("shell");
    });
    await expect(revealInFolder({ kind: "trace", id: "t1" }, dirs, q)).resolves.toBeUndefined();
  });
});

describe("parseTabMenuPayload", () => {
  it("accepts an id with finite coordinates and rounds them", () => {
    expect(parseTabMenuPayload({ id: 3, x: 10.4, y: 20.6 })).toEqual({ id: 3, x: 10, y: 21 });
  });
  it("rejects anything else", () => {
    for (const bad of [null, undefined, 5, "x", {}, { id: "3", x: 1, y: 1 }, { id: 1.5, x: 1, y: 1 }, { id: 1, x: NaN, y: 1 }, { id: 1, x: 1, y: Infinity }, { id: 1, x: 1 }]) {
      expect(parseTabMenuPayload(bad)).toBeNull();
    }
  });
});
