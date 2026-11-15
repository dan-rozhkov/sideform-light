import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ToolCallIndicator } from "../ToolCallIndicator";
import { ThinkingIndicator } from "../ThinkingIndicator";
import { AskUserForm } from "../AskUserForm";
import { summarizeAnswers, initAnswerState } from "../askUserAnswers";
import { useLanguageStore } from "@/i18n";
import { DECIDE_FOR_ME, type AskUserInput } from "@/types/askUser";

vi.mock("@/lib/revealToolTab", () => ({ revealToolTab: vi.fn(async () => {}) }));

afterEach(() => {
  cleanup();
  useLanguageStore.setState({ language: "en" });
});

describe("tool UI in Russian", () => {
  it("translates the tool name and status", () => {
    useLanguageStore.setState({ language: "ru" });
    render(<ToolCallIndicator part={{ type: "tool-browse_open", toolCallId: "c1", state: "output-available", input: {}, output: "{}" }} />);
    expect(screen.getByText("Открытие браузера")).toBeTruthy();
    expect(screen.getByText("Готово")).toBeTruthy();
  });

  it("translates the thinking row", () => {
    useLanguageStore.setState({ language: "ru" });
    render(<ThinkingIndicator part={{ type: "reasoning", text: "x", state: "done" }} />);
    expect(screen.getByText("Подумал")).toBeTruthy();
  });

  it("translates the form buttons, but sends the same payload", () => {
    useLanguageStore.setState({ language: "ru" });
    const input: AskUserInput = { questions: [{ id: "a", label: "A?", type: "single", options: [{ value: "x", label: "X" }] }] } as AskUserInput;
    render(<AskUserForm input={input} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Другое…")).toBeTruthy();
    const q = input.questions[0];
    const state = initAnswerState(input.questions);
    state.a.value = DECIDE_FOR_ME;
    expect(summarizeAnswers([q], state)[0].display).toBe("Решите за меня");
  });
});
