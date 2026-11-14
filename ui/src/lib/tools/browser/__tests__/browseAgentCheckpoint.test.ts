import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolHandlers } from "@/lib/toolRegistry";
import { messageToMarkdown } from "@/lib/chatExport";
import { MAX_CHECKPOINTS_PER_CHAT, resetBrowseCheckpoints, useBrowseCheckpointStore } from "@/store/browseCheckpointStore";
import { textTurn } from "@/test/sseStream";
import { cleanupBrowseAgentTest, fixtureBridgeMocks, stubBrowseOpenSnapshot } from "./helpers";
import { browseAgent } from "../browseAgent";
import { getBrowserBridge } from "../bridge";

vi.mock("../bridge", async (orig) => {
  const actual = await orig<typeof import("../bridge")>();
  return { ...actual, getBrowserBridge: vi.fn(actual.getBrowserBridge) };
});

const ctx = { sessionId: "chat-1", toolCallId: "tc-1" };
const SECRETS = ["SECRET-COOKIE", "SECRET-STORAGE", "SECRET-TYPED"];
const CAPTURED = {
  version: 1,
  url: "https://shop.test/cart",
  storage: {
    cookies: [{ name: "sid", value: "SECRET-COOKIE", domain: "shop.test" }],
    origins: [{ origin: "https://shop.test", localStorage: { k: "SECRET-STORAGE" } }],
  },
  steps: [{ action: "type", selector: "#p", text: "SECRET-TYPED" }],
};
const NETWORK = [{ url: "https://api.test/*", status: 500 }];

let startJournal: ReturnType<typeof vi.fn>;
let stopJournal: ReturnType<typeof vi.fn>;
let captureCheckpoint: ReturnType<typeof vi.fn>;
let applyFixture: ReturnType<typeof vi.fn>;
let releaseFixture: ReturnType<typeof vi.fn>;
let restoreHandlers: () => void;

beforeEach(() => {
  startJournal = vi.fn(async () => "jt");
  stopJournal = vi.fn(async () => true);
  captureCheckpoint = vi.fn(async () => ({ ok: true, fixture: CAPTURED, complete: true, summary: "cart page, 1 step" }));
  ({ applyFixture, releaseFixture } = fixtureBridgeMocks("tok"));
  restoreHandlers = stubBrowseOpenSnapshot();
  window.penAgentPanel = {
    onMenuCommand: () => () => {},
    browser: { startJournal, stopJournal, captureCheckpoint, applyFixture, releaseFixture },
  } as never;
  vi.stubGlobal("fetch", vi.fn(async () => textTurn("All good")));
  resetBrowseCheckpoints();
});

afterEach(() => {
  cleanupBrowseAgentTest(restoreHandlers);
});

const stored = () => useBrowseCheckpointStore.getState().byChat["chat-1"] ?? [];

describe("browse_agent checkpoint recording", () => {
  it("records, captures, stores the fixture and returns only the model-safe summary", async () => {
    const raw = await browseAgent({ goal: "g", url: "https://shop.test/cart" }, ctx);
    const result = JSON.parse(raw);
    expect(result.checkpoint).toEqual({ id: "cp_1", complete: true, summary: "cart page, 1 step" });
    expect(startJournal).toHaveBeenCalledTimes(1);
    expect(captureCheckpoint).toHaveBeenCalledWith("jt");
    expect(stopJournal).toHaveBeenCalledWith("jt");
    expect(stored()[0].fixture).toMatchObject({ url: "https://shop.test/cart" });
    for (const s of SECRETS) expect(raw).not.toContain(s);
    expect(raw).not.toContain("fixture");
  });

  it("surfaces a partial checkpoint's gap", async () => {
    captureCheckpoint.mockResolvedValue({ ok: true, fixture: CAPTURED, complete: false, gap: "a tab was lost", summary: "s" });
    const result = JSON.parse(await browseAgent({ goal: "g", url: "https://shop.test/cart" }, ctx));
    expect(result.checkpoint).toEqual({ id: "cp_1", complete: false, gap: "a tab was lost", summary: "s" });
  });

  it("adds nothing when the capture fails, and still stops the journal", async () => {
    captureCheckpoint.mockResolvedValue({ ok: false, error: "boom" });
    const raw = await browseAgent({ goal: "g", url: "https://shop.test/cart" }, ctx);
    expect(JSON.parse(raw).checkpoint).toBeUndefined();
    expect(raw).not.toContain("boom");
    expect(stored()).toEqual([]);
    expect(stopJournal).toHaveBeenCalled();
  });

  it("takes no checkpoint on setup_failed or aborted, but stops the journal", async () => {
    const failed = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test", setup: { steps: [{ action: "nope" }] } }, ctx));
    expect(failed.status).toBe("setup_failed");
    expect(failed.checkpoint).toBeUndefined();

    const ac = new AbortController();
    ac.abort();
    const aborted = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test" }, { ...ctx, signal: ac.signal }));
    expect(aborted.status).toBe("aborted");
    expect(aborted.checkpoint).toBeUndefined();
    expect(captureCheckpoint).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);
  });

  it("a bridge without journal support gives no checkpoint and no error", async () => {
    window.penAgentPanel = { onMenuCommand: () => () => {}, browser: {} } as never;
    const result = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test" }, ctx));
    expect(result.status).toBe("done");
    expect(result.checkpoint).toBeUndefined();
  });
});

