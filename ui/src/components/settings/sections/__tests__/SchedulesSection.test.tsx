import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScheduleView } from "@/lib/desktopBridge";
import { t, useLanguageStore } from "@/i18n";
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
  useLanguageStore.setState({ language: "en" });
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("SchedulesSection", () => {
  it("is in the nav and the section list", () => {
    expect(SETTINGS_SECTIONS).toContain("schedules");
    expect(SETTINGS_NAV.find((s) => s.id === "schedules")?.labelKey).toBe("settings.nav.schedules");
    expect(t("settings.nav.schedules")).toBe("Schedules");
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

  it("shows the empty state with New schedule that opens the dialog", async () => {
    setup([]);
    render(<SchedulesSection />);
    expect(await screen.findByTestId("schedules-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("New schedule")).toBeTruthy();
    // The note on when runs happen sits under the title; there is no other description.
    expect(within(dialog).getByText(/^Runs only while Sideform Light is open and the computer is awake\./)).toBeTruthy();
    expect(dialog.textContent).not.toContain("Start a new chat that gives the browser agent");
    expect(within(dialog).queryByRole("button", { name: "Remove schedule" })).toBeNull();
  });

  it("lists name, frequency and next run; no last run and no Open chat", async () => {
    setup([sched({ lastRun: { at: Date.now() - 5 * 60_000, status: "started", chatId: "tab-9" } })]);
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-s1");
    expect(row.textContent).toContain("Check prices");
    expect(row.textContent).toContain("Every weekday at 09:00");
    expect(row.textContent).toContain("Next run in 3h");
    expect(row.textContent).not.toContain("Last run");
    expect(within(row).queryByRole("button", { name: "Open chat" })).toBeNull();
  });

  it("row actions are icon buttons named Run now, Edit and Delete, before the switch", async () => {
    const { api } = setup([sched()]);
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-s1");
    const controls = [...row.querySelectorAll("button, [role=switch]")].map((el) => el.getAttribute("aria-label") ?? el.getAttribute("role"));
    expect(controls.slice(0, 3)).toEqual(["Run now", "Edit", "Delete"]);
    expect(row.querySelector("[role=switch]")).toBe(row.querySelectorAll("button, [role=switch]")[3]);
    for (const name of ["Run now", "Edit", "Delete"]) expect(within(row).getByRole("button", { name }).textContent).toBe("");
    fireEvent.click(within(row).getByRole("button", { name: "Run now" }));
    expect(api.runNow).toHaveBeenCalledWith("s1");
  });

  const openNew = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "New schedule" }));
    return screen.findByRole("dialog");
  };
  const fillBasics = () => {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Morning " } });
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Do the thing" } });
  };
  const pick = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));

  it("creates a daily schedule at the chosen time and closes", async () => {
    const { api } = setup([]);
    render(<SchedulesSection />);
    await openNew();
    fillBasics();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "07:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledWith({ name: "Morning", prompt: "Do the thing", cron: "45 7 * * *", enabled: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("disables Save until name and task are filled", async () => {
    const { api } = setup([]);
    render(<SchedulesSection />);
    await openNew();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "B" } });
    expect(save.disabled).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("saves a weekly schedule from the day buttons and the time", async () => {
    const { api } = setup([]);
    render(<SchedulesSection />);
    await openNew();
    fillBasics();
    pick("Weekly");
    pick("Fri");
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "18:15" } });
    expect(document.body.textContent).toContain("Next run in");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ name: "Morning", prompt: "Do the thing", cron: "15 18 * * 5", enabled: true }));
  });

  it("validates the hourly minute inline", async () => {
    const { api } = setup([]);
    render(<SchedulesSection />);
    await openNew();
    fillBasics();
    pick("Hourly");
    fireEvent.change(screen.getByLabelText("Minute past the hour"), { target: { value: "75" } });
    expect(screen.getByText("Enter a whole number from 0 to 59.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Minute past the hour"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ cron: "15 * * * *", enabled: true })));
  });

  it("Off saves enabled:false and keeps the last frequency", async () => {
    const { api } = setup([]);
    render(<SchedulesSection />);
    await openNew();
    fillBasics();
    pick("Weekdays");
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "08:30" } });
    pick("Off");
    expect(screen.queryByLabelText("Time")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ name: "Morning", prompt: "Do the thing", cron: "30 8 * * 1-5", enabled: false }));
  });

  it("saves a custom cron and needs it non-empty", async () => {
    const { api } = setup([]);
    render(<SchedulesSection />);
    await openNew();
    fillBasics();
    pick("Cron");
    expect(document.body.textContent).toContain("Five fields:");
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "*/20 * * * *" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ cron: "*/20 * * * *", enabled: true })));
  });

  it("shows main's error inside the dialog and keeps it open", async () => {
    setup([sched()], { save: vi.fn().mockResolvedValue({ error: "Invalid cron: field 1" }) });
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("Check prices");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Invalid cron: field 1");
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("edit pre-fills a preset cron and saves it with the id", async () => {
    const { api } = setup([sched({ lastRun: { at: Date.now(), status: "failed", error: "No window" } })]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit schedule")).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: "Weekdays" }).getAttribute("aria-checked")).toBe("true");
    expect((within(dialog).getByLabelText("Time") as HTMLInputElement).value).toBe("09:00");
    // The dialog does not show the last run (the list row does).
    expect(dialog.textContent).not.toContain("Last run");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({ id: "s1", name: "Check prices", prompt: "Look at the shops", cron: "0 9 * * 1-5", enabled: true }),
    );
  });

  it("edit opens a non-preset cron as Custom", async () => {
    const { api } = setup([sched({ cron: "*/10 * * * *" })]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Cron" }).getAttribute("aria-checked")).toBe("true");
    expect((within(dialog).getByLabelText("Cron expression") as HTMLInputElement).value).toBe("*/10 * * * *");
    fireEvent.change(within(dialog).getByLabelText("Cron expression"), { target: { value: "*/20 * * * *" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", cron: "*/20 * * * *" })));
  });

  it("edit of a disabled schedule opens on Off", async () => {
    setup([sched({ enabled: false })]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");
  });

  it("Remove schedule in the dialog removes and closes", async () => {
    const { api } = setup();
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove schedule" }));
    // Asks first: nothing is removed yet.
    expect(within(dialog).getByText("Remove this schedule?")).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Cancel on the remove confirmation keeps the schedule", async () => {
    const { api } = setup();
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove schedule" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(dialog).queryByText("Remove this schedule?")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Remove schedule" })).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("keeps header and footer visible: capped task field, bounded dialog, scrolling body", async () => {
    setup([sched({ prompt: "x\n".repeat(500) })]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
    const task = within(dialog).getByLabelText("Task");
    expect(task.className).toContain("max-h-[40vh]");
    expect(task.className).toContain("overflow-y-auto");
    expect(task.closest(".overflow-y-auto.min-h-0")).toBeTruthy();
  });

  it("Custom starts from the edited preset, not the stored cron", async () => {
    setup([sched()]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "07:30" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Cron" }));
    expect((within(dialog).getByLabelText("Cron expression") as HTMLInputElement).value).toBe("30 7 * * 1-5");
  });

  it("returning to Custom keeps what was typed there", async () => {
    setup([sched()]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Cron" }));
    fireEvent.change(within(dialog).getByLabelText("Cron expression"), { target: { value: "*/20 * * * *" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Daily" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Cron" }));
    expect((within(dialog).getByLabelText("Cron expression") as HTMLInputElement).value).toBe("*/20 * * * *");
  });

  it("Custom shows a description as Runs:, and nothing when it is just the raw cron", async () => {
    setup([sched()]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Cron" }));
    expect(dialog.textContent).toContain("Runs:");
    expect(dialog.textContent).toContain("Every weekday at 09:00");
    expect(dialog.textContent).not.toContain("Next run in");
    fireEvent.change(within(dialog).getByLabelText("Cron expression"), { target: { value: "*/20 * * * *" } });
    expect(dialog.textContent).not.toContain("Runs:");
    expect(dialog.textContent).not.toContain("Next run in");
  });

  it("starts the form from the stored schedule each time the dialog opens", async () => {
    setup([sched()]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(within(await screen.findByRole("dialog")).getByLabelText("Name"), { target: { value: "Changed" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((within(await screen.findByRole("dialog")).getByLabelText("Name") as HTMLInputElement).value).toBe("Check prices");
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

  it("the delete confirmation is its own wrapping line, outside the shrink-0 controls", async () => {
    setup();
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-s1");
    expect(row.className).toContain("flex-wrap");
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    const group = within(row).getByRole("group", { name: "Confirm delete" });
    const controls = within(row).getByTestId("schedule-controls");
    expect(controls.className).toContain("shrink-0");
    expect(controls.contains(group)).toBe(false);
    expect(group.parentElement).toBe(row);
    expect(group.className).toContain("basis-full");
    expect(group.className).toContain("flex-wrap");
    // the switch stays on the first line; the row actions give way to the confirmation
    expect(controls.querySelector('[role="switch"]')).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Run now" })).toBeNull();
  });

  it.each([
    ["skipped", "No window", "Run skipped: No window"],
    ["failed", "Boom", "Run failed: Boom"],
    ["skipped", undefined, "Run skipped"],
  ] as const)("Run now shows a %s run of this click (%s)", async (status, error, want) => {
    const { api } = setup([sched()], {
      runNow: vi.fn().mockImplementation(async () => ({ schedule: sched({ lastRun: { at: Date.now() + 1, status, ...(error ? { error } : {}) } }) })),
    });
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(api.runNow).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toBe(want);
  });

  it("Run now says nothing for a started run or for an older skipped run", async () => {
    const old = sched({ lastRun: { at: Date.now() - 60_000, status: "skipped", error: "Old" } });
    const { api } = setup([old], {
      runNow: vi.fn().mockResolvedValueOnce({ schedule: sched({ lastRun: { at: Date.now() + 1, status: "started", chatId: "c" } }) }).mockResolvedValueOnce({ schedule: old }),
    });
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(api.runNow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(api.runNow).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Run now localizes a skipped run", async () => {
    useLanguageStore.setState({ language: "de" });
    const { api } = setup([sched()], {
      runNow: vi.fn().mockImplementation(async () => ({ schedule: sched({ lastRun: { at: Date.now() + 1, status: "skipped", error: "x" } }) })),
    });
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: t("schedules.runNow") }));
    await waitFor(() => expect(api.runNow).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toBe("Ausführung übersprungen: x");
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

  it("renders in Russian", async () => {
    useLanguageStore.setState({ language: "ru" });
    setup();
    render(<SchedulesSection />);
    await screen.findByText("Check prices");
    expect(screen.getByRole("heading", { name: "Расписания" })).toBeTruthy();
    expect(screen.getByText("По будням в 09:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Запустить сейчас" })).toBeTruthy();
  });

  it("renders the edit dialog in Russian", async () => {
    useLanguageStore.setState({ language: "ru" });
    setup([sched({ lastRun: { at: Date.now(), status: "failed", error: "No window" } })]);
    render(<SchedulesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Изменить" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Изменить расписание")).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: "По будням" }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByLabelText("Время")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Удалить расписание" })).toBeTruthy();
    expect(dialog.textContent).not.toContain("Последний запуск");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Еженедельно" }));
    expect(within(dialog).getByRole("radio", { name: "Пн" })).toBeTruthy();
  });
});
