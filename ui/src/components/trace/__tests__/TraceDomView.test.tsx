import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOM_AX, SAMPLE_DOM_HTML, sampleTraceWithDomsJson } from "../__fixtures__/sampleTrace";
import { buildDomSrcdoc, domCsp } from "../domSrcdoc";
import { answer, renderTrace, serveDoms, serveSample, stepButton } from "./traceTestUtils";

// The Screenshot / DOM switch: step 3 (index 2) has an html snapshot, step 5 (index 4) an accessibility tree.

const open = async () => {
  renderTrace();
  await screen.findByTestId("trace-frame");
};
const GUARD = (remote: boolean) => `<meta http-equiv="Content-Security-Policy" content="${domCsp(remote)}"><base target="_blank">`;
const domSwitch = () => screen.queryByRole("group", { name: "Page view" });

describe("trace DOM snapshots", () => {
  beforeEach(() => window.history.replaceState(null, "", "/trace/sample-trace-1?src=cloud"));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows no switch and no badge for a trace without snapshots", async () => {
    serveSample();
    await open();
    fireEvent.click(stepButton(3));
    expect(domSwitch()).toBeNull();
    expect(screen.queryByText("DOM")).toBeNull();
  });

  it("shows the switch only on a step with a snapshot, and badges that step", async () => {
    serveDoms();
    await open();
    expect(domSwitch()).toBeNull();
    fireEvent.click(stepButton(3));
    expect(domSwitch()).not.toBeNull();
    expect(screen.getAllByText("DOM", { selector: "span" })).toHaveLength(2);
    fireEvent.click(stepButton(2));
    expect(domSwitch()).toBeNull();
  });

  it("starts on the screenshot and shows the html in an empty sandbox", async () => {
    serveDoms();
    await open();
    fireEvent.click(stepButton(3));
    expect(screen.getByRole("button", { name: "Screenshot" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("dom-frame")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    const frame = (await screen.findByTestId("dom-frame")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.title).toBe("DOM snapshot of step 3");
    const srcdoc = frame.getAttribute("srcdoc")!;
    expect(srcdoc).toBe(GUARD(false) + SAMPLE_DOM_HTML);
    expect(screen.queryByRole("link", { name: /new tab/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Screenshot" }));
    expect(screen.getByTestId("trace-frame")).toBeTruthy();
  });

  it("the toggle widens only img-src, off by default, and the sandbox stays empty", async () => {
    serveDoms();
    await open();
    fireEvent.click(stepButton(3));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    const frame = (await screen.findByTestId("dom-frame")) as HTMLIFrameElement;
    const toggle = screen.getByRole("checkbox", { name: "Load remote images" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(frame.getAttribute("srcdoc")).toContain("img-src data:;");
    fireEvent.click(toggle);
    expect(frame.getAttribute("srcdoc")).toContain("img-src data: https: http:;");
    expect(frame.getAttribute("srcdoc")).not.toContain("script-src");
    expect(frame.getAttribute("sandbox")).toBe("");
  });

  describe("buildDomSrcdoc", () => {
    const csp = "Content-Security-Policy";
    it("puts the guard first in an existing head, ahead of the page's own policy and base", () => {
      const out = buildDomSrcdoc(`<!doctype html><html><head lang="x"><meta http-equiv="${csp}" content="img-src *"><base href="https://evil.test/"></head><body></body></html>`, false);
      expect(out.indexOf(GUARD(false))).toBe(out.indexOf("<head lang=\"x\">") + "<head lang=\"x\">".length);
      expect(out.indexOf(GUARD(false))).toBeLessThan(out.indexOf("img-src *"));
    });
    it("handles a document without a head, with or without a doctype, and does not mistake <header>", () => {
      expect(buildDomSrcdoc("<p>x</p>", false)).toBe(`${GUARD(false)}<p>x</p>`);
      expect(buildDomSrcdoc("<!DOCTYPE html><p>x</p>", true)).toBe(`<!DOCTYPE html>${GUARD(true)}<p>x</p>`);
      expect(buildDomSrcdoc("<header>h</header>", false).startsWith(GUARD(false))).toBe(true);
    });
  });

  it("notes the source step of an accessibility tree taken earlier", async () => {
    const trace = sampleTraceWithDomsJson() as { doms: { stepIndex: number; sourceStepIndex?: number }[] };
    trace.doms[1]!.sourceStepIndex = 2;
    answer({ ok: true, status: 200, json: async () => trace });
    await open();
    fireEvent.click(stepButton(5));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    expect((await screen.findByTestId("dom-ax-source")).textContent).toBe("Accessibility tree from step 3 (no page change since)");
  });

  it("shows an accessibility tree as read-only text", async () => {
    serveDoms();
    await open();
    fireEvent.click(stepButton(5));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    const pre = await screen.findByTestId("dom-ax");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe(SAMPLE_DOM_AX);
    expect(screen.queryByTestId("dom-frame")).toBeNull();
  });

  it("the choice is per snapshot: another step starts on the screenshot", async () => {
    serveDoms();
    await open();
    fireEvent.click(stepButton(3));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    await screen.findByTestId("dom-frame");
    fireEvent.click(stepButton(5));
    await waitFor(() => expect(screen.getByRole("button", { name: "Screenshot" }).getAttribute("aria-pressed")).toBe("true"));
  });
});
