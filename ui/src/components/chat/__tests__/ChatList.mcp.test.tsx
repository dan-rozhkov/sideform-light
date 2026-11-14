import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/store/chatStore";
import { ChatList } from "../ChatList";

describe("ChatList MCP marker", () => {
  beforeEach(() => useChatStore.setState(useChatStore.getInitialState()));
  afterEach(cleanup);

  it("marks only chats started over MCP", () => {
    const plain = useChatStore.getState().chats[0].id;
    const mcp = useChatStore.getState().createChat({ activate: false, source: "mcp" });
    render(<ChatList />);
    expect(screen.queryByTestId(`chat-mcp-${plain}`)).toBeNull();
    const marker = screen.getByTestId(`chat-mcp-${mcp}`);
    expect(marker.getAttribute("title")).toBe("Started over MCP");
  });
});
