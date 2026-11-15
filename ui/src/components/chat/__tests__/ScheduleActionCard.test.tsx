import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { useLanguageStore } from "@/i18n";
import { MessageList } from "../MessageList";
import { hasPendingWaitingCall, waitingPlaceholder } from "../waitingForPerson";
import { pendingScheduleActions } from "@/lib/tools/pendingScheduleActions";

afterEach(() => {
  cleanup();
  useLanguageStore.setState({ language: "en" });
  (window as unknown as { penAgentPanel?: unknown }).penAgentPanel = undefined;
  pendingScheduleActions.delete("c1");
});

/** What the onToolCall precheck records when it leaves the call pending. */
const record = (enabled = true) =>
  pendingScheduleActions.set("c1", { name: "Digest", cron: "0 9 * * 1-5", prompt: "Summarize the news", enabled });

const view = { id: "s1", name: "Digest", prompt: "Summarize the news", cron: "0 9 * * 1-5", enabled: true, createdAt: 1, updatedAt: 1, nextRunAt: new Date(2026, 10, 16, 9, 0).getTime() };

function msg(tool: string, input: unknown, state = "input-available", output?: unknown): UIMessage {
  return {
    id: "m",
    role: "assistant",
    parts: [{ type: `tool-${tool}`, toolCallId: "c1", state, input, ...(output !== undefined ? { output } : {}) }],
  } as unknown as UIMessage;
}
const pause = (state?: string, output?: unknown) => msg("schedule_set_enabled", { id: "s1", enabled: false }, state, output);
const resume = (state?: string, output?: unknown) => msg("schedule_set_enabled", { id: "s1", enabled: true }, state, output);
const del = (state?: string, output?: unknown) => msg("schedule_delete", { id: "s1" }, state, output);

