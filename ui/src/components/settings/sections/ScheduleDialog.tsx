import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import type { DesktopSchedulesApi, ScheduleInput, ScheduleView } from "@/lib/desktopBridge";
import { errorText, formatScheduleWhen, lastRunText } from "@/lib/scheduleText";
import {
  dayShortLabel,
  describeCron,
  formatTime,
  formatUntil,
  fromCron,
  nextRunOfFrequency,
  parseTime,
  toCron,
  type Frequency,
  type FrequencyKind,
} from "@/lib/scheduleCron";

type FrequencyChoice = "off" | FrequencyKind;

const FREQUENCY_CHOICES: readonly FrequencyChoice[] = ["off", "hourly", "daily", "weekdays", "weekly", "custom"];

// Monday first; values are cron day-of-week numbers.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_FREQUENCY: Frequency = { kind: "daily", hour: 9, minute: 0 };

interface ScheduleFormProps {
  api: DesktopSchedulesApi;
  schedule: ScheduleView | null;
  onDone: () => void;
}

function ScheduleForm({ api, schedule, onDone }: ScheduleFormProps) {
  const t = useT();
  const frequencyOptions: SegmentedControlOption<FrequencyChoice>[] = FREQUENCY_CHOICES.map((value) => ({
    value,
    label: t(`schedules.frequency.${value}`),
  }));
  const weekdayOptions: SegmentedControlOption<string>[] = WEEKDAY_ORDER.map((day) => ({ value: String(day), label: dayShortLabel(day) }));
  const stored = schedule ? fromCron(schedule.cron) : DEFAULT_FREQUENCY;
  const [name, setName] = useState(schedule?.name ?? "");
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [frequency, setFrequency] = useState<FrequencyChoice>(() => (schedule && !schedule.enabled ? "off" : stored.kind));
  // A disabled schedule keeps its frequency; "Off" just hides the fields below.
  const [lastFrequency, setLastFrequency] = useState<FrequencyKind>(stored.kind);
  const [time, setTime] = useState(() => ("hour" in stored ? formatTime(stored.hour, stored.minute) : "09:00"));
  const [minute, setMinute] = useState(() => String("minute" in stored ? stored.minute : 0));
  const [day, setDay] = useState(() => (stored.kind === "weekly" ? stored.day : 1));
  const [cron, setCron] = useState(() => (stored.kind === "custom" ? stored.cron : (schedule?.cron ?? "")));
  // True once a custom cron was typed here (or came stored): switching back to Custom then keeps it,
  // otherwise Custom starts from the preset as edited right now.
  const [cronTouched, setCronTouched] = useState(stored.kind === "custom");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [now] = useState(() => Date.now());
  const active: FrequencyKind = frequency === "off" ? lastFrequency : frequency;
  // No silent clamping: anything but a whole number 0-59 is an error the user sees.
  const minuteValid = /^\d{1,2}$/.test(minute.trim()) && Number(minute) <= 59;
  const parsedTime = parseTime(time);

  // The frequency being edited, or null while its fields are invalid.
  const current = ((): Frequency | null => {
    switch (active) {
      case "hourly":
        return minuteValid ? { kind: "hourly", minute: Number(minute) } : null;
      case "custom":
        return cron.trim() ? { kind: "custom", cron: cron.trim() } : null;
      case "weekly":
        return parsedTime ? { kind: "weekly", day, ...parsedTime } : null;
      default:
        return parsedTime ? { kind: active, ...parsedTime } : null;
    }
  })();
  const fieldsValid = current !== null;
  const canSave = name.trim() !== "" && prompt.trim() !== "" && (frequency === "off" || fieldsValid) && !saving;
  const next = frequency !== "off" && current ? nextRunOfFrequency(current, now) : null;

  // For Custom: the human description, only when it says more than the raw cron (the next run is computed by the app).
  const cronDescription = ((): string | null => {
    const text = cron.trim();
    if (!text) return null;
    const described = describeCron(text);
    return described === text ? null : described;
  })();

  const changeFrequency = (value: FrequencyChoice) => {
    // Switching to Hourly starts from the minutes of the time field as edited right now.
    if (value === "hourly" && active !== "hourly" && parsedTime) setMinute(String(parsedTime.minute));
    // Switching to Custom from a preset starts from that preset's cron.
    if (value === "custom" && active !== "custom" && current && !cronTouched) setCron(toCron(current));
    setFrequency(value);
    if (value !== "off") setLastFrequency(value);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    // Off never fails on the fields: invalid ones fall back to the stored (or default) cron.
    const saved = current ? toCron(current) : (schedule?.cron ?? toCron(DEFAULT_FREQUENCY));
    const input: ScheduleInput = {
      ...(schedule ? { id: schedule.id } : {}),
      name: name.trim(),
      prompt: prompt.trim(),
      cron: saved,
      enabled: frequency !== "off",
    };
    setSaving(true);
    setError(null);
    try {
      const out = await api.save(input);
      if ("error" in out) setError(out.error);
      else onDone();
    } catch (e) {
      setError(errorText(e, t("schedules.error.save")));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!schedule) return;
    setSaving(true);
    setError(null);
    try {
      const out = await api.remove(schedule.id);
      if ("error" in out) setError(out.error);
      else onDone();
    } catch (e) {
      setError(errorText(e, t("schedules.error.remove")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col gap-4">
      <DialogHeader className="shrink-0">
        <DialogTitle>{schedule ? t("schedules.form.edit") : t("schedules.form.new")}</DialogTitle>
        <DialogDescription>{t("schedules.dialog.description")}</DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-name">{t("schedules.field.name")}</Label>
          <Input id="schedule-name" maxLength={100} placeholder={t("schedules.placeholder.name")} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-task">{t("schedules.field.task")}</Label>
          <Textarea
            id="schedule-task"
            maxLength={20000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("schedules.placeholder.task")}
            className="min-h-20 max-h-[40vh] overflow-y-auto"
          />
        </div>

        <SegmentedControl aria-label={t("schedules.field.frequency")} options={frequencyOptions} value={frequency} onValueChange={changeFrequency} className="flex w-full overflow-x-auto *:flex-1" />

        {frequency !== "off" && active === "hourly" && (
          <div className="flex items-center gap-2">
            <Label htmlFor="schedule-minute">{t("schedules.field.minuteOfHour")}</Label>
            <Input
              id="schedule-minute"
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(e) => setMinute(e.target.value)}
              aria-invalid={!minuteValid}
              aria-describedby={minuteValid ? undefined : "schedule-minute-error"}
              className="w-16"
            />
            {!minuteValid && (
              <p id="schedule-minute-error" role="alert" className="text-xs text-destructive">
                {t("schedules.error.minute")}
              </p>
            )}
          </div>
        )}

        {frequency !== "off" && (active === "daily" || active === "weekdays" || active === "weekly") && (
          <div className="flex items-center gap-2">
            <Label htmlFor="schedule-time">{t("schedules.field.time")}</Label>
            <Input id="schedule-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-28 dark:[color-scheme:dark]" />
          </div>
        )}

        {frequency === "weekly" && (
          <SegmentedControl
            aria-label={t("schedules.field.day")}
            options={weekdayOptions}
            value={String(day)}
            onValueChange={(value) => setDay(Number(value))}
            className="flex w-full *:flex-1"
          />
        )}

        {frequency === "custom" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-cron">{t("schedules.field.cron")}</Label>
            <Input id="schedule-cron" className="font-mono" placeholder="0 9 * * 1-5" spellCheck={false} value={cron} onChange={(e) => {
                setCron(e.target.value);
                setCronTouched(true);
              }} />
            <p className="text-xs text-text-muted">{t("schedules.customHint")}</p>
          </div>
        )}

        <div className="flex flex-col gap-0.5 text-xs text-text-muted">
          {next !== null && <p>{t("schedules.nextRun", { until: formatUntil(next), at: formatScheduleWhen(next) })}</p>}
          {frequency === "custom" && cronDescription !== null && <p>{t("schedules.dialog.runs", { description: cronDescription })}</p>}
          {schedule?.lastRun && <p>{lastRunText(schedule.lastRun)}</p>}
        </div>

        <p className="text-xs text-text-muted">{t("schedules.dialog.footnote")}</p>

        {error && <InlineAlert variant="error">{error}</InlineAlert>}
      </div>

      <DialogFooter className="shrink-0">
        {schedule && confirmingRemove ? (
          <div className="flex flex-wrap items-center gap-2 sm:mr-auto" role="group" aria-label={t("schedules.remove.group")}>
            <span className="text-xs text-text-primary">{t("schedules.remove.question")}</span>
            <Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => void remove()}>
              {t("schedules.remove.confirm")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setConfirmingRemove(false)}>
              {t("schedules.cancel")}
            </Button>
          </div>
        ) : (
          schedule && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmingRemove(true)} className="sm:mr-auto">
              {t("schedules.remove.button")}
            </Button>
          )
        )}
        <Button type="submit" variant="accent" disabled={!canSave || confirmingRemove}>
          {t("schedules.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface ScheduleDialogProps {
  api: DesktopSchedulesApi;
  /** The schedule to edit, or null for a new one. */
  schedule: ScheduleView | null;
  open: boolean;
  /** Changes every time the dialog is opened, so the form starts from the stored schedule again. */
  session: number;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save or remove (before the dialog closes). */
  onSaved?: () => void;
}

/** Creates, changes or removes a schedule. The form starts from the stored schedule each time it opens. */
export function ScheduleDialog({ api, schedule, open, session, onOpenChange, onSaved }: ScheduleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <ScheduleForm key={`${schedule?.id ?? "new"}:${session}`} api={api} schedule={schedule} onDone={() => {
            onSaved?.();
            onOpenChange(false);
          }} />
      </DialogContent>
    </Dialog>
  );
}
