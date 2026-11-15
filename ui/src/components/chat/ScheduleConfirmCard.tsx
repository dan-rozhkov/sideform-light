import { useRef, useState } from "react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { openSettings } from "@/lib/openSettings";
import { describeCron } from "@/lib/scheduleCron";
import { ScheduleTaskField } from "./ScheduleCardParts";
import { parseScheduleOutcome, SCHEDULE_CARD as CARD } from "./scheduleCardUtils";
import { createScheduleViaBridge, DECLINED_OUTPUT, type ScheduleCreateInput } from "@/lib/tools/schedules";

export function ScheduleConfirmCard({
  input,
  state,
  output,
  onResolve,
}: {
  input: ScheduleCreateInput;
  state: "input" | "output";
  output?: unknown;
  /** Writes the tool output (a JSON string). */
  onResolve: (output: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false);

  if (state === "output") {
    const o = parseScheduleOutcome(output);
    return (
      <div className={`${CARD} flex flex-wrap items-center gap-x-2 gap-y-1`}>
        {o.status === "created" ? (
          <>
            <span className="text-text-primary">
              {/* The frequency in the interface language; the tool output's nextRun is fixed English for the model. */}
              {input.cron ? t("schedules.card.createdNext", { when: describeCron(input.cron) }) : t("schedules.card.created")}
            </span>
            <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => openSettings("schedules")}>
              {t("schedules.card.open")}
            </Button>
          </>
        ) : o.status === "error" ? (
          <span className="text-text-muted">
            {o.error ? t("schedules.card.notCreatedReason", { error: o.error }) : t("schedules.card.notCreated")}
          </span>
        ) : (
          <span className="text-text-muted">{t("schedules.card.notCreated")}</span>
        )}
      </div>
    );
  }

  const run = async (decision: "create" | "cancel") => {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    const result = decision === "create" ? await createScheduleViaBridge(input) : DECLINED_OUTPUT;
    onResolve(result);
  };

  return (
    <div className={`${CARD} space-y-3`}>
      <div className="font-semibold text-text-primary">{t("schedules.card.title")}</div>
      <dl className="space-y-2">
        <div>
          <dt className="text-text-muted">{t("schedules.field.name")}</dt>
          <dd className="break-words text-text-primary">{input.name}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("schedules.field.frequency")}</dt>
          <dd className="text-text-primary">{describeCron(input.cron)}</dd>
        </div>
        <ScheduleTaskField prompt={input.prompt} />
      </dl>
      <div className="flex gap-2">
        <Button size="sm" variant="accent" disabled={busy} onClick={() => void run("create")}>
          {t("schedules.create")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("cancel")}>
          {t("schedules.cancel")}
        </Button>
      </div>
    </div>
  );
}
