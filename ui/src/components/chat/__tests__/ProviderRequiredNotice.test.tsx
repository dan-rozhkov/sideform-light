import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { addByokModel, clearByokConfig, setByokConnection } from "@/lib/byokProvider";
import { useHasUsableModel } from "@/hooks/useModelOptions";
import { ChatInput } from "../ChatInput";
import { ProviderRequiredNotice } from "../ProviderRequiredNotice";

afterEach(() => {
  cleanup();
  clearByokConfig();
  delete window.penAgentPanel;
});

describe("ProviderRequiredNotice", () => {
  it("explains that a provider is needed and opens Settings > Model", () => {
    const open = vi.fn();
    window.penAgentPanel = { version: 3, settings: { open } };
    render(<ProviderRequiredNotice />);
    expect(screen.getByText("Add a model provider to start")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(open).toHaveBeenCalledWith("model");
  });
});

describe("ChatInput with sendBlocked", () => {
  function Harness({ onSubmit, blocked }: { onSubmit: () => boolean; blocked: boolean }) {
    const [input, setInput] = useState("hello");
    return (
      <ChatInput sessionId="s" input={input} setInput={setInput} onSubmit={onSubmit} isLoading={false} stop={() => {}} sendBlocked={blocked} />
    );
  }

  it("does not send on Enter or via the send button while blocked", () => {
    const onSubmit = vi.fn(() => true);
    render(<Harness onSubmit={onSubmit} blocked />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });

  it("sends on Enter when not blocked", () => {
    const onSubmit = vi.fn(() => true);
    render(<Harness onSubmit={onSubmit} blocked={false} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("useHasUsableModel", () => {
  function Probe() {
    return <span data-testid="has">{String(useHasUsableModel())}</span>;
  }

  it("is false without a provider and turns true once one has a model", () => {
    render(<Probe />);
    expect(screen.getByTestId("has").textContent).toBe("false");
    act(() => {
      setByokConnection("https://api.example.com/v1", "k");
      addByokModel({ id: "m" });
    });
    expect(screen.getByTestId("has").textContent).toBe("true");
  });
});
