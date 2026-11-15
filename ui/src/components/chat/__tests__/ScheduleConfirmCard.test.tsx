import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { useLanguageStore } from "@/i18n";
import { MessageList } from "../MessageList";
import { hasPendingScheduleCreate } from "../pendingScheduleCreate";
import { hasPendingWaitingCall, waitingPlaceholder } from "../waitingForPerson";
import { hasPendingAskUser } from "../pendingAskUser";

afterEach(() => {
  cleanup();
  useLanguageStore.setState({ language: "en" });
  (window as unknown as { penAgentPanel?: unknown }).penAgentPanel = undefined;
});

const input = { name: "Digest", prompt: "Summarize the news", cron: "0 9 * * 1-5" };

function msg(state: string, output?: unknown, inp: unknown = input): UIMessage {
  return {
    id: "m",
    role: "assistant",
    parts: [{ type: "tool-schedule_create", toolCallId: "c1", state, input: inp, ...(output !== undefined ? { output } : {}) }],
  } as unknown as UIMessage;
}

function setCreate(create: unknown, open?: unknown) {
  (window as unknown as { penAgentPanel?: unknown }).penAgentPanel = {
    version: 3,
    schedules: { list: vi.fn(), create },
    settings: { open: open ?? vi.fn(async () => ({ ok: true })) },
  };
}

const sched = { id: "s", name: "Digest", prompt: "p", cron: input.cron, enabled: true, createdAt: 1, updatedAt: 1, nextRunAt: new Date(2026, 10, 16, 9, 0).getTime() };

