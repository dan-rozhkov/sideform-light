import { useCallback, useEffect, useRef, useState } from "react";

import { PencilSimpleIcon, PlayIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Switch } from "@/components/ui/switch";
import { t as translate, useT } from "@/i18n";
import type { DesktopSchedulesApi, ScheduleView } from "@/lib/desktopBridge";
import { describeCron, formatUntil } from "@/lib/scheduleCron";
import { errorText, formatScheduleWhen } from "@/lib/scheduleText";

import { SettingsGroup, SettingsSection } from "../SettingsSection";
import { ScheduleDialog } from "./ScheduleDialog";

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
}) {
  const t = useT();
  useTick(30_000);
  return (
    <li
      data-testid={`schedule-${schedule.id}`}
      className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border-default py-4 last:border-b-0"
    >
      <div className="min-w-0 flex-1 basis-40">
        <h3 className="truncate text-sm font-medium text-text-primary">{schedule.name}</h3>
        <p className="mt-0.5 text-xs text-text-primary">{describeCron(schedule.cron)}</p>
        <p className="mt-0.5 text-xs text-text-muted">
          {schedule.enabled && schedule.nextRunAt !== null
            ? t("schedules.nextRun", { until: formatUntil(schedule.nextRunAt), at: formatScheduleWhen(schedule.nextRunAt) })
            : schedule.enabled
              ? t("schedules.neverRuns")
              : t("schedules.off")}
        </p>
      </div>
      <div data-testid="schedule-controls" className="flex shrink-0 items-center gap-1">
        {!confirming && (
          <>
            <IconButton type="button" variant="ghost" size="icon" tooltip={t("schedules.runNow")} disabled={busy} onClick={onRunNow}>
              <PlayIcon className="size-4" weight="light" />
            </IconButton>
            <IconButton type="button" variant="ghost" size="icon" tooltip={t("schedules.edit")} disabled={busy} onClick={onEdit}>
              <PencilSimpleIcon className="size-4" weight="light" />
            </IconButton>
            <IconButton
              type="button"
              variant="ghost"
              size="icon"
              tooltip={t("schedules.delete")}
              disabled={busy}
              onClick={onAskDelete}
              className="hover:text-destructive"
            >
              <TrashIcon className="size-4" weight="light" />
            </IconButton>
          </>
        )}
        <Switch
          aria-label={t("schedules.toggleAria", { name: schedule.name })}
          checked={schedule.enabled}
          disabled={busy}
          onCheckedChange={onToggle}
          className="ml-1.5"
        />
      </div>
      {confirming && (
        // Its own full-width line, so a long question never squeezes the text or overflows at narrow widths.
        <div className="flex basis-full flex-wrap items-center justify-end gap-x-2 gap-y-1.5" role="group" aria-label={t("schedules.confirm.group")}>
          <span className="text-xs text-text-primary">{t("schedules.confirm.question")}</span>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
            {t("schedules.delete")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancelDelete}>
            {t("schedules.cancel")}
          </Button>
        </div>
      )}
    </li>
  );
}

function SchedulesControls({ api }: { api: DesktopSchedulesApi }) {
  const t = useT();
  const [schedules, setSchedules] = useState<ScheduleView[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ schedule: ScheduleView | null; open: boolean; session: number }>({ schedule: null, open: false, session: 0 });
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
      (e: unknown) => alive.current && mine === seq.current && setListError(errorText(e, translate("schedules.error.list"))),
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

  const openDialog = (schedule: ScheduleView | null) => setDialog((d) => ({ schedule, open: true, session: d.session + 1 }));
  const closeDialog = (open: boolean) => setDialog((d) => ({ ...d, open }));

  const act = async (id: string, call: () => Promise<{ error: string } | object>) => {
    setBusyId(id);
    setActionError(null);
    try {
      const out = await call();
      if (!alive.current) return;
      if ("error" in out && typeof out.error === "string") setActionError(out.error);
      else refreshAfterAction();
    } catch (e) {
      if (alive.current) setActionError(errorText(e, t("schedules.error.generic")));
    } finally {
      if (alive.current) setBusyId(null);
    }
  };

  // runNow resolves with the schedule even when the run did not start: surface a skipped / failed run of this click.
  const runNow = (s: ScheduleView, clickedAt: number) => {
    return act(s.id, async () => {
      const out = await api.runNow(s.id);
      const run = "schedule" in out ? out.schedule.lastRun : undefined;
      if (run && run.status !== "started" && run.at >= clickedAt) {
        const reason = run.error;
        setActionError(
          run.status === "skipped"
            ? reason
              ? t("schedules.runSkipped", { reason })
              : t("schedules.runSkippedPlain")
            : reason
              ? t("schedules.runFailed", { reason })
              : t("schedules.runFailedPlain"),
        );
      }
      return out;
    });
  };

  const toggle = (s: ScheduleView, enabled: boolean) =>
    act(s.id, () => api.save({ id: s.id, name: s.name, prompt: s.prompt, cron: s.cron, enabled }));


  const list = schedules ?? [];
  const showEmpty = schedules !== null && list.length === 0;

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
            <h3 className="text-sm font-medium text-text-primary">{t("schedules.empty.title")}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{t("schedules.empty.description")}</p>
          </div>
          <Button type="button" variant="accent" size="lg" onClick={() => openDialog(null)}>
            <PlusIcon aria-hidden />
            {t("schedules.new")}
          </Button>
        </div>
      )}

      {schedules !== null && list.length > 0 && (
        <div className="flex justify-end pt-4">
          <Button type="button" variant="outline" size="lg" onClick={() => openDialog(null)}>
            <PlusIcon aria-hidden />
            {t("schedules.new")}
          </Button>
        </div>
      )}

      {list.length > 0 && (
        <ul className="list-none">
          {list.map((s) => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              busy={busyId === s.id}
              confirming={confirmId === s.id}
              onToggle={(next) => void toggle(s, next)}
              onRunNow={() => void runNow(s, Date.now())}
              onEdit={() => {
                setConfirmId(null);
                openDialog(s);
              }}
              onAskDelete={() => setConfirmId(s.id)}
              onCancelDelete={() => setConfirmId(null)}
              onDelete={() => {
                setConfirmId(null);
                void act(s.id, () => api.remove(s.id));
              }}
            />
          ))}
        </ul>
      )}

      <ScheduleDialog api={api} schedule={dialog.schedule} open={dialog.open} session={dialog.session} onOpenChange={closeDialog} onSaved={refreshAfterAction} />
    </>
  );
}

export function SchedulesSection() {
  const t = useT();
  const api = typeof window !== "undefined" ? window.penDesktop?.schedules : undefined;
  return (
    <SettingsSection
      title={t("schedules.title")}
      description={t("schedules.description")}
    >
      {api ? (
        <SchedulesControls api={api} />
      ) : (
        <SettingsGroup title={t("schedules.unavailable.title")} description={t("schedules.unavailable.description")} />
      )}
    </SettingsSection>
  );
}
