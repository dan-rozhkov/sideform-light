import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

import { ChatPanelContent } from "../ChatPanel";
import { useChatStore, type ChatSummary } from "@/store/chatStore";
import { useLanguageStore } from "@/i18n";
import { displayChatTitle } from "@/lib/chatTitle";
import { contextMeterLabel } from "@/lib/contextMeter";

function summary(id: string, title: string, titleIsAuto: boolean): ChatSummary {
  return { id, title, model: "deepseek/deepseek-v4.1-flash", parallelCount: 1, titleIsAuto, unread: false, needsAnswer: false, isBusy: false, updatedAt: 1000 };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  useChatStore.setState({
    chats: [summary("c1", "Chat 1", true)],
    activeChatId: "c1",
    abortControllers: {},
    launchQueue: {},
    sessionActions: {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useLanguageStore.setState({ language: "en" });
});

describe("chat UI localization", () => {
  it("renders English by default", async () => {
    await act(async () => {
      render(<ChatPanelContent />);
    });
    expect(screen.getByText("Ask Sideform Agent anything")).toBeTruthy();
    expect(screen.getByPlaceholderText("Ask Sideform Light…")).toBeTruthy();
  });

  it("renders the empty state, placeholder and default title in Russian", async () => {
    useLanguageStore.setState({ language: "ru" });
    await act(async () => {
      render(<ChatPanelContent />);
    });
    expect(screen.getByText("Спросите Sideform Agent о чём угодно")).toBeTruthy();
    expect(screen.getByPlaceholderText("Спросите Sideform Light…")).toBeTruthy();
    expect(screen.getByTestId("chat-header-title").textContent).toBe("Чат 1");
  });

  it("follows a language switch while mounted", async () => {
    await act(async () => {
      render(<ChatPanelContent />);
    });
    await act(async () => {
      useLanguageStore.setState({ language: "de" });
    });
    expect(screen.getByPlaceholderText("Frag Sideform Light…")).toBeTruthy();
  });

  it("translates only default titles", () => {
    useLanguageStore.setState({ language: "fr" });
    expect(displayChatTitle({ title: "Chat 2", titleIsAuto: true })).toBe("Discussion 2");
    expect(displayChatTitle({ title: "Chat 2", titleIsAuto: false })).toBe("Chat 2");
    expect(contextMeterLabel(1000, 10000)).toBe("Contexte : 10 % · 1K / 10K");
  });
});
