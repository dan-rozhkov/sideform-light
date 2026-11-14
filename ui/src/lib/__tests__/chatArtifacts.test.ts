import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { collectChatArtifacts, openChatArtifact } from "../chatArtifacts";

const msgs = (...parts: unknown[]) => [{ id: "m", role: "assistant", parts }] as unknown as UIMessage[];
const browseAgent = (id: string, goal: string) => ({
  type: "tool-browse_agent",
  toolCallId: `c-${id}`,
  state: "output-available",
  input: { goal },
  output: { trace: { id, source: "local" } },
});

describe("collectChatArtifacts", () => {
  it("collects traces from browse_agent results, newest first, deduped", () => {
    const out = collectChatArtifacts(msgs(browseAgent("t1", "First"), browseAgent("t2", "Second"), browseAgent("t1", "First again")));
    expect(out.map((a) => a.traceId)).toEqual(["t1", "t2"]);
    expect(out[0]).toEqual({ kind: "trace", traceId: "t1", title: "First again" });
  });

  it("reads trace_read and trace_frame calls, and ignores failed or malformed parts", () => {
    const out = collectChatArtifacts(
      msgs(
        { type: "tool-trace_read", toolCallId: "r", state: "output-available", input: { traceId: "a" }, output: JSON.stringify({ goal: "Read goal" }) },
        { type: "tool-trace_frame", toolCallId: "f", state: "output-available", input: { traceId: "b" }, output: JSON.stringify({ error: "nope" }) },
        { type: "tool-browse_agent", toolCallId: "x", state: "output-available", input: {}, output: "not json" },
        { type: "text", text: "hi" },
        null,
      ),
    );
    expect(out).toEqual([{ kind: "trace", traceId: "a", title: "Read goal" }]);
  });

  it("falls back to a generic title and lets a real title win later", () => {
    const out = collectChatArtifacts(msgs({ type: "tool-trace_read", toolCallId: "r", state: "output-available", input: { traceId: "a" }, output: "{}" }));
    expect(out[0].title).toBe("Trace");
  });
});

describe("openChatArtifact", () => {
  it("opens the trace through the injected opener and never throws", () => {
    const run = vi.fn();
    openChatArtifact({ kind: "trace", traceId: "t1", title: "x" }, { openTrace: (t) => (t.id === "t1" ? run : undefined) });
    expect(run).toHaveBeenCalledOnce();
    expect(() => openChatArtifact({ kind: "trace", traceId: "t1", title: "x" }, { openTrace: () => { throw new Error("boom"); } })).not.toThrow();
  });
});
