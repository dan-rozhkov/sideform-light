import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChatPanelContent } from "../ChatPanel";
import { addByokModel, clearByokConfig, setByokConnection } from "@/lib/byokProvider";
import { useChatStore } from "@/store/chatStore";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  useChatStore.setState((s) => ({
    model: "",
    activeChatId: s.chats[0].id,
    chats: s.chats.map((c) => ({ ...c, model: "" })),
  }));
});

afterEach(() => {
  cleanup();
  clearByokConfig();
  vi.unstubAllGlobals();
  delete window.penAgentPanel;
});

describe("ChatPanel provider-required state", () => {
  it("shows the notice with an Open Settings button and disables sending while there is no provider", async () => {
    const open = vi.fn();
    window.penAgentPanel = { version: 3, settings: { open } };
    await act(async () => {
      render(<ChatPanelContent />);
    });
    expect(screen.getByTestId("provider-required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(open).toHaveBeenCalledWith("model");
  });

  it("hides the notice once a provider with a model is configured", async () => {
    await act(async () => {
      render(<ChatPanelContent />);
    });
    expect(screen.queryByTestId("provider-required")).not.toBeNull();
    await act(async () => {
      setByokConnection("https://api.example.com/v1", "k");
      addByokModel({ id: "m" });
    });
    expect(screen.queryByTestId("provider-required")).toBeNull();
  });
});
