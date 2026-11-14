import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleTraceJson } from "@/components/trace/__fixtures__/sampleTrace";
import { loadBrowseTrace, traceSourceFromParam } from "../browseTraceLoad";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("traceSourceFromParam", () => {
  it("is always local: Light has no cloud traces", () => {
    expect(traceSourceFromParam("local")).toBe("local");
    expect(traceSourceFromParam("cloud")).toBe("local");
    expect(traceSourceFromParam(null)).toBe("local");
  });
});

describe("loadBrowseTrace (local)", () => {
  it("reports a missing desktop bridge", async () => {
    expect(await loadBrowseTrace("x", "local")).toMatchObject({ ok: false, reason: "no-bridge" });
  });

  it("validates the trace the bridge returns", async () => {
    const read = vi.fn(async () => ({ trace: sampleTraceJson() }));
    (window as unknown as { penDesktop: unknown }).penDesktop = { traces: { read } };
    expect(await loadBrowseTrace("sample-trace-1", "local")).toMatchObject({ ok: true });
    expect(read).toHaveBeenCalledWith("sample-trace-1");
  });

  it.each([
    [{ error: "Trace not found" }, "not-found"],
    [{ error: "disk failure" }, "error"],
    [{ nope: 1 }, "invalid"],
    [{ trace: { format: "x" } }, "invalid"],
  ])("maps %j to %s", async (answer, reason) => {
    (window as unknown as { penDesktop: unknown }).penDesktop = { traces: { read: async () => answer } };
    expect(await loadBrowseTrace("x", "local")).toMatchObject({ ok: false, reason });
  });
});
