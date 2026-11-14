import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "../downloadFile";

let anchors: { href: string; download: string; target: string }[];

beforeEach(() => {
  anchors = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    anchors.push({ href: this.href, download: this.download, target: this.target });
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloadFile", () => {
  it("saves a base64 data: URL without calling fetch", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("CSP");
    });
    vi.stubGlobal("fetch", fetchSpy);
    await downloadFile("data:text/plain;base64,aGk=", "a.txt");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(anchors).toEqual([{ href: "blob:x", download: "a.txt", target: "" }]);
  });

  it("falls back to an anchor for a malformed data: URL and never rejects", async () => {
    await expect(downloadFile("data:nonsense", "b.png")).resolves.toBeUndefined();
    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("b.png");
  });

  it("falls back to a new-tab anchor when fetch of an https image is blocked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("blocked by CSP"))));
    await expect(downloadFile("https://img.example/a.png", "a.png")).resolves.toBeUndefined();
    expect(anchors).toEqual([{ href: "https://img.example/a.png", download: "a.png", target: "_blank" }]);
  });

  it("does not reject even when the anchor fallback throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("net"))));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("no click");
    });
    await expect(downloadFile("https://img.example/a.png", "a.png")).resolves.toBeUndefined();
  });
});
