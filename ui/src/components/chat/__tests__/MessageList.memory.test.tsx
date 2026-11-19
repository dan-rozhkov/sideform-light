import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it } from "vitest";

import { getToolDisplayName } from "@/lib/toolDisplayNames";
import { getToolIcon } from "@/lib/toolIcons";
import { BrainIcon } from "@/components/icons";
import type { ChatActivityNote } from "@/store/chatStore";
import { MessageList } from "../MessageList";

afterEach(() => cleanup());

const user = (id: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: "hi" }] }) as UIMessage;
const memoryTool = (state: string, output?: unknown): UIMessage =>
  ({
    id: "a1",
    role: "assistant",
    parts: [
      {
        type: "tool-memory",
        toolCallId: "c1",
        state,
        input: { target: "user", operations: [{ action: "add", content: "Likes tea" }] },
        output,
      },
    ],
  }) as unknown as UIMessage;

describe("memory in the chat", () => {
  it("names the memory tool and gives it the brain icon", () => {
    expect(getToolDisplayName("memory")).toBe("Memory");
    expect(getToolIcon("memory")).toBe(BrainIcon);
  });

  it("shows 'Memory updated' for a successful memory tool call, expandable to what changed", () => {
    render(<MessageList messages={[user("u1"), memoryTool("output-available", { ok: true })]} isLoading={false} />);
    const row = screen.getByRole("button", { name: /Memory updated/ });
    expect(screen.queryByText("Remembered about you: Likes tea")).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText("Remembered about you: Likes tea")).toBeTruthy();
  });

  it("does not show the row for a failed memory write (falls back to the tool indicator)", () => {
    render(<MessageList messages={[user("u1"), memoryTool("output-available", { ok: false, error: "over_capacity" })]} isLoading={false} />);
    expect(screen.queryByText("Memory updated")).toBeNull();
    expect(screen.getByText("Memory")).toBeTruthy();
  });

  it("renders a background-review note under the last assistant message of the reviewed turn", () => {
    const note: ChatActivityNote = {
      id: "n1",
      turnMessageId: "u1",
      changesByEvent: { "5": [{ kind: "memory", target: "memory", action: "add", content: "Uses pnpm" }] },
    };
    const messages = [
      user("u1"),
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "first" }] } as UIMessage,
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "second" }] } as UIMessage,
      user("u2"),
    ];
    render(<MessageList messages={messages} isLoading={false} activityNotes={[note]} />);
    expect(screen.getAllByText("Memory updated")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Memory updated/ }));
    expect(screen.getByText("Remembered: Uses pnpm")).toBeTruthy();
  });

  it("renders nothing for a note whose turn is gone, and a plain row for a note without details", () => {
    const gone: ChatActivityNote = { id: "n1", turnMessageId: "missing" };
    const bare: ChatActivityNote = { id: "n2", afterMessageId: "a1" };
    const messages = [user("u1"), { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] } as UIMessage];
    render(<MessageList messages={messages} isLoading={false} activityNotes={[gone, bare]} />);
    expect(screen.getAllByText("Memory updated")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Memory updated/ })).toBeNull();
  });
});