describe("browse_agent recorder lifecycle", () => {
  it("never starts the journal when the setup is invalid", async () => {
    const result = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test", setup: { steps: [{ action: "nope" }] } }, ctx));
    expect(result.status).toBe("setup_failed");
    expect(startJournal).not.toHaveBeenCalled();
    expect(stopJournal).not.toHaveBeenCalled();
  });

  it("never starts the journal when the resume id is unknown", async () => {
    const result = JSON.parse(await browseAgent({ goal: "g", resume: "cp_9" }, ctx));
    expect(result.status).toBe("setup_failed");
    expect(startJournal).not.toHaveBeenCalled();
  });

  it("does not wait for a slow journal stop beyond 2 s", async () => {
    vi.useFakeTimers();
    try {
      let endStop: (v: boolean) => void = () => {};
      stopJournal.mockImplementation(() => new Promise<boolean>((r) => (endStop = r)));
      let done = false;
      const run = browseAgent({ goal: "g", url: "https://shop.test/cart" }, ctx).then((r) => {
        done = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(2_100);
      expect(done).toBe(true);
      expect(JSON.parse(await run).checkpoint).toMatchObject({ id: "cp_1" });
      // Let the stop settle so the recording slot is free for the next tests.
      endStop(true);
      await vi.advanceTimersByTimeAsync(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second parallel run in the same chat does not record", async () => {
    let release: (v: string) => void = () => {};
    startJournal.mockImplementationOnce(() => new Promise<string>((r) => (release = r)));
    const first = browseAgent({ goal: "g", url: "https://shop.test/cart" }, ctx);
    const second = JSON.parse(await browseAgent({ goal: "g", url: "https://shop.test/cart" }, { ...ctx, toolCallId: "tc-2" }));
    expect(second.status).toBe("done");
    expect(second.checkpoint).toBeUndefined();
    expect(startJournal).toHaveBeenCalledTimes(1);
    release("jt");
    expect(JSON.parse(await first).checkpoint).toMatchObject({ id: "cp_1" });
    expect(stopJournal).toHaveBeenCalledTimes(1);
    // The guard is released: a later run records again.
    expect(JSON.parse(await browseAgent({ goal: "g", url: "https://shop.test/cart" }, ctx)).checkpoint).toMatchObject({ id: "cp_2" });
  });

  it("two chats share one browser, so only the first records", async () => {
    const cloud = false;
    const journals = 1;
    vi.mocked(getBrowserBridge).mockImplementation(() => ({ startJournal, stopJournal, captureCheckpoint, applyFixture, releaseFixture }) as never);
    try {
      let release: (v: string) => void = () => {};
      startJournal.mockImplementationOnce(() => new Promise<string>((r) => (release = r)));
      const first = browseAgent({ goal: "g", url: "https://a.test" }, ctx);
      const second = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test" }, { sessionId: "chat-2", toolCallId: "tc-9" }));
      expect(second.checkpoint !== undefined).toBe(cloud);
      release("jt");
      await first;
      expect(startJournal).toHaveBeenCalledTimes(journals);
    } finally {
      const actual = await vi.importActual<typeof import("../bridge")>("../bridge");
      vi.mocked(getBrowserBridge).mockImplementation(actual.getBrowserBridge);
    }
  });

  it("without a chat id there is no recording and resume fails", async () => {
    const run = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test" }, { toolCallId: "tc-1" }));
    expect(run.status).toBe("done");
    expect(run.checkpoint).toBeUndefined();
    expect(startJournal).not.toHaveBeenCalled();
    const resumed = JSON.parse(await browseAgent({ goal: "g", resume: "cp_1" }, { toolCallId: "tc-2" }));
    expect(resumed).toMatchObject({ status: "setup_failed", setupStage: "validate" });
    expect(resumed.error).toContain("checkpoints need a chat");
  });





  it("clearing the chat during the capture leaves no checkpoint behind", async () => {
    captureCheckpoint.mockImplementation(async () => {
      useBrowseCheckpointStore.getState().clearChat("chat-1");
      return { ok: true, fixture: CAPTURED, complete: true, summary: "s" };
    });
    const result = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test" }, ctx));
    expect(result.checkpoint).toBeUndefined();
    expect(stored()).toEqual([]);
    expect(useBrowseCheckpointStore.getState().byChat["chat-1"]).toBeUndefined();
  });



});

describe("browse_agent resume", () => {
  const seed = (network?: unknown) =>
    useBrowseCheckpointStore.getState().add("chat-1", {
      fixture: CAPTURED as never,
      ...(network ? { network: network as never } : {}),
      complete: true,
      summary: "s",
    });

  it("applies the stored fixture with its network mocks and snapshot, no pre-open", async () => {
    seed(NETWORK);
    const result = JSON.parse(await browseAgent({ goal: "g", resume: "cp_1" }, ctx));
    expect(result).toMatchObject({ status: "done", setupApplied: true });
    const [fixture, opts] = applyFixture.mock.calls[0];
    expect(fixture).toMatchObject({ version: 1, url: "https://shop.test/cart", network: NETWORK });
    expect(opts).toMatchObject({ allowNetworkMocks: true });
    expect(toolHandlers.browse_open).not.toHaveBeenCalled();
    expect(releaseFixture).toHaveBeenCalledWith("tok");
  });



  it.each([
    ["an unknown id", { resume: "cp_9" }, "checkpoint cp_9 not found"],
    ["a url", { resume: "cp_1", url: "https://a.test" }, "cannot be combined"],
    ["a setup", { resume: "cp_1", setup: { fresh: true } }, "cannot be combined"],
  ])("setup_failed at validate with %s", async (_n, extra, message) => {
    seed();
    const result = JSON.parse(await browseAgent({ goal: "g", ...extra }, ctx));
    expect(result).toMatchObject({ status: "setup_failed", setupStage: "validate" });
    expect(result.error).toContain(message);
    expect(applyFixture).not.toHaveBeenCalled();
  });

  it("does not see another chat's checkpoint", async () => {
    useBrowseCheckpointStore.getState().add("other", { fixture: CAPTURED as never, complete: true, summary: "s" });
    const result = JSON.parse(await browseAgent({ goal: "g", resume: "cp_1" }, ctx));
    expect(result.status).toBe("setup_failed");
  });
});

describe("browseCheckpointStore", () => {
  it("clearChat drops one chat's checkpoints only", () => {
    const add = (c: string) => useBrowseCheckpointStore.getState().add(c, { fixture: CAPTURED as never, complete: true, summary: "s" });
    add("a");
    add("b");
    useBrowseCheckpointStore.getState().clearChat("a");
    expect(useBrowseCheckpointStore.getState().byChat.a).toBeUndefined();
    expect(useBrowseCheckpointStore.getState().byChat.b).toHaveLength(1);
  });

  it("deleteChat also drops the id counter; clearChat keeps it", () => {
    const add = () => useBrowseCheckpointStore.getState().add("d", { fixture: CAPTURED as never, complete: true, summary: "s" });
    add();
    useBrowseCheckpointStore.getState().clearChat("d");
    expect(add().id).toBe("cp_2");
    useBrowseCheckpointStore.getState().deleteChat("d");
    expect(add().id).toBe("cp_1");
  });

  it("keeps the newest MAX_CHECKPOINTS_PER_CHAT per chat, ids never reused", () => {
    const add = () => useBrowseCheckpointStore.getState().add("c", { fixture: CAPTURED as never, complete: true, summary: "s" });
    for (let i = 0; i < MAX_CHECKPOINTS_PER_CHAT + 2; i++) add();
    const ids = useBrowseCheckpointStore.getState().byChat.c.map((c) => c.id);
    expect(ids).toEqual(Array.from({ length: MAX_CHECKPOINTS_PER_CHAT }, (_, i) => `cp_${i + 3}`));
    expect(useBrowseCheckpointStore.getState().get("c", "cp_1")).toBeUndefined();
  });

});

describe("secrets stay out of the chat export", () => {
  it("the export of a browse_agent part carrying the model-safe output has no fixture values", async () => {
    const output = await browseAgent({ goal: "g", url: "https://shop.test/cart" }, ctx);
    const md = messageToMarkdown({
      id: "m",
      role: "assistant",
      parts: [{ type: "tool-browse_agent", toolCallId: "tc", state: "output-available", input: { goal: "g", resume: "cp_1" }, output }],
    } as never);
    expect(md).toContain("cp_1");
    for (const s of SECRETS) expect(md).not.toContain(s);
  });
});
