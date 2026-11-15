import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useChatStore } from "@/store/chatStore";
import { ChatList } from "../ChatList";

beforeEach(() => useChatStore.setState(useChatStore.getInitialState()));
afterEach(cleanup);

describe("ChatList", () => {
  it("shows a clock before the title of a schedule chat only", () => {
    const s = useChatStore.getState();
    const sched = s.createChat({ activate: false, source: "schedule" });
    const mcp = s.createChat({ activate: false, source: "mcp" });
    render(<ChatList />);
    expect(screen.getByTestId(`chat-scheduled-${sched}`).getAttribute("aria-label")).toBe("Scheduled run");
    expect(screen.queryByTestId(`chat-scheduled-${mcp}`)).toBeNull();
    expect(screen.getAllByRole("img", { name: "Scheduled run" })).toHaveLength(1);
  });
});