function setBridge(over: Record<string, unknown> = {}, open?: unknown) {
  const b = {
    list: vi.fn(async () => ({ schedules: [view] })),
    create: vi.fn(),
    setEnabled: vi.fn(async (_id: string, enabled: boolean) => ({ schedule: { ...view, enabled } })),
    remove: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
  (window as unknown as { penAgentPanel?: unknown }).penAgentPanel = {
    version: 3,
    schedules: b,
    settings: { open: open ?? vi.fn(async () => ({ ok: true })) },
  };
  return b;
}

describe("ScheduleActionCard", () => {
  it.each([
    ["pause", pause, "Pause this schedule?", "Pause"],
    ["resume", resume, "Resume this schedule?", "Resume"],
    ["delete", del, "Delete this schedule?", "Delete"],
  ])("renders the %s card from the precheck's record", (_n, make, title, button) => {
    const b = setBridge();
    record();
    render(<MessageList messages={[make()]} isLoading={false} addToolOutput={vi.fn()} />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText("Digest")).toBeTruthy();
    expect(screen.getByText("Every weekday at 09:00")).toBeTruthy();
    expect(screen.getByText("Summarize the news")).toBeTruthy();
    expect((screen.getByRole("button", { name: button }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    // the card never looks anything up itself
    expect(b.list).not.toHaveBeenCalled();
  });

  it("draws no card, and does not block the composer, without a record (precheck in flight, or after a reload)", () => {
    const b = setBridge();
    const addToolOutput = vi.fn();
    for (const make of [pause, resume, del]) {
      render(<MessageList messages={[make()]} isLoading={false} addToolOutput={addToolOutput} />);
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(hasPendingWaitingCall([make()])).toBe(false);
      cleanup();
    }
    expect(b.list).not.toHaveBeenCalled();
    expect(addToolOutput).not.toHaveBeenCalled();
  });

  it("the card appears when the record is added later", () => {
    setBridge();
    render(<MessageList messages={[del()]} isLoading={false} addToolOutput={vi.fn()} />);
    expect(screen.queryByText("Delete this schedule?")).toBeNull();
    act(() => record());
    expect(screen.getByText("Delete this schedule?")).toBeTruthy();
  });

  it("never resolves on its own when the schedule or the bridge is missing", async () => {
    const addToolOutput = vi.fn();
    record();
    setBridge({ list: vi.fn(async () => ({ schedules: [] })) });
    render(<MessageList messages={[pause()]} isLoading={false} addToolOutput={addToolOutput} />);
    (window as unknown as { penAgentPanel?: unknown }).penAgentPanel = undefined;
    await new Promise((r) => setTimeout(r, 20));
    expect(addToolOutput).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("Pause calls setEnabled(id, false) once and resolves updated", async () => {
    const b = setBridge();
    record();
    const addToolOutput = vi.fn();
    render(<MessageList messages={[pause()]} isLoading={false} addToolOutput={addToolOutput} />);
    const btn = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(addToolOutput).toHaveBeenCalledTimes(1));
    expect(b.setEnabled).toHaveBeenCalledTimes(1);
    expect(b.setEnabled).toHaveBeenCalledWith("s1", false);
    expect(b.remove).not.toHaveBeenCalled();
    const call = addToolOutput.mock.calls[0][0];
    expect(call).toMatchObject({ tool: "schedule_set_enabled", toolCallId: "c1" });
    expect(JSON.parse(call.output)).toMatchObject({ status: "updated", schedule: { id: "s1", enabled: false } });
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Resume calls setEnabled(id, true)", async () => {
    const b = setBridge();
    record(false);
    const addToolOutput = vi.fn();
    render(<MessageList messages={[resume()]} isLoading={false} addToolOutput={addToolOutput} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(addToolOutput).toHaveBeenCalled());
    expect(b.setEnabled).toHaveBeenCalledWith("s1", true);
    expect(JSON.parse(addToolOutput.mock.calls[0][0].output)).toMatchObject({ status: "updated", schedule: { enabled: true } });
  });

  it("Delete calls remove(id) and resolves deleted", async () => {
    const b = setBridge();
    record();
    const addToolOutput = vi.fn();
    render(<MessageList messages={[del()]} isLoading={false} addToolOutput={addToolOutput} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(addToolOutput).toHaveBeenCalled());
    expect(b.remove).toHaveBeenCalledWith("s1");
    expect(b.setEnabled).not.toHaveBeenCalled();
    expect(addToolOutput.mock.calls[0][0]).toMatchObject({ tool: "schedule_delete", toolCallId: "c1" });
    expect(JSON.parse(addToolOutput.mock.calls[0][0].output)).toEqual({ status: "deleted", id: "s1" });
  });

  it("a bridge error on Confirm resolves the error (the person's action)", async () => {
    setBridge({ remove: async () => ({ error: "Could not delete" }) });
    record();
    const addToolOutput = vi.fn();
    render(<MessageList messages={[del()]} isLoading={false} addToolOutput={addToolOutput} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(addToolOutput).toHaveBeenCalled());
    expect(JSON.parse(addToolOutput.mock.calls[0][0].output)).toEqual({ status: "error", error: "Could not delete", fromShell: true });
  });

  it("a missing bridge on Confirm resolves an error", async () => {
    record();
    const addToolOutput = vi.fn();
    render(<MessageList messages={[del()]} isLoading={false} addToolOutput={addToolOutput} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(addToolOutput).toHaveBeenCalled());
    expect(JSON.parse(addToolOutput.mock.calls[0][0].output).status).toBe("error");
  });

  it("Cancel resolves declined without calling the bridge", async () => {
    const b = setBridge();
    record();
    const addToolOutput = vi.fn();
    render(<MessageList messages={[del()]} isLoading={false} addToolOutput={addToolOutput} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(b.remove).not.toHaveBeenCalled();
    expect(b.setEnabled).not.toHaveBeenCalled();
    expect(JSON.parse(addToolOutput.mock.calls[0][0].output)).toEqual({ status: "declined" });
  });

  it("keeps the schedule name for the delete outcome line after the record is gone", () => {
    setBridge();
    record();
    const addToolOutput = vi.fn();
    const { rerender } = render(<MessageList messages={[del()]} isLoading={false} addToolOutput={addToolOutput} />);
    rerender(<MessageList messages={[del("output-available", JSON.stringify({ status: "deleted", id: "s1" }))]} isLoading={false} addToolOutput={addToolOutput} />);
    act(() => pendingScheduleActions.delete("c1"));
    expect(screen.getByText("Schedule deleted · Digest")).toBeTruthy();
  });

  it("renders outcome lines", () => {
    const open = vi.fn(async () => ({ ok: true }));
    setBridge({}, open);
    const upd = (enabled: boolean) => JSON.stringify({ status: "updated", schedule: { id: "s1", name: "Digest", enabled } });
    const { unmount } = render(<MessageList messages={[pause("output-available", upd(false))]} isLoading={false} />);
    expect(screen.getByText("Schedule paused · Digest")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Schedules" }));
    expect(open).toHaveBeenCalledWith("schedules");
    unmount();
    cleanup();
    render(<MessageList messages={[resume("output-available", upd(true))]} isLoading={false} />);
    expect(screen.getByText("Schedule resumed · Digest")).toBeTruthy();
    cleanup();
    render(<MessageList messages={[del("output-available", JSON.stringify({ status: "deleted", id: "s1" }))]} isLoading={false} />);
    expect(screen.getByText("Schedule deleted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Schedules" })).toBeNull();
    cleanup();
    render(<MessageList messages={[del("output-available", JSON.stringify({ status: "declined" }))]} isLoading={false} />);
    expect(screen.getByText("Not changed")).toBeTruthy();
  });

  it("an error outcome is localized; main's reason is shown, model-instruction texts are not", () => {
    render(<MessageList messages={[del("output-available", JSON.stringify({ status: "error", error: "Unknown schedule id. Call schedule_list." }))]} isLoading={false} />);
    expect(screen.getByText("Schedule not changed")).toBeTruthy();
    expect(screen.queryByText(/Unknown schedule id/)).toBeNull();
    cleanup();
    render(<MessageList messages={[del("output-available", JSON.stringify({ status: "error", error: "Could not delete", fromShell: true }))]} isLoading={false} />);
    expect(screen.getByText("Schedule not changed: Could not delete")).toBeTruthy();
    cleanup();
    useLanguageStore.setState({ language: "ru" });
    render(<MessageList messages={[del("output-available", JSON.stringify({ status: "error", error: "Unknown schedule id. Call schedule_list." }))]} isLoading={false} />);
    expect(screen.getByText("Расписание не изменено")).toBeTruthy();
  });

  it("does not render a card for invalid input", () => {
    setBridge();
    pendingScheduleActions.set("c1", { name: "Digest", cron: "0 9 * * 1-5", prompt: "x", enabled: true });
    render(<MessageList messages={[msg("schedule_set_enabled", { id: "s1" })]} isLoading={false} />);
    expect(screen.queryByText("Pause this schedule?")).toBeNull();
    expect(screen.queryByText("Resume this schedule?")).toBeNull();
    expect(hasPendingWaitingCall([msg("schedule_set_enabled", { id: "s1" })])).toBe(false);
  });
});

describe("waiting for the person", () => {
  it("blocks the composer and names the pending card once the record exists", () => {
    record();
    for (const m of [pause(), resume(), del()]) {
      expect(hasPendingWaitingCall([m])).toBe(true);
      expect(waitingPlaceholder([m])).toBe("Confirm or cancel the schedule above to continue…");
    }
    expect(hasPendingWaitingCall([del("output-available", "{}")])).toBe(false);
    expect(hasPendingWaitingCall([del("input-streaming")])).toBe(false);
  });
});

describe("localization", () => {
  it("renders a Russian card and outcome", () => {
    useLanguageStore.setState({ language: "ru" });
    setBridge();
    record();
    render(<MessageList messages={[pause()]} isLoading={false} addToolOutput={vi.fn()} />);
    expect(screen.getByText("Приостановить это расписание?")).toBeTruthy();
    expect(screen.getByText("По будням в 09:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Приостановить" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeTruthy();
    expect(waitingPlaceholder([pause()])).toBe("Подтвердите или отклоните расписание выше, чтобы продолжить…");
    cleanup();
    render(<MessageList messages={[del("output-available", JSON.stringify({ status: "declined" }))]} isLoading={false} />);
    expect(screen.getByText("Без изменений")).toBeTruthy();
  });
});
