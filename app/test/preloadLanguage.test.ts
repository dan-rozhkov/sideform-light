import { beforeEach, describe, expect, it, vi } from "vitest";

// The language reporters of the panel and ui-tab preloads: they watch `<html lang>` (the ui sets it to its active code) and
// send `panel:language` / `tab:language`, only a supported code and only when it changes. Mocked "electron" and a stubbed
// document, like preloadTab.test.ts.

const sendMock = vi.fn();
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { send: sendMock, on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn() },
}));

interface Observed {
  callback: () => void;
  filter: string[];
}
let observers: Observed[] = [];
let lang: string | null = null;
let classes: string[] = [];
let domReady: (() => void)[] = [];

class FakeObserver {
  constructor(private readonly callback: () => void) {}
  observe(_el: unknown, opts: { attributeFilter: string[] }) {
    observers.push({ callback: this.callback, filter: opts.attributeFilter });
  }
}

const g = globalThis as unknown as Record<string, unknown>;

function stubDom(): void {
  const root = { classList: { contains: (c: string) => classes.includes(c) }, getAttribute: (n: string) => (n === "lang" ? lang : null) };
  const win: Record<string, unknown> = {
    addEventListener: (type: string, cb: () => void) => {
      if (type === "DOMContentLoaded") domReady.push(cb);
    },
  };
  win.top = win;
  g.window = win;
  g.document = {
    documentElement: root,
    addEventListener: (type: string, cb: () => void) => {
      if (type === "DOMContentLoaded") domReady.push(cb);
    },
  };
  g.MutationObserver = FakeObserver;
}

async function load(file: "tab" | "agentPanel", initialClasses: string[] = []): Promise<void> {
  vi.resetModules();
  sendMock.mockClear();
  observers = [];
  domReady = [];
  lang = "en"; // the static <html lang="en"> of the ui's index.html
  classes = initialClasses;
  stubDom();
  if (file === "tab") await import("../src/preload/tab");
  else await import("../src/preload/agentPanel");
}

const languageObserver = (): Observed => observers.find((o) => o.filter.includes("lang"))!;
const sent = (channel: string): unknown[] => sendMock.mock.calls.filter((c) => c[0] === channel).map((c) => c[1]);

describe.each([
  ["tab", "tab:language"],
  ["agentPanel", "panel:language"],
] as const)("preload/%s language reporter", (file, channel) => {
  beforeEach(() => load(file));

  it("does not report the static placeholder before the page is ready, then reports the ui's code once", () => {
    expect(sent(channel)).toEqual([]);
    lang = "ru";
    for (const cb of domReady) cb();
    expect(sent(channel)).toEqual(["ru"]);
  });

  it("observes only the lang attribute for it and reports each real change, not repeats", () => {
    lang = "ru";
    for (const cb of domReady) cb();
    const obs = languageObserver();
    expect(obs.filter).toEqual(["lang"]);
    obs.callback();
    expect(sent(channel)).toEqual(["ru"]);
    lang = "de";
    obs.callback();
    lang = "de";
    obs.callback();
    lang = "en";
    obs.callback();
    expect(sent(channel)).toEqual(["ru", "de", "en"]);
  });

  it("ignores unsupported and empty codes", () => {
    for (const cb of domReady) cb();
    const obs = languageObserver();
    for (const bad of ["", "xx", "ru-RU", "RU", "es", null]) {
      lang = bad;
      obs.callback();
    }
    expect(sent(channel)).toEqual(["en"]);
  });

  it("keeps the theme reporter on its own channel", async () => {
    await load(file, ["dark"]);
    for (const cb of domReady) cb();
    expect(sent(file === "tab" ? "tab:theme" : "panel:theme")).toEqual(["dark"]);
  });
});
