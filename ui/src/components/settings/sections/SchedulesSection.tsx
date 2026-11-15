import { useCallback, useEffect, useRef, useState } from "react";

import { PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { t as translate, useT } from "@/i18n";
import type { DesktopSchedulesApi, ScheduleView } from "@/lib/desktopBridge";
import { describeCron, formatUntil } from "@/lib/scheduleCron";
import { errorText, formatScheduleWhen, lastRunText } from "@/lib/scheduleText";

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
  const t = useT();
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
              ? t("schedules.nextRun", { until: formatUntil(schedule.nextRunAt), at: formatScheduleWhen(schedule.nextRunAt) })
              : schedule.enabled
                ? t("schedules.neverRuns")
                : t("schedules.off")}
          </p>
          {lastRun && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
              <span>{lastRunText(lastRun)}</span>
              {lastRun.chatId && (
                <Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => onOpenChat(lastRun.chatId!)}>
                  {t("schedules.openChat")}
                </Button>
              )}
            </p>
          )}
        </div>
        <Switch
          aria-label={t("schedules.toggleAria", { name: schedule.name })}
          checked={schedule.enabled}
          disabled={busy}
          onCheckedChange={onToggle}
        />
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("schedules.confirm.group")}>
          <span className="text-xs text-text-primary">{t("schedules.confirm.question")}</span>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
            {t("schedules.delete")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancelDelete}>
            {t("schedules.cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRunNow}>
            {t("schedules.runNow")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onEdit}>
            {t("schedules.edit")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onAskDelete}>
            {t("schedules.delete")}
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

  const toggle = (s: ScheduleView, enabled: boolean) =>
    act(s.id, () => api.save({ id: s.id, name: s.name, prompt: s.prompt, cron: s.cron, enabled }));

  const openChat = (chatId: string) => {
    setActionError(null);
    api.openChat(chatId).then(
      (out) => alive.current && "error" in out && setActionError(out.error),
      (e: unknown) => alive.current && setActionError(errorText(e, t("schedules.error.openChat"))),
    );
  };

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
              onRunNow={() => void act(s.id, () => api.runNow(s.id))}
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
              onOpenChat={openChat}
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
