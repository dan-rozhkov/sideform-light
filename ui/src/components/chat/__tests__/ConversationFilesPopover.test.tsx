import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { ConversationFilesPopover } from "../ConversationFilesPopover";

afterEach(() => {
  cleanup();
  delete window.penAgentPanel;
});

const tracePart = (n: number) => ({
  type: "tool-browse_agent",
  toolCallId: `b${n}`,
  state: "output-available",
  input: { goal: `Goal ${n}` },
  output: { trace: { id: `t${n}`, source: "local" } },
});
const msgs = (...parts: unknown[]) => [{ id: "m", role: "assistant", parts }] as unknown as UIMessage[];

function openPopover(messages: UIMessage[]) {
  render(<ConversationFilesPopover getMessages={() => messages} />);
  fireEvent.click(screen.getByTestId("conversation-files-trigger"));
}

const withOpener = (open = vi.fn(async () => ({ ok: true }))) => {
  window.penAgentPanel = { version: 3, traces: { save: vi.fn(), open } };
  return open;
};

describe("<ConversationFilesPopover />", () => {
  it("shows the empty state", async () => {
    openPopover([]);
    expect(await screen.findByText(/appear here/)).toBeTruthy();
  });

  it("lists the traces a chat touched and opens one through the panel bridge", async () => {
    const open = withOpener();
    openPopover(msgs(tracePart(1)));
    expect(await screen.findByText("Traces")).toBeTruthy();
    fireEvent.click(screen.getByText("Goal 1"));
    expect(open).toHaveBeenCalledWith("t1");
  });

  it("hides a trace that cannot be opened (no panel bridge)", async () => {
    openPopover(msgs(tracePart(1)));
    expect(await screen.findByText(/appear here/)).toBeTruthy();
  });

  it("limits to 5 rows and expands with Show all", async () => {
    withOpener();
    openPopover(msgs(...[1, 2, 3, 4, 5, 6, 7].map(tracePart)));
    await screen.findByText("Traces");
    expect(screen.queryByText("Goal 1")).toBeNull();
    fireEvent.click(screen.getByText("Show all (7)"));
    expect(screen.getByText("Goal 1")).toBeTruthy();
    expect(screen.queryByText(/Show all/)).toBeNull();
  });
});
