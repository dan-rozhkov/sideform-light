import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANGUAGE_FILE, createLanguageState, type LanguageFs } from "../src/main/i18n/languageState";
import { isPanelLanguageSender, isTabLanguageSender } from "../src/main/i18n/languageIpc";

function memoryFs(initial?: string): LanguageFs & { text: string | null; writes: string[] } {
  const fs = {
    text: initial ?? null,
    writes: [] as string[],
    readText: () => fs.text,
    writeText: (_p: string, text: string) => {
      fs.writes.push(text);
      fs.text = text;
    },
  };
  return fs;
}
const make = (fs: LanguageFs, over: Partial<Parameters<typeof createLanguageState>[0]> = {}) =>
  createLanguageState({ filePath: "/x/ui-language.json", systemTags: () => ["en-US"], fs, ...over });

describe("language state: initial language", () => {
  it("is the persisted language first", () => {
    expect(make(memoryFs('{"language":"de"}'), { forced: "fr", systemTags: () => ["ru-RU"] }).get()).toBe("de");
  });

  it("is the forced language (SIDEFORM_LIGHT_LANGUAGE) when nothing is persisted", () => {
    expect(make(memoryFs(), { forced: "it", systemTags: () => ["ru-RU"] }).get()).toBe("it");
  });

  it("ignores an unsupported forced value and detects the system language", () => {
    expect(make(memoryFs(), { forced: "xx", systemTags: () => ["ru-RU", "en"] }).get()).toBe("ru");
  });

  it("is English when the system language is unsupported", () => {
    expect(make(memoryFs(), { systemTags: () => ["ja-JP"] }).get()).toBe("en");
  });

  it("ignores a corrupt or wrong-shaped file", () => {
    for (const text of ["", "not json", "null", "[]", '{"language":"es"}', '{"language":5}', '{"lang":"ru"}']) {
      expect(make(memoryFs(text), { systemTags: () => ["fr"] }).get(), text).toBe("fr");
    }
  });
});

describe("language state: set", () => {
  it("persists a change, notifies once and returns true", () => {
    const fs = memoryFs();
    const state = make(fs);
    const cb = vi.fn();
    state.onChange(cb);
    expect(state.set("ru")).toBe(true);
    expect(state.get()).toBe("ru");
    expect(cb).toHaveBeenCalledExactlyOnceWith("ru");
    expect(JSON.parse(fs.text!)).toEqual({ language: "ru" });
  });

  it("ignores unsupported codes and non-strings", () => {
    const fs = memoryFs();
    const state = make(fs);
    const cb = vi.fn();
    state.onChange(cb);
    for (const bad of ["es", "RU", "ru-RU", "", null, undefined, 3, {}, ["ru"]]) expect(state.set(bad), String(bad)).toBe(false);
    expect(state.get()).toBe("en");
    expect(cb).not.toHaveBeenCalled();
    expect(fs.writes).toEqual([]);
  });

  it("does nothing (no write, no event) for the current language", () => {
    const fs = memoryFs();
    const state = make(fs);
    const cb = vi.fn();
    state.onChange(cb);
    expect(state.set("en")).toBe(false);
    state.set("de");
    expect(state.set("de")).toBe(false);
    expect(fs.writes).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a failed write keeps the language for this run and still notifies", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const state = make({ readText: () => null, writeText: () => { throw new Error("disk full"); } });
    const cb = vi.fn();
    state.onChange(cb);
    expect(state.set("fr")).toBe(true);
    expect(state.get()).toBe("fr");
    expect(cb).toHaveBeenCalledWith("fr");
    err.mockRestore();
  });

  it("a throwing listener does not stop the others; unsubscribe works", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const state = make(memoryFs());
    const second = vi.fn();
    state.onChange(() => { throw new Error("boom"); });
    const off = state.onChange(second);
    state.set("ru");
    expect(second).toHaveBeenCalledTimes(1);
    off();
    state.set("de");
    expect(second).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it("a second state over the same file starts in the saved language", () => {
    const fs = memoryFs();
    make(fs).set("it");
    expect(make(fs, { forced: "ru" }).get()).toBe("it");
  });
});

describe("language state on a real directory", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("writes <dir>/ui-language.json atomically (no temp file left) and reads it back", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lang-"));
    dirs.push(dir);
    const filePath = path.join(dir, LANGUAGE_FILE);
    const state = createLanguageState({ filePath, systemTags: () => [] });
    expect(state.get()).toBe("en");
    state.set("fr");
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ language: "fr" });
    expect(readdirSync(dir)).toEqual([LANGUAGE_FILE]);
    expect(createLanguageState({ filePath, systemTags: () => ["ru"] }).get()).toBe("fr");
    writeFileSync(filePath, "garbage");
    expect(createLanguageState({ filePath, systemTags: () => ["ru"] }).get()).toBe("ru");
  });
});

describe("language senders", () => {
  const PANEL = "app://sideform/agent";
  const ev = (id: number, url: string | undefined, top = true) => {
    const mainFrame = { url };
    return { sender: { id, mainFrame }, senderFrame: url === undefined ? null : top ? mainFrame : { url } };
  };

  it("panel:language only from the panel's own webContents on the panel page", () => {
    expect(isPanelLanguageSender(ev(7, PANEL), 7, PANEL)).toBe(true);
    expect(isPanelLanguageSender(ev(7, "app://sideform/agent/c/1"), 7, PANEL)).toBe(true);
    expect(isPanelLanguageSender(ev(8, PANEL), 7, PANEL)).toBe(false);
    expect(isPanelLanguageSender(ev(7, "app://sideform/settings"), 7, PANEL)).toBe(false);
    expect(isPanelLanguageSender(ev(7, "https://evil.example/agent"), 7, PANEL)).toBe(false);
    expect(isPanelLanguageSender(ev(7, undefined), 7, PANEL)).toBe(false);
  });

  const UI = "app://sideform";
  const isUiTab = (id: number) => id === 11;

  it("tab:language only from the top frame of a ui tab on the ui origin", () => {
    expect(isTabLanguageSender(ev(11, "app://sideform/settings"), isUiTab, UI)).toBe(true);
    expect(isTabLanguageSender(ev(11, "app://sideform/trace/abc?src=local"), isUiTab, UI)).toBe(true);
  });

  it("rejects a subframe, another webContents, another origin and a vanished frame", () => {
    expect(isTabLanguageSender(ev(11, "app://sideform/settings", false), isUiTab, UI)).toBe(false);
    expect(isTabLanguageSender(ev(12, "app://sideform/settings"), isUiTab, UI)).toBe(false);
    expect(isTabLanguageSender(ev(11, "https://evil.example/settings"), isUiTab, UI)).toBe(false);
    expect(isTabLanguageSender(ev(11, "file:///x/passwords.html"), isUiTab, UI)).toBe(false);
    expect(isTabLanguageSender(ev(11, undefined), isUiTab, UI)).toBe(false);
    expect(isTabLanguageSender(ev(11, "not a url"), isUiTab, UI)).toBe(false);
  });

  it("follows the dev-server origin", () => {
    expect(isTabLanguageSender(ev(11, "http://localhost:5174/settings"), isUiTab, "http://localhost:5174")).toBe(true);
    expect(isTabLanguageSender(ev(11, "http://localhost:5175/settings"), isUiTab, "http://localhost:5174")).toBe(false);
  });
});
