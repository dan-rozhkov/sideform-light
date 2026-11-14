import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import AgentPage from "../AgentPage";
import { useChatStore } from "@/store/chatStore";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderAgent = () =>
  render(
    <MemoryRouter>
      <AgentPage />
    </MemoryRouter>,
  );

describe("<AgentPage />", () => {
  it("renders the chat panel with the chat list and no canvas-only controls", () => {
    useChatStore.setState({ activeChatId: null });
    renderAgent();
    expect(screen.getByRole("region", { name: "Sideform Agent" })).toBeTruthy();
    expect(screen.getByTestId("chat-list")).toBeTruthy();
    expect(screen.queryByLabelText("Manage skills")).toBeNull();
    expect(document.documentElement.classList.contains("route-agent")).toBe(true);
  });

  it("opens a new chat with the composer, a model picker and an image attach button", async () => {
    useChatStore.setState({ activeChatId: null });
    renderAgent();
    fireEvent.click(screen.getByTestId("chat-list-new"));
    expect(await screen.findByPlaceholderText(/Ask Sideform Light/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Parallel agents/ })).toBeTruthy();
    // No slash-command menu, workflow picker or liked references in Light.
    fireEvent.change(screen.getByPlaceholderText(/Ask Sideform Light/), { target: { value: "/" } });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("lists the chats stored on disk through the panel bridge and keeps saving them", async () => {
    const list = vi.fn(async () => ({ chats: [] }));
    window.penAgentPanel = { version: 3, chats: { list, read: vi.fn(), save: vi.fn(), remove: vi.fn() } };
    renderAgent();
    await waitFor(() => expect(list).toHaveBeenCalled());
  });
});
