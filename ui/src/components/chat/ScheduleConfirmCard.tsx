import { useLayoutEffect, useRef, useState } from "react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { openSettings } from "@/lib/openSettings";
import { describeCron } from "@/lib/scheduleCron";
import { createScheduleViaBridge, DECLINED_OUTPUT, type ScheduleCreateInput } from "@/lib/tools/schedules";

interface Outcome {
  status?: string;
  error?: string;
  schedule?: { nextRun?: string };
}

function parseOutcome(output: unknown): Outcome {
  try {
    const v = typeof output === "string" ? (JSON.parse(output) as unknown) : output;
    if (v && typeof v === "object") {
      const o = v as Outcome;
      if (typeof o.error === "string" && !o.status) return { status: "error", error: o.error };
      return o;
    }
  } catch {
    /* fall through */
  }
  return {};
}

const CARD = "mt-3 w-full rounded-lg border border-border-default bg-surface-panel/60 p-3 text-xs";

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
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const lockRef = useRef(false);
  const taskRef = useRef<HTMLElement>(null);

  // The task is clamped to 4 lines: detect real overflow (wrapped long lines included) so "Show more" is
  // always offered when text is cut off. Measured only while clamped; once expanded the last result stays.
  useLayoutEffect(() => {
    const el = taskRef.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, input.prompt, state]);

  if (state === "output") {
    const o = parseOutcome(output);
    return (
      <div className={`${CARD} flex flex-wrap items-center gap-x-2 gap-y-1`}>
        {o.status === "created" ? (
          <>
            <span className="text-text-primary">
              {o.schedule?.nextRun ? t("schedules.card.createdNext", { when: o.schedule.nextRun }) : t("schedules.card.created")}
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
        <div>
          <dt className="text-text-muted">{t("schedules.field.task")}</dt>
          <dd ref={taskRef} className={`whitespace-pre-wrap break-words text-text-primary ${expanded ? "" : "line-clamp-4"}`}>
            {input.prompt}
          </dd>
          {(overflows || expanded || input.prompt.length > 240 || input.prompt.split("\n").length > 4) && (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0 text-xs"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t("schedules.card.showLess") : t("schedules.card.showMore")}
            </Button>
          )}
        </div>
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
