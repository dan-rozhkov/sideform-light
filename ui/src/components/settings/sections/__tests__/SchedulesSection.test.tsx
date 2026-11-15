import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScheduleView } from "@/lib/desktopBridge";
import { SETTINGS_NAV } from "@/components/settings/settingsSections";
import { SETTINGS_SECTIONS } from "@/lib/openSettings";
import { SchedulesSection } from "../SchedulesSection";

const sched = (over: Partial<ScheduleView> = {}): ScheduleView => ({
  id: "s1",
  name: "Check prices",
  prompt: "Look at the shops",
  cron: "0 9 * * 1-5",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: Date.now() + 3 * 3_600_000 + 60_000,
  ...over,
});

function setup(schedules: ScheduleView[] = [sched()], over: Record<string, unknown> = {}) {
  let changed: () => void = () => {};
  const api = {
    list: vi.fn().mockResolvedValue({ schedules }),
    save: vi.fn().mockResolvedValue({ schedule: sched() }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    runNow: vi.fn().mockResolvedValue({ schedule: sched() }),
    openChat: vi.fn().mockResolvedValue({ ok: true }),
    onChanged: vi.fn((cb: () => void) => {
      changed = cb;
      return () => {};
    }),
    ...over,
  };
  (window as { penDesktop?: unknown }).penDesktop = { schedules: api };
  return { api, fireChanged: () => changed() };
}

afterEach(() => {
  cleanup();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("SchedulesSection", () => {
  it("is in the nav and the section list", () => {
    expect(SETTINGS_SECTIONS).toContain("schedules");
    expect(SETTINGS_NAV.find((s) => s.id === "schedules")?.label).toBe("Schedules");
  });

  it("says it is not available without the bridge", () => {
    render(<SchedulesSection />);
    expect(screen.getByText("Not available in this version")).toBeTruthy();
  });

  it("explains what schedules do and that the app must be running", async () => {
    setup();
    render(<SchedulesSection />);
    await screen.findByText("Check prices");
    expect(document.body.textContent).toContain("must be running");
    expect(document.body.textContent).toContain("skipped");
  });

  it("shows the empty state with New schedule", async () => {
    setup([]);
    render(<SchedulesSection />);
    expect(await screen.findByTestId("schedules-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));
    expect(screen.getByRole("form", { name: "New schedule" })).toBeTruthy();
  });

  it("lists name, frequency, next run and last run with Open chat", async () => {
    const { api } = setup([sched({ lastRun: { at: Date.now() - 5 * 60_000, status: "started", chatId: "tab-9" } })]);
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-s1");
    expect(row.textContent).toContain("Check prices");
    expect(row.textContent).toContain("Every weekday at 09:00");
    expect(row.textContent).toContain("Next run in 3h");
    expect(row.textContent).toContain("Last run started 5m ago");
    fireEvent.click(within(row).getByRole("button", { name: "Open chat" }));
    expect(api.openChat).toHaveBeenCalledWith("tab-9");
  });

  it("shows a failed last run with its reason and no Open chat without a chat", async () => {
    setup([sched({ lastRun: { at: Date.now(), status: "skipped", error: "The previous run is still running" } })]);
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-s1");
    expect(row.textContent).toContain("Last run skipped just now: The previous run is still running");
    expect(within(row).queryByRole("button", { name: "Open chat" })).toBeNull();
  });

  it("creates a schedule with the cron of the default preset", async () => {
    const { api } = setup([]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "New schedule" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Morning " } });
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Do the thing" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "07:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledWith({ name: "Morning", prompt: "Do the thing", cron: "45 7 * * *", enabled: true });
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });

  it("does not call save for an empty name or task", async () => {
    const { api } = setup([]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "New schedule" }));
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    expect((await screen.findByRole("alert")).textContent).toContain("name");
    expect(api.save).not.toHaveBeenCalled();
  });

  it("shows main's validation error inline and keeps the editor open", async () => {
    const { api } = setup([sched()], { save: vi.fn().mockResolvedValue({ error: "Invalid cron: field 1" }) });
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Check prices");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid cron: field 1");
    expect(api.save).toHaveBeenCalledWith({ id: "s1", name: "Check prices", prompt: "Look at the shops", cron: "0 9 * * 1-5", enabled: true });
    expect(screen.getByRole("form", { name: "Edit schedule" })).toBeTruthy();
  });

  it("edits a custom cron as raw text", async () => {
    const { api } = setup([sched({ cron: "*/10 * * * *" })]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Cron expression") as HTMLInputElement).value).toBe("*/10 * * * *");
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "*/20 * * * *" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ cron: "*/20 * * * *" })));
  });

  it("asks inline before deleting", async () => {
    const { api } = setup();
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-s1");
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(within(row).getByRole("button", { name: "Run now" })).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(within(row).getByText("Delete this schedule?")).toBeTruthy();
    fireEvent.click(within(within(row).getByRole("group", { name: "Confirm delete" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("s1"));
  });

  it("Run now calls runNow and shows its error", async () => {
    const { api } = setup([sched()], { runNow: vi.fn().mockResolvedValue({ error: "No window" }) });
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(api.runNow).toHaveBeenCalledWith("s1"));
    expect((await screen.findByRole("alert")).textContent).toBe("No window");
  });

  it("the switch saves the schedule with the other value", async () => {
    const { api } = setup();
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("switch", { name: "Check prices on or off" }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({ id: "s1", name: "Check prices", prompt: "Look at the shops", cron: "0 9 * * 1-5", enabled: false }),
    );
  });

  it("re-reads the list when main pushes a change", async () => {
    const { api, fireChanged } = setup();
    render(<SchedulesSection />);
    await screen.findByText("Check prices");
    expect(api.list).toHaveBeenCalledTimes(1);
    api.list.mockResolvedValue({ schedules: [sched({ name: "Renamed" })] });
    act(() => fireChanged());
    await screen.findByText("Renamed");
  });

  it("does not re-read after an action when main pushes changes itself", async () => {
    const { api } = setup();
    render(<SchedulesSection />);
    await screen.findByText("Check prices");
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(api.runNow).toHaveBeenCalled());
    await Promise.resolve();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("re-reads after an action when there is no change push", async () => {
    const { api } = setup([sched()], { onChanged: vi.fn() });
    render(<SchedulesSection />);
    await screen.findByText("Check prices");
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("ignores a stale list reply that arrives after a newer one", async () => {
    let resolveOld: (v: unknown) => void = () => {};
    const { api, fireChanged } = setup();
    render(<SchedulesSection />);
    await screen.findByText("Check prices");
    api.list.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    act(() => fireChanged());
    api.list.mockResolvedValueOnce({ schedules: [sched({ name: "Newest" })] });
    act(() => fireChanged());
    await screen.findByText("Newest");
    await act(async () => resolveOld({ schedules: [sched({ name: "Stale" })] }));
    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.getByText("Newest")).toBeTruthy();
  });

  it("refreshes the relative next-run text on a timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      const now = Date.now();
      setup([sched({ nextRunAt: now + 5 * 60_000 + 5000 })]);
      render(<SchedulesSection />);
      await act(async () => {});
      expect(screen.getByText(/Next run in 5m/)).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(3 * 60_000);
      });
      expect(screen.getByText(/Next run in 2m/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