describe("ScheduleConfirmCard in MessageList", () => {
  it("shows the card and Create calls the bridge, then resolves created", async () => {
    const create = vi.fn(async () => ({ schedule: sched }));
    setCreate(create);
    const addToolOutput = vi.fn();
    render(<MessageList messages={[msg("input-available")]} isLoading={false} addToolOutput={addToolOutput} />);
    expect(screen.getByText("Create a schedule?")).toBeTruthy();
    expect(screen.getByText("Digest")).toBeTruthy();
    expect(screen.getByText("Every weekday at 09:00")).toBeTruthy();
    expect(screen.getByText("Summarize the news")).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Create schedule" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(addToolOutput).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(input);
    const call = addToolOutput.mock.calls[0][0];
    expect(call).toMatchObject({ tool: "schedule_create", toolCallId: "c1" });
    expect(JSON.parse(call.output)).toMatchObject({ status: "created", schedule: { id: "s", nextRun: "Mon 16 Nov 2026, 09:00" } });
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("resolves error with main's message", async () => {
    setCreate(async () => ({ error: "Invalid cron" }));
    const addToolOutput = vi.fn();
    render(<MessageList messages={[msg("input-available")]} isLoading={false} addToolOutput={addToolOutput} />);
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await waitFor(() => expect(addToolOutput).toHaveBeenCalled());
    expect(JSON.parse(addToolOutput.mock.calls[0][0].output)).toEqual({ status: "error", error: "Invalid cron" });
  });

  it("Cancel resolves declined without calling the bridge", async () => {
    const create = vi.fn();
    setCreate(create);
    const addToolOutput = vi.fn();
    render(<MessageList messages={[msg("input-available")]} isLoading={false} addToolOutput={addToolOutput} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(create).not.toHaveBeenCalled();
    expect(JSON.parse(addToolOutput.mock.calls[0][0].output)).toEqual({ status: "declined" });
  });

  it("renders outcome lines", () => {
    const open = vi.fn(async () => ({ ok: true }));
    setCreate(vi.fn(), open);
    const created = JSON.stringify({ status: "created", schedule: { nextRun: "Mon 16 Nov 2026, 09:00" } });
    const { unmount } = render(<MessageList messages={[msg("output-available", created)]} isLoading={false} />);
    expect(screen.getByText(/Schedule created · next run Mon 16 Nov 2026, 09:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Schedules" }));
    expect(open).toHaveBeenCalledWith("schedules");
    expect(screen.queryByRole("button", { name: "Create schedule" })).toBeNull();
    unmount();
    render(<MessageList messages={[msg("output-available", JSON.stringify({ status: "declined" }))]} isLoading={false} />);
    expect(screen.getByText("Schedule not created")).toBeTruthy();
    cleanup();
    render(<MessageList messages={[msg("output-available", JSON.stringify({ status: "error", error: "Invalid cron" }))]} isLoading={false} />);
    expect(screen.getByText(/Schedule not created: Invalid cron/)).toBeTruthy();
  });

  it("does not render a card for invalid input", () => {
    render(<MessageList messages={[msg("input-available", undefined, { name: "" })]} isLoading={false} />);
    expect(screen.queryByText("Create a schedule?")).toBeNull();
  });
});

describe("pending helpers", () => {
  it("hasPendingScheduleCreate matches only schedule_create; ask_user helper ignores it", () => {
    expect(hasPendingScheduleCreate([msg("input-available")])).toBe(true);
    expect(hasPendingScheduleCreate([msg("output-available", "{}")])).toBe(false);
    expect(hasPendingAskUser([msg("input-available")])).toBe(false);
  });
});

describe("pending predicate", () => {
  it("ignores streaming and invalid-input parts, so the composer is never blocked without a card", () => {
    expect(hasPendingScheduleCreate([msg("input-streaming")])).toBe(false);
    expect(hasPendingScheduleCreate([msg("input-available", undefined, { name: "x" })])).toBe(false);
    expect(hasPendingScheduleCreate([msg("output-error")])).toBe(false);
    expect(hasPendingWaitingCall([msg("input-streaming")])).toBe(false);
  });

  it("MessageList draws the card exactly for a pending part", () => {
    render(<MessageList messages={[msg("input-available")]} isLoading={false} addToolOutput={vi.fn()} />);
    expect(screen.getByText("Create a schedule?")).toBeTruthy();
    cleanup();
    render(<MessageList messages={[msg("input-available", undefined, { name: "x" })]} isLoading={false} addToolOutput={vi.fn()} />);
    expect(screen.queryByText("Create a schedule?")).toBeNull();
  });

  it("the composer placeholder names the pending thing", () => {
    expect(waitingPlaceholder([msg("input-available")])).toBe("Confirm or cancel the schedule above to continue…");
    const ask = { id: "a", role: "assistant", parts: [{ type: "tool-ask_user", toolCallId: "q", state: "input-available", input: { questions: [] } }] } as unknown as UIMessage;
    expect(waitingPlaceholder([ask])).toBe("Answer the question above to continue…");
  });
});

describe("localization", () => {
  it("renders the card, the outcome and the placeholder in the interface language", () => {
    useLanguageStore.setState({ language: "ru" });
    render(<MessageList messages={[msg("input-available")]} isLoading={false} addToolOutput={vi.fn()} />);
    expect(screen.getByText("Создать расписание?")).toBeTruthy();
    expect(screen.getByText("По будням в 09:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Создать расписание" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeTruthy();
    expect(waitingPlaceholder([msg("input-available")])).toBe("Подтвердите или отклоните расписание выше, чтобы продолжить…");
    cleanup();
    render(<MessageList messages={[msg("output-available", JSON.stringify({ status: "declined" }))]} isLoading={false} addToolOutput={vi.fn()} />);
    expect(screen.getByText("Расписание не создано")).toBeTruthy();
  });
});

describe("Task overflow", () => {
  const prompt = "word ".repeat(30); // short in characters and lines, but wraps past 4 lines when narrow
  const long = { ...input, prompt };

  function mockHeights(scroll: number, client: number) {
    const s = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scroll);
    const c = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(client);
    return () => {
      s.mockRestore();
      c.mockRestore();
    };
  }

  it("offers Show more when the clamped text is actually cut off", () => {
    const restore = mockHeights(120, 64);
    render(<MessageList messages={[msg("input-available", undefined, long)]} isLoading={false} addToolOutput={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
    restore();
  });

  it("offers no expander when nothing is cut off", () => {
    const restore = mockHeights(40, 40);
    render(<MessageList messages={[msg("input-available", undefined, long)]} isLoading={false} addToolOutput={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    restore();
  });
});
