import { useCallback, useEffect, useRef, useState } from "react";

import { PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DesktopSchedulesApi, ScheduleInput, ScheduleView } from "@/lib/desktopBridge";
import { formatRelativeTime } from "@/lib/relativeTime";
import {
  CUSTOM_CRON_HINT,
  DAY_NAMES,
  describeCron,
  formatTime,
  formatUntil,
  FREQUENCY_LABELS,
  fromCron,
  parseTime,
  toCron,
  withKind,
  type Frequency,
  type FrequencyKind,
} from "@/lib/scheduleCron";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

const KINDS: FrequencyKind[] = ["hourly", "daily", "weekdays", "weekly", "custom"];

interface Draft {
  id?: string;
  name: string;
  prompt: string;
  freq: Frequency;
  enabled: boolean;
}

const NEW_DRAFT: Draft = { name: "", prompt: "", freq: { kind: "daily", hour: 9, minute: 0 }, enabled: true };

function draftOf(s: ScheduleView): Draft {
  return { id: s.id, name: s.name, prompt: s.prompt, freq: fromCron(s.cron), enabled: s.enabled };
}

const absolute = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-text-primary">
      {children}
    </label>
  );
}

function FrequencyFields({ freq, onChange }: { freq: Frequency; onChange: (f: Frequency) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={freq.kind} onValueChange={(v) => v && onChange(withKind(v as FrequencyKind, freq))}>
          <SelectTrigger size="sm" aria-label="Frequency">
            <SelectValue>{FREQUENCY_LABELS[freq.kind]}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start" className="w-auto">
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {FREQUENCY_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {freq.kind === "weekly" && (
          <Select value={String(freq.day)} onValueChange={(v) => v !== null && onChange({ ...freq, day: Number(v) })}>
            <SelectTrigger size="sm" aria-label="Day of the week">
              <SelectValue>{DAY_NAMES[freq.day]}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start" className="w-auto">
              {DAY_NAMES.map((name, i) => (
                <SelectItem key={name} value={String(i)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {freq.kind === "hourly" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            at minute
            <Input
              type="number"
              min={0}
              max={59}
              aria-label="Minute"
              className="w-16"
              value={freq.minute}
              onChange={(e) => onChange({ ...freq, minute: Math.min(59, Math.max(0, Math.trunc(Number(e.target.value)) || 0)) })}
            />
          </span>
        )}

        {(freq.kind === "daily" || freq.kind === "weekdays" || freq.kind === "weekly") && (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            at
            <Input
              type="time"
              aria-label="Time"
              className="w-24"
              value={formatTime(freq.hour, freq.minute)}
              onChange={(e) => {
                const t = parseTime(e.target.value);
                if (t) onChange({ ...freq, ...t });
              }}
            />
          </span>
        )}
      </div>

      {freq.kind === "custom" && (
        <>
          <Input
            aria-label="Cron expression"
            className="font-mono"
            placeholder="0 9 * * 1-5"
            spellCheck={false}
            value={freq.cron}
            onChange={(e) => onChange({ kind: "custom", cron: e.target.value })}
          />
          <p className="text-xs text-text-muted">{CUSTOM_CRON_HINT}</p>
        </>
      )}
    </div>
  );
}

function Editor({
  draft,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  saving: boolean;
  error: string | null;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      aria-label={draft.id ? "Edit schedule" : "New schedule"}
      className="flex flex-col gap-3 rounded-control-lg bg-secondary/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
        <Input
          id="schedule-name"
          maxLength={100}
          placeholder="Check prices"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="schedule-task">Task</FieldLabel>
        <textarea
          id="schedule-task"
          rows={4}
          maxLength={20000}
          placeholder="What should the agent do? For example: open the three shop pages and tell me which prices changed."
          className="min-h-20 w-full resize-y rounded-control-sm bg-secondary px-2 py-1.5 text-sm text-secondary-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-accent-light md:text-xs/relaxed"
          value={draft.prompt}
          onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Frequency</FieldLabel>
        <FrequencyFields freq={draft.freq} onChange={(freq) => onChange({ ...draft, freq })} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="accent" size="lg" disabled={saving}>
          {draft.id ? "Save" : "Create schedule"}
        </Button>
        <Button type="button" variant="ghost" size="lg" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function lastRunText(run: NonNullable<ScheduleView["lastRun"]>): string {
  const when = formatRelativeTime(run.at);
  switch (run.status) {
    case "started":
      return `Last run started ${when}`;
    case "skipped":
      return `Last run skipped ${when}${run.error ? `: ${run.error}` : ""}`;
    case "failed":
      return `Last run failed ${when}${run.error ? `: ${run.error}` : ""}`;
  }
}

/** Re-renders the caller every `ms` while mounted, so relative times stay fresh. */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function ScheduleRow({
  schedule,
  busy,
  confirming,
  onToggle,
  onRunNow,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onOpenChat,
}: {
  schedule: ScheduleView;
  busy: boolean;
  confirming: boolean;
  onToggle: (next: boolean) => void;
  onRunNow: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onOpenChat: (chatId: string) => void;
}) {
  const { lastRun } = schedule;
  useTick(30_000);
  return (
    <li data-testid={`schedule-${schedule.id}`} className="flex flex-col gap-2 border-b border-border-default py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-text-primary">{schedule.name}</h3>
          <p className="mt-0.5 text-xs text-text-primary">{describeCron(schedule.cron)}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            {schedule.enabled && schedule.nextRunAt !== null
              ? `Next run ${formatUntil(schedule.nextRunAt)} (${absolute(schedule.nextRunAt)})`
              : schedule.enabled
                ? "Never runs"
                : "Off"}
          </p>
          {lastRun && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
              <span>{lastRunText(lastRun)}</span>
              {lastRun.chatId && (
                <Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => onOpenChat(lastRun.chatId!)}>
                  Open chat
                </Button>
              )}
            </p>
          )}
        </div>
        <Switch
          aria-label={`${schedule.name} on or off`}
          checked={schedule.enabled}
          disabled={busy}
          onCheckedChange={onToggle}
        />
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
          <span className="text-xs text-text-primary">Delete this schedule?</span>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
            Delete
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancelDelete}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRunNow}>
            Run now
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onAskDelete}>
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

function SchedulesControls({ api }: { api: DesktopSchedulesApi }) {
  const [schedules, setSchedules] = useState<ScheduleView[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const alive = useRef(true);
  const seq = useRef(0);
  // Only the newest list request may update the state: an older, slower reply is dropped.
  const read = useCallback(() => {
    const mine = ++seq.current;
    api.list().then(
      (out) => {
        if (!alive.current || mine !== seq.current) return;
        if ("error" in out) setListError(out.error);
        else {
          setSchedules(out.schedules);
          setListError(null);
        }
      },
      (e: unknown) => alive.current && mine === seq.current && setListError(errorText(e, "Could not read the schedules")),
    );
  }, [api]);

  // Main pushes schedules:changed after every mutation. Without that push, refresh after our own actions.
  const pushes = useRef(false);
  const refreshAfterAction = () => {
    if (!pushes.current) read();
  };

  useEffect(() => {
    alive.current = true;
    read();
    const off = api.onChanged(read);
    pushes.current = typeof off === "function";
    return () => {
      alive.current = false;
      if (typeof off === "function") off();
    };
  }, [api, read]);

  const openEditor = (d: Draft) => {
    setEditorError(null);
    setDraft(d);
  };

  const save = async () => {
    if (!draft) return;
    const input: ScheduleInput = {
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      cron: toCron(draft.freq),
      enabled: draft.enabled,
    };
    if (!input.name) return setEditorError("Give the schedule a name.");
    if (!input.prompt) return setEditorError("Describe what the agent should do.");
    if (!input.cron) return setEditorError("Enter a cron expression.");
    setSaving(true);
    setEditorError(null);
    try {
      const out = await api.save(input);
      if (!alive.current) return;
      if ("error" in out) setEditorError(out.error);
      else {
        setDraft(null);
        refreshAfterAction();
      }
    } catch (e) {
      if (alive.current) setEditorError(errorText(e, "Could not save the schedule"));
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const act = async (id: string, call: () => Promise<{ error: string } | object>) => {
    setBusyId(id);
    setActionError(null);
    try {
      const out = await call();
      if (!alive.current) return;
      if ("error" in out && typeof out.error === "string") setActionError(out.error);
      else refreshAfterAction();
    } catch (e) {
      if (alive.current) setActionError(errorText(e, "Something went wrong"));
    } finally {
      if (alive.current) setBusyId(null);
    }
  };

  const toggle = (s: ScheduleView, enabled: boolean) =>
    act(s.id, () => api.save({ id: s.id, name: s.name, prompt: s.prompt, cron: s.cron, enabled }));

  const openChat = (chatId: string) => {
    setActionError(null);
    api.openChat(chatId).then(
      (out) => alive.current && "error" in out && setActionError(out.error),
      (e: unknown) => alive.current && setActionError(errorText(e, "Could not open the chat")),
    );
  };

  const list = schedules ?? [];
  const showEmpty = schedules !== null && list.length === 0 && !draft;

  return (
    <>
      {listError && (
        <p role="alert" className="py-3 text-xs text-destructive">
          {listError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="py-3 text-xs text-destructive">
          {actionError}
        </p>
      )}

      {showEmpty && (
        <div data-testid="schedules-empty" className="flex flex-col items-start gap-3 py-5">
          <div>
            <h3 className="text-sm font-medium text-text-primary">No schedules yet</h3>
            <p className="mt-0.5 text-xs text-text-muted">Add one, for example a daily check of a page you care about.</p>
          </div>
          <Button type="button" variant="accent" size="lg" onClick={() => openEditor(NEW_DRAFT)}>
            <PlusIcon aria-hidden />
            New schedule
          </Button>
        </div>
      )}

      {schedules !== null && list.length > 0 && !draft?.id && (
        <div className="flex justify-end pt-4">
          <Button type="button" variant="outline" size="lg" disabled={draft !== null} onClick={() => openEditor(NEW_DRAFT)}>
            <PlusIcon aria-hidden />
            New schedule
          </Button>
        </div>
      )}

      {draft && !draft.id && (
        <div className="py-4">
          <Editor draft={draft} saving={saving} error={editorError} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} />
        </div>
      )}

      {list.length > 0 && (
        <ul className="list-none">
          {list.map((s) =>
            draft?.id === s.id ? (
              <li key={s.id} className="py-4">
                <Editor draft={draft} saving={saving} error={editorError} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} />
              </li>
            ) : (
              <ScheduleRow
                key={s.id}
                schedule={s}
                busy={busyId === s.id}
                confirming={confirmId === s.id}
                onToggle={(next) => void toggle(s, next)}
                onRunNow={() => void act(s.id, () => api.runNow(s.id))}
                onEdit={() => {
                  setConfirmId(null);
                  openEditor(draftOf(s));
                }}
                onAskDelete={() => setConfirmId(s.id)}
                onCancelDelete={() => setConfirmId(null)}
                onDelete={() => {
                  setConfirmId(null);
                  void act(s.id, () => api.remove(s.id));
                }}
                onOpenChat={openChat}
              />
            ),
          )}
        </ul>
      )}
    </>
  );
}

export function SchedulesSection() {
  const api = typeof window !== "undefined" ? window.penDesktop?.schedules : undefined;
  return (
    <SettingsSection
      title="Schedules"
      description="A schedule gives the browser agent a task at set times. Each run opens as a new chat in the agent panel. Sideform Light must be running: runs missed while it was closed or the computer slept are skipped."
    >
      {api ? (
        <SchedulesControls api={api} />
      ) : (
        <SettingsGroup title="Not available in this version" description="Update Sideform Light to schedule tasks." />
      )}
    </SettingsSection>
  );
}
