import { useRef, useState } from "react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { openSettings } from "@/lib/openSettings";
import { describeCron } from "@/lib/scheduleCron";
import type { ScheduleActionDetails } from "@/lib/tools/pendingScheduleActions";
import { DECLINED_OUTPUT, runScheduleAction, type ScheduleAction } from "@/lib/tools/schedules";
import { ScheduleTaskField } from "./ScheduleCardParts";
import { parseScheduleOutcome, SCHEDULE_CARD as CARD } from "./scheduleCardUtils";

/**
 * Confirmation card for schedule_set_enabled (Pause / Resume) and schedule_delete (Delete). It never decides
 * anything: the onToolCall precheck already did and recorded `details`; only Confirm / Cancel resolve the call.
 */
export function ScheduleActionCard({
  call,
  state,
  output,
  details,
  onResolve,
}: {
  call: ScheduleAction;
  state: "input" | "output";
  output?: unknown;
  /** The schedule as the precheck found it (pendingScheduleActions); gone once the call is resolved. */
  details?: ScheduleActionDetails;
  /** Writes the tool output (a JSON string). */
  onResolve: (output: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false);
  // The name survives the outcome (a delete output carries only the id) until the chat is reloaded.
  const [kept, setKept] = useState(details);
  if (details && details !== kept) setKept(details);

  if (state === "output") {
    const o = parseScheduleOutcome(output);
    const shown = o.schedule?.name ?? kept?.name;
    let line: string;
    if (o.status === "updated" && call.tool === "schedule_set_enabled") {
      const key = call.enabled ? "schedules.card.resumed" : "schedules.card.paused";
      line = t(key, { name: shown ?? "" }).replace(/ · $/, "");
    } else if (o.status === "deleted") {
      line = shown ? t("schedules.card.deleted", { name: shown }) : t("schedules.card.deletedPlain");
    } else if (o.status === "error") {
      line = o.fromShell && o.error ? t("schedules.card.notChangedReason", { error: o.error }) : t("schedules.card.notChangedError");
    } else {
      line = t("schedules.card.notChanged");
    }
    const failed = o.status !== "updated" && o.status !== "deleted";
    return (
      <div className={`${CARD} flex flex-wrap items-center gap-x-2 gap-y-1`}>
        <span className={failed ? "text-text-muted" : "text-text-primary"}>{line}</span>
        {o.status === "updated" && (
          <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => openSettings("schedules")}>
            {t("schedules.card.open")}
          </Button>
        )}
      </div>
    );
  }

  const run = async (decision: "confirm" | "cancel") => {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    const result = decision === "confirm" ? await runScheduleAction(call) : DECLINED_OUTPUT;
    onResolve(result);
  };

  const title =
    call.tool === "schedule_delete"
      ? t("schedules.card.deleteTitle")
      : call.enabled
        ? t("schedules.card.resumeTitle")
        : t("schedules.card.pauseTitle");
  const confirmLabel =
    call.tool === "schedule_delete"
      ? t("schedules.card.delete")
      : call.enabled
        ? t("schedules.card.resume")
        : t("schedules.card.pause");

  return (
    <div className={`${CARD} space-y-3`}>
      <div className="font-semibold text-text-primary">{title}</div>
      {details && (
        <dl className="space-y-2">
          <div>
            <dt className="text-text-muted">{t("schedules.field.name")}</dt>
            <dd className="break-words text-text-primary">{details.name}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t("schedules.field.frequency")}</dt>
            <dd className="text-text-primary">{describeCron(details.cron)}</dd>
          </div>
          <ScheduleTaskField prompt={details.prompt} />
        </dl>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={call.tool === "schedule_delete" ? "destructive" : "accent"}
          disabled={busy}
          onClick={() => void run("confirm")}
        >
          {confirmLabel}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("cancel")}>
          {t("schedules.cancel")}
        </Button>
      </div>
    </div>
  );
}
